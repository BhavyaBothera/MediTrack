import crypto from 'crypto';
import { supabaseAdmin } from '../config/supabase';
import { DeliveryResult, NotificationPayload, NotificationProvider } from './provider.interface';

export type OutboxState =
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'retry_scheduled'
  | 'dead_letter';

export interface OutboxMetadata {
  outbox_state: OutboxState;
  idempotency_key: string;
  attempts: number;
  max_attempts: number;
  next_retry_at: string;
  processing_started_at?: string;
  worker_id?: string;
  claim_token?: string;
  recovery_attempts?: number;
  last_recovery_at?: string;
  last_recovery_worker?: string;
  last_error?: string;
  hold_reason?: string | null;
  provider_response?: any;
}

export interface EnqueueOutboxParams {
  notificationId: string;
  channel: 'in_app' | 'email' | 'whatsapp' | 'sms' | 'push';
  recipientId: string;
  patientId: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  recipientAddress?: string;
  idempotencyKey: string;
  maxAttempts?: number;
  holdUntil?: Date | null;
  holdReason?: string | null;
  metadata?: Record<string, any>;
}

export class NotificationOutbox {
  private workerId: string;
  private inFlightEnqueueMutex: Map<string, Promise<{ outboxId: string; state: OutboxState; isDuplicate: boolean }>> = new Map();

  constructor(customWorkerId?: string) {
    this.workerId = customWorkerId || `worker_${process.pid}_${Math.random().toString(36).substring(2, 9)}`;
  }

  public getWorkerId(): string {
    return this.workerId;
  }

  /**
   * Generates a stable idempotency key for notification deduplication.
   */
  public static generateIdempotencyKey(
    type: string,
    recipientId: string,
    doseId?: string,
    channel?: string
  ): string {
    const parts = ['notif', type, recipientId, doseId || 'nodose', channel || 'all'];
    return parts.join(':');
  }

  /**
   * Enqueues a notification into the delivery outbox state machine.
   *
   * Database-Enforced Outbox Idempotency:
   * 1. Uses a process-level in-flight promise mutex to coordinate concurrent enqueue calls within the node process.
   * 2. Enforces unique database constraints (PostgreSQL UNIQUE constraint or unique index on idempotency_key).
   * 3. Handles duplicate-key conflicts (Postgres error code 23505) safely by querying and returning the existing record
   *    by exact idempotency_key with `isDuplicate: true`.
   * 4. If the database schema or cache lacks idempotency_key, refuses dispatch with [DATABASE MIGRATION REQUIRED].
   *    Never silently falls back to unconstrained insertion.
   * 5. Completely eliminates check-then-insert race conditions across concurrent workers.
   */
  async enqueue(params: EnqueueOutboxParams): Promise<{ outboxId: string; state: OutboxState; isDuplicate: boolean }> {
    const key = params.idempotencyKey;

    // Check if an enqueue operation for this idempotency key is already running in this process
    const inFlight = this.inFlightEnqueueMutex.get(key);
    if (inFlight) {
      const existing = await inFlight;
      return {
        outboxId: existing.outboxId,
        state: existing.state,
        isDuplicate: true,
      };
    }

    const executionPromise = this.executeAtomicEnqueue(params);
    this.inFlightEnqueueMutex.set(key, executionPromise);

    try {
      return await executionPromise;
    } finally {
      this.inFlightEnqueueMutex.delete(key);
    }
  }

  private async executeAtomicEnqueue(
    params: EnqueueOutboxParams
  ): Promise<{ outboxId: string; state: OutboxState; isDuplicate: boolean }> {
    const maxAttempts = params.maxAttempts || 3;
    const nowIso = new Date().toISOString();
    const nextRetryAt = params.holdUntil ? params.holdUntil.toISOString() : nowIso;

    // 1. Check if a delivery log with this exact idempotency key already exists
    const { data: existingLog, error: checkErr } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('id, status, provider_response')
      .eq('idempotency_key', params.idempotencyKey)
      .maybeSingle();

    if (checkErr) {
      if (
        checkErr.code === '42703' ||
        checkErr.code === 'PGRST204' ||
        checkErr.message.includes('schema cache') ||
        checkErr.message.includes('idempotency_key')
      ) {
        throw new Error(
          `[DATABASE MIGRATION REQUIRED] Cannot enqueue notification: 'idempotency_key' column is missing or schema cache is stale. ` +
          `External dispatch refused to prevent duplicate notification delivery. Detailed error: ${checkErr.message}`
        );
      }
    }

    if (existingLog) {
      const meta = existingLog.provider_response as OutboxMetadata | null;
      return {
        outboxId: existingLog.id,
        state: meta?.outbox_state || (existingLog.status === 'delivered' ? 'delivered' : 'queued'),
        isDuplicate: true,
      };
    }

    const initialMetadata: OutboxMetadata = {
      outbox_state: 'queued',
      idempotency_key: params.idempotencyKey,
      attempts: 0,
      max_attempts: maxAttempts,
      next_retry_at: nextRetryAt,
      hold_reason: params.holdReason || null,
    };

    const insertPayload: any = {
      notification_id: params.notificationId,
      channel: params.channel,
      recipient_address: params.recipientAddress || null,
      status: 'pending',
      attempts: 0,
      provider_response: initialMetadata,
      idempotency_key: params.idempotencyKey,
    };

    // 2. Perform atomic insert with database-enforced idempotency_key constraint
    const { data: inserted, error } = await supabaseAdmin
      .from('notification_delivery_logs')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      // Postgres error 23505 = unique_violation (database unique constraint on idempotency_key)
      const isUniqueConflict =
        error.code === '23505' ||
        error.message.includes('unique constraint') ||
        error.message.includes('idempotency_key') ||
        error.message.includes('duplicate key');

      if (isUniqueConflict) {
        // Concurrent worker won race; safely retrieve the existing record using exact idempotency_key
        const { data: existingConflict, error: conflictErr } = await supabaseAdmin
          .from('notification_delivery_logs')
          .select('id, status, provider_response')
          .eq('idempotency_key', params.idempotencyKey)
          .single();

        if (conflictErr || !existingConflict) {
          throw new Error(
            `Unique constraint violation occurred for idempotency_key "${params.idempotencyKey}", ` +
            `but failed to retrieve conflicting record: ${conflictErr?.message || 'not found'}`
          );
        }

        const meta = existingConflict.provider_response as OutboxMetadata | null;
        return {
          outboxId: existingConflict.id,
          state: meta?.outbox_state || (existingConflict.status === 'delivered' ? 'delivered' : 'queued'),
          isDuplicate: true,
        };
      }

      // Postgres error 42703 / PostgREST PGRST204 = column does not exist or schema cache is stale
      if (
        (error.code === '42703' || error.code === 'PGRST204' || error.message.includes('schema cache')) &&
        error.message.includes('idempotency_key')
      ) {
        throw new Error(
          `[DATABASE MIGRATION REQUIRED] Cannot enqueue notification: 'idempotency_key' column is missing or schema cache is stale. ` +
          `External dispatch refused to prevent duplicate notification delivery. Detailed error: ${error.message}`
        );
      }

      throw new Error(`Failed to enqueue outbox notification: ${error.message}`);
    }

    return {
      outboxId: inserted.id,
      state: 'queued',
      isDuplicate: false,
    };
  }

  /**
   * Atomically claims a single specific enqueued job for immediate processing (P0-2).
   *
   * Conditional Atomic Claim Requirements:
   * 1. Matches row by id: outboxId.
   * 2. Matches row status: 'pending'.
   * 3. Matches expected idempotency_key.
   * 4. Matches outbox_state: 'queued'.
   * 5. Transitions outbox_state to 'processing', sets worker_id, claim_token, and processing_started_at.
   * 6. Returns the claimed job record if exactly 1 row was updated; returns null if 0 rows matched (e.g. background worker claimed it first).
   * 7. Propagates database errors.
   */
  async claimSingleJob(outboxId: string, expectedIdempotencyKey: string): Promise<any | null> {
    const nowIso = new Date().toISOString();
    const claimToken = crypto.randomUUID();

    // 1. Fetch current job to get metadata and notification relation
    const { data: job, error: fetchErr } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select(`
        id,
        notification_id,
        channel,
        recipient_address,
        status,
        attempts,
        provider_response,
        notification:notifications (
          id,
          recipient_id,
          patient_id,
          type,
          title,
          message,
          severity
        )
      `)
      .eq('id', outboxId)
      .eq('status', 'pending')
      .maybeSingle();

    if (fetchErr) {
      throw new Error(`Database error fetching outbox job ${outboxId}: ${fetchErr.message}`);
    }

    if (!job) {
      return null;
    }

    const meta = job.provider_response as OutboxMetadata | null;
    if (!meta || meta.outbox_state !== 'queued' || meta.idempotency_key !== expectedIdempotencyKey) {
      return null;
    }

    const updatedMeta: OutboxMetadata = {
      ...meta,
      outbox_state: 'processing',
      processing_started_at: nowIso,
      worker_id: this.workerId,
      claim_token: claimToken,
    };

    // 2. Atomic conditional CAS update:
    // Requires id, status: 'pending', exact idempotency_key, and outbox_state: 'queued'
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from('notification_delivery_logs')
      .update({
        provider_response: updatedMeta,
      })
      .eq('id', outboxId)
      .eq('status', 'pending')
      .eq('idempotency_key', expectedIdempotencyKey)
      .contains('provider_response', { outbox_state: 'queued' })
      .select('id');

    if (claimErr) {
      throw new Error(`Database error claiming outbox job ${outboxId}: ${claimErr.message}`);
    }

    if (!claimed || claimed.length === 0) {
      // 0 rows updated means background worker or another process claimed it first
      return null;
    }

    return {
      ...job,
      provider_response: updatedMeta,
    };
  }

  /**
   * Atomically claims a batch of queued or retry_scheduled jobs for processing.
   *
   * Fencing Token Protocol:
   * Generates a unique cryptographic claim token (UUID) for each job claim attempt.
   * Uses compare-and-swap (CAS) conditional update to ensure that only the worker that
   * successfully transitions the state from queued/retry_scheduled to 'processing'
   * acquires the claim token and processing ownership.
   */
  async claimBatch(limit = 20): Promise<any[]> {
    const nowIso = new Date().toISOString();

    const { data: pendingLogs, error } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select(`
        id,
        notification_id,
        channel,
        recipient_address,
        status,
        attempts,
        provider_response,
        notification:notifications (
          id,
          recipient_id,
          patient_id,
          type,
          title,
          message,
          severity
        )
      `)
      .eq('status', 'pending')
      .limit(limit);

    if (error || !pendingLogs || pendingLogs.length === 0) {
      return [];
    }

    const claimedJobs: any[] = [];

    for (const log of pendingLogs) {
      const meta = log.provider_response as OutboxMetadata | null;
      if (!meta) continue;

      const state = meta.outbox_state;
      // Only process queued or retry_scheduled items whose scheduled time has arrived
      if (state !== 'queued' && state !== 'retry_scheduled') continue;
      if (meta.next_retry_at && meta.next_retry_at > nowIso) continue;

      // Generate a unique cryptographic fencing token for this claim
      const claimToken = crypto.randomUUID();

      const updatedMeta: OutboxMetadata = {
        ...meta,
        outbox_state: 'processing',
        processing_started_at: nowIso,
        worker_id: this.workerId,
        claim_token: claimToken,
      };

      // Atomic conditional update to claim job using Postgres JSON containment compare-and-swap
      const { data: claimed, error: claimErr } = await supabaseAdmin
        .from('notification_delivery_logs')
        .update({
          provider_response: updatedMeta,
        })
        .eq('id', log.id)
        .eq('status', 'pending')
        .contains('provider_response', { outbox_state: state })
        .select('*');

      if (!claimErr && claimed && claimed.length > 0) {
        claimedJobs.push({
          ...log,
          provider_response: updatedMeta,
        });
      }
    }

    return claimedJobs;
  }

  /**
   * Process all pending outbox jobs that are ready to run (queued or retry_scheduled).
   */
  async processPending(
    providers: Map<string, NotificationProvider>,
    limit = 20
  ): Promise<{ processed: number; successful: number; failed: number }> {
    const claimed = await this.claimBatch(limit);
    let successful = 0;
    let failed = 0;

    for (const job of claimed) {
      const provider = providers.get(job.channel);
      if (!provider) {
        console.warn(`[NotificationOutbox] No provider registered for channel ${job.channel}`);
        continue;
      }

      let pushSubscription: any = undefined;
      if (job.channel === 'push' && job.notification?.recipient_id) {
        const { data: prefs } = await supabaseAdmin
          .from('notification_preferences')
          .select('push_subscription')
          .eq('user_id', job.notification.recipient_id)
          .single();
        pushSubscription = prefs?.push_subscription;
      }

      const res = await this.executeJob(job, provider, pushSubscription);
      if (res.success) {
        successful++;
      } else {
        failed++;
      }
    }

    return { processed: claimed.length, successful, failed };
  }

  /**
   * Processes a single claimed outbox item through its target provider.
   *
   * Safe Worker Fencing Enforcement:
   * Requires a conditional update matching `claim_token`, `worker_id`, and `outbox_state: 'processing'`.
   * If a slow worker stalls and the job is reclaimed by crash recovery and claimed by a new worker,
   * the slow worker's write matches 0 rows and is rejected as a fencing violation.
   * The slow worker aborts without modifying parent notifications or corrupting state.
   */
  async executeJob(
    job: any,
    provider: NotificationProvider,
    pushSubscription?: any
  ): Promise<DeliveryResult> {
    const meta = job.provider_response as OutboxMetadata;
    const notif = job.notification;
    const attempts = (meta.attempts || 0) + 1;
    const maxAttempts = meta.max_attempts || 3;
    const claimToken = meta.claim_token;

    const payload: NotificationPayload = {
      notificationId: job.notification_id,
      recipientId: notif?.recipient_id,
      patientId: notif?.patient_id,
      type: notif?.type,
      title: notif?.title,
      message: notif?.message,
      severity: notif?.severity || 'info',
      recipientAddress: job.recipient_address,
      metadata: {
        pushSubscription,
      },
    };

    try {
      const result = await provider.send(payload);

      if (result.success) {
        // Successful delivery transition
        const successMeta: OutboxMetadata = {
          ...meta,
          outbox_state: 'delivered',
          attempts,
          provider_response: result.providerResponse,
        };

        // Conditional CAS update: requires claim_token, worker_id, and outbox_state: 'processing'
        let updateQuery = supabaseAdmin
          .from('notification_delivery_logs')
          .update({
            status: result.isTestMode ? 'simulated_test_mode' : 'delivered',
            attempts,
            provider_response: successMeta,
            delivered_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', job.id)
          .eq('status', 'pending');

        if (claimToken) {
          updateQuery = updateQuery.contains('provider_response', {
            claim_token: claimToken,
            worker_id: this.workerId,
            outbox_state: 'processing',
          });
        }

        const { data: updatedRows, error: updateErr } = await updateQuery.select('id');

        if (updateErr || !updatedRows || updatedRows.length === 0) {
          console.warn(
            `[NotificationOutbox] FENCING REJECTION: Worker ${this.workerId} lost ownership of job ${job.id} ` +
            `(Claim Token: ${claimToken || 'none'}). Another worker claimed or recovered this job. Aborting completion.`
          );
          return {
            channel: job.channel,
            success: false,
            isTestMode: result.isTestMode,
            error: 'Fenced out: job ownership expired or claimed by another worker',
          };
        }

        // Parent notification update:
        // Live external delivery updates status to 'delivered'.
        // Simulated external test mode updates status to 'sent' (NOT 'delivered').
        const parentStatus = result.isTestMode ? 'sent' : 'delivered';
        await supabaseAdmin
          .from('notifications')
          .update({ status: parentStatus })
          .eq('id', job.notification_id);

        return result;
      } else {
        // Provider reported logical failure
        return await this.handleJobFailure(job, meta, attempts, maxAttempts, result.error || 'Provider returned unsuccessful');
      }
    } catch (err: any) {
      // Unhandled provider exception (network timeout, socket reset, rate limit)
      return await this.handleJobFailure(job, meta, attempts, maxAttempts, err.message);
    }
  }

  private async handleJobFailure(
    job: any,
    meta: OutboxMetadata,
    attempts: number,
    maxAttempts: number,
    errorMessage: string
  ): Promise<DeliveryResult> {
    const claimToken = meta.claim_token;

    if (attempts < maxAttempts) {
      // Bounded exponential backoff: base 2s * 2^(attempts-1), capped at 5 minutes
      const backoffMs = Math.min(2000 * Math.pow(2, attempts - 1), 300000);
      const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

      const retryMeta: OutboxMetadata = {
        ...meta,
        outbox_state: 'retry_scheduled',
        attempts,
        next_retry_at: nextRetryAt,
        last_error: errorMessage,
      };

      let updateQuery = supabaseAdmin
        .from('notification_delivery_logs')
        .update({
          status: 'pending',
          attempts,
          provider_response: retryMeta,
          error_message: errorMessage,
        })
        .eq('id', job.id)
        .eq('status', 'pending');

      if (claimToken) {
        updateQuery = updateQuery.contains('provider_response', {
          claim_token: claimToken,
          worker_id: this.workerId,
          outbox_state: 'processing',
        });
      }

      const { data: updatedRows } = await updateQuery.select('id');
      if (!updatedRows || updatedRows.length === 0) {
        console.warn(`[NotificationOutbox] Fencing Rejection on retry scheduling for job ${job.id}. Lost claim.`);
        return {
          channel: job.channel,
          success: false,
          isTestMode: false,
          error: 'Fenced out: job ownership expired or claimed by another worker',
        };
      }

      console.warn(
        `[NotificationOutbox] Job ${job.id} failed attempt ${attempts}/${maxAttempts}: ${errorMessage}. ` +
        `Retry scheduled in ${Math.round(backoffMs / 1000)}s (at ${nextRetryAt}).`
      );

      return {
        channel: job.channel,
        success: false,
        isTestMode: false,
        error: `Attempt ${attempts}/${maxAttempts} failed: ${errorMessage}. Scheduled retry at ${nextRetryAt}`,
      };
    } else {
      // Exhausted retries -> Dead Letter State
      const deadLetterMeta: OutboxMetadata = {
        ...meta,
        outbox_state: 'dead_letter',
        attempts,
        last_error: errorMessage,
      };

      let updateQuery = supabaseAdmin
        .from('notification_delivery_logs')
        .update({
          status: 'failed',
          attempts,
          provider_response: deadLetterMeta,
          error_message: `Dead Letter: Exhausted ${attempts} attempts. Last error: ${errorMessage}`,
        })
        .eq('id', job.id)
        .eq('status', 'pending');

      if (claimToken) {
        updateQuery = updateQuery.contains('provider_response', {
          claim_token: claimToken,
          worker_id: this.workerId,
          outbox_state: 'processing',
        });
      }

      const { data: updatedRows } = await updateQuery.select('id');
      if (!updatedRows || updatedRows.length === 0) {
        console.warn(`[NotificationOutbox] Fencing Rejection on dead-letter transition for job ${job.id}. Lost claim.`);
        return {
          channel: job.channel,
          success: false,
          isTestMode: false,
          error: 'Fenced out: job ownership expired or claimed by another worker',
        };
      }

      await supabaseAdmin
        .from('notifications')
        .update({ status: 'failed' })
        .eq('id', job.notification_id);

      console.error(
        `[NotificationOutbox] 🚨 Job ${job.id} transitioned to DEAD_LETTER after ${attempts} failed attempts: ${errorMessage}`
      );

      return {
        channel: job.channel,
        success: false,
        isTestMode: false,
        error: `Dead Letter: Exhausted ${attempts} attempts. ${errorMessage}`,
      };
    }
  }

  /**
   * Safe Worker Crash Recovery with Fencing Tokens:
   *
   * Scans for delivery logs left in 'processing' status where processing_started_at
   * is older than the stall threshold.
   *
   * Guarantees:
   * 1. Requires conditional CAS match on (id, status='pending', claim_token, worker_id, outbox_state='processing').
   * 2. Increments recovery_attempts count and records last_recovery_at and recovery_worker.
   * 3. Transitions state back to 'retry_scheduled' so any available worker can claim it.
   * 4. If a slow original worker wakes up later, its completion attempt will be rejected because
   *    the database record will no longer match its claim token or 'processing' state.
   *
   * Note on Delivery Semantics:
   * External notifications (SMTP, Twilio, WhatsApp, Push) operate under AT-LEAST-ONCE delivery
   * semantics in the event of worker network partitions or crashes during provider transmission,
   * unless the external provider supports upstream transaction-level idempotency tokens.
   */
  async recoverCrashedJobs(stallTimeoutMs = 120000): Promise<number> {
    const stallThresholdIso = new Date(Date.now() - stallTimeoutMs).toISOString();

    const { data: processingLogs, error } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('id, provider_response')
      .eq('status', 'pending');

    if (error || !processingLogs || processingLogs.length === 0) {
      return 0;
    }

    let recovered = 0;

    for (const log of processingLogs) {
      const meta = log.provider_response as OutboxMetadata | null;
      if (!meta || meta.outbox_state !== 'processing') continue;

      if (meta.processing_started_at && meta.processing_started_at <= stallThresholdIso) {
        const currentClaimToken = meta.claim_token;
        const currentWorkerId = meta.worker_id;
        const recoveryAttempts = (meta.recovery_attempts || 0) + 1;
        const nowIso = new Date().toISOString();

        console.warn(
          `[NotificationOutbox] Worker crash recovery: Reclaiming stalled job ${log.id} ` +
          `(Claim Token: ${currentClaimToken || 'none'}, Worker: ${currentWorkerId || 'unknown'}, ` +
          `Stalled since: ${meta.processing_started_at}, Recovery attempt: ${recoveryAttempts}).`
        );

        const recoveredMeta: OutboxMetadata = {
          ...meta,
          outbox_state: 'retry_scheduled',
          next_retry_at: nowIso,
          recovery_attempts: recoveryAttempts,
          last_recovery_at: nowIso,
          last_recovery_worker: this.workerId,
          last_error: `Recovered after worker stall / timeout (Previous Worker: ${currentWorkerId || 'unknown'}, Claim Token: ${currentClaimToken || 'none'})`,
        };

        // Conditional CAS update requiring exact current state, worker_id, and claim_token
        let recoverQuery = supabaseAdmin
          .from('notification_delivery_logs')
          .update({
            provider_response: recoveredMeta,
            error_message: recoveredMeta.last_error,
          })
          .eq('id', log.id)
          .eq('status', 'pending');

        if (currentClaimToken && currentWorkerId) {
          recoverQuery = recoverQuery.contains('provider_response', {
            claim_token: currentClaimToken,
            worker_id: currentWorkerId,
            outbox_state: 'processing',
          });
        }

        const { data: updated } = await recoverQuery.select('id');

        if (updated && updated.length > 0) {
          recovered++;
        }
      }
    }

    return recovered;
  }
}

export const notificationOutbox = new NotificationOutbox();
