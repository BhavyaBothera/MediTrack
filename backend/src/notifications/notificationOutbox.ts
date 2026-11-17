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

  constructor() {
    this.workerId = `worker_${process.pid}_${Math.random().toString(36).substring(2, 9)}`;
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
   * Uses stable idempotency identifiers to prevent duplicate queueing.
   */
  async enqueue(params: EnqueueOutboxParams): Promise<{ outboxId: string; state: OutboxState; isDuplicate: boolean }> {
    const maxAttempts = params.maxAttempts || 3;
    const nowIso = new Date().toISOString();
    const nextRetryAt = params.holdUntil ? params.holdUntil.toISOString() : nowIso;

    // Check for existing record with same idempotency key
    const { data: existingLogs } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('id, status, provider_response')
      .eq('notification_id', params.notificationId)
      .eq('channel', params.channel);

    if (existingLogs && existingLogs.length > 0) {
      for (const log of existingLogs) {
        const meta = log.provider_response as OutboxMetadata | null;
        if (meta?.idempotency_key === params.idempotencyKey) {
          // Already enqueued or processed
          return {
            outboxId: log.id,
            state: meta.outbox_state || (log.status === 'delivered' ? 'delivered' : 'queued'),
            isDuplicate: true,
          };
        }
      }
    }

    const initialMetadata: OutboxMetadata = {
      outbox_state: 'queued',
      idempotency_key: params.idempotencyKey,
      attempts: 0,
      max_attempts: maxAttempts,
      next_retry_at: nextRetryAt,
      hold_reason: params.holdReason || null,
    };

    const { data: inserted, error } = await supabaseAdmin
      .from('notification_delivery_logs')
      .insert({
        notification_id: params.notificationId,
        channel: params.channel,
        recipient_address: params.recipientAddress || null,
        status: 'pending',
        attempts: 0,
        provider_response: initialMetadata,
      })
      .select('id')
      .single();

    if (error || !inserted) {
      throw new Error(`Failed to enqueue outbox notification: ${error?.message}`);
    }

    return {
      outboxId: inserted.id,
      state: 'queued',
      isDuplicate: false,
    };
  }

  /**
   * Atomically claims a batch of queued or retry_scheduled jobs for processing.
   */
  async claimBatch(limit = 20): Promise<any[]> {
    const nowIso = new Date().toISOString();

    // Query pending delivery logs ready for execution
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

      // Atomic conditional update to claim job using Postgres JSON containment compare-and-swap
      const updatedMeta: OutboxMetadata = {
        ...meta,
        outbox_state: 'processing',
        processing_started_at: nowIso,
        worker_id: this.workerId,
      };

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
   * Handles transient errors with bounded exponential backoff.
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

        await supabaseAdmin
          .from('notification_delivery_logs')
          .update({
            status: result.isTestMode ? 'simulated_test_mode' : 'delivered',
            attempts,
            provider_response: successMeta,
            delivered_at: new Date().toISOString(),
            error_message: null,
          })
          .eq('id', job.id);

        // Update overall notification status to delivered
        await supabaseAdmin
          .from('notifications')
          .update({ status: 'delivered' })
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

      await supabaseAdmin
        .from('notification_delivery_logs')
        .update({
          status: 'pending',
          attempts,
          provider_response: retryMeta,
          error_message: errorMessage,
        })
        .eq('id', job.id);

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

      await supabaseAdmin
        .from('notification_delivery_logs')
        .update({
          status: 'failed',
          attempts,
          provider_response: deadLetterMeta,
          error_message: `Dead Letter: Exhausted ${attempts} attempts. Last error: ${errorMessage}`,
        })
        .eq('id', job.id);

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
   * Crash Recovery:
   * Finds jobs left in 'processing' status after a worker process crashed.
   * If processing started more than stallTimeoutMs ago, safely resets to retry_scheduled.
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

      if (meta.processing_started_at && meta.processing_started_at < stallThresholdIso) {
        console.warn(
          `[NotificationOutbox] Worker crash recovery: Reclaiming stalled job ${log.id} ` +
          `(Processing started at ${meta.processing_started_at} by ${meta.worker_id || 'unknown worker'}).`
        );

        const recoveredMeta: OutboxMetadata = {
          ...meta,
          outbox_state: 'retry_scheduled',
          next_retry_at: new Date().toISOString(),
          last_error: `Recovered after worker stall / crash (Worker ID: ${meta.worker_id || 'unknown'})`,
        };

        const { data: updated } = await supabaseAdmin
          .from('notification_delivery_logs')
          .update({
            provider_response: recoveredMeta,
            error_message: recoveredMeta.last_error,
          })
          .eq('id', log.id)
          .select('id');

        if (updated && updated.length > 0) {
          recovered++;
        }
      }
    }

    return recovered;
  }
}

export const notificationOutbox = new NotificationOutbox();
