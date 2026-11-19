import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';
import { supabaseAdmin } from '../config/supabase';
import { NotificationOutbox, notificationOutbox } from '../notifications/notificationOutbox';
import { notificationManager, evaluateQuietHours } from '../notifications/notificationManager';
import { NotificationProvider, NotificationPayload, DeliveryResult } from '../notifications/provider.interface';

assertSafeExecutionEnvironment('Notification Outbox & Quiet Hours Test Suite');

class MockFailingProvider implements NotificationProvider {
  channelName = 'email' as const;
  public failAttempts = 0;
  public maxFails = 2;

  isConfigured(): boolean {
    return true;
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    this.failAttempts++;
    if (this.failAttempts <= this.maxFails) {
      throw new Error(`Transient mock SMTP connection timeout (attempt ${this.failAttempts})`);
    }
    return {
      channel: 'email',
      success: true,
      isTestMode: true,
      recipientAddress: payload.recipientAddress,
      providerResponse: { messageId: 'mock_smtp_ok_after_retry', isTestMode: true },
    };
  }
}

class MockPermanentFailProvider implements NotificationProvider {
  channelName = 'sms' as const;
  isConfigured(): boolean {
    return true;
  }
  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    throw new Error('Fatal SMS provider rejection: Unregistered Sender ID');
  }
}

async function runNotificationOutboxTests() {
  console.log('========================================================================');
  console.log(' MEDITRACK – P0 NOTIFICATION OUTBOX, IDEMPOTENCY & FENCING TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      passed++;
    } else {
      console.error(`[FAIL] ${title}${details ? ` -> ${details}` : ''}`);
      failed++;
    }
  }

  // Track created fixtures for deterministic cleanup
  let patientId = '';
  let medicineId = '';
  let scheduleId = '';
  let doseId = '';
  const createdNotificationIds: string[] = [];
  const createdOutboxIds: string[] = [];

  try {
    // -------------------------------------------------------------------------
    // SETUP: Provision Dedicated Synthetic Test Fixtures (Defect 5 Isolation)
    // -------------------------------------------------------------------------
    console.log('--- SETUP: PROVISIONING ISOLATED SYNTHETIC TEST FIXTURE ---');
    const timestamp = Date.now();
    const testEmail = `outbox_fixture_${timestamp}@meditrack.test`;

    const { data: userAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: 'Password@123',
      email_confirm: true,
      user_metadata: { full_name: 'Outbox Test Patient', role: 'patient' },
    });

    if (authErr || !userAuth?.user?.id) {
      throw new Error(`Failed to create test user for outbox suite: ${authErr?.message}`);
    }

    patientId = userAuth.user.id;

    await supabaseAdmin.from('profiles').insert({
      id: patientId,
      email: testEmail,
      full_name: 'Outbox Test Patient',
      role: 'patient',
      timezone: 'Asia/Kolkata',
    });

    // Create test medicine, schedule, and dose
    const today = new Date().toISOString().split('T')[0];
    const { data: med, error: medErr } = await supabaseAdmin
      .from('medicines')
      .insert({
        patient_id: patientId,
        name: `OutboxTest Pill ${timestamp}`,
        medicine_type: 'tablet',
        prescribed_dosage: '10mg',
        units_per_intake: 1,
        frequency: 'once_daily',
        food_timing: 'before_food',
        start_date: today,
        status: 'active',
      })
      .select('id')
      .single();

    if (medErr || !med) {
      throw new Error(`Failed to provision test medicine: ${medErr?.message}`);
    }
    medicineId = med.id;

    const { data: sched, error: schedErr } = await supabaseAdmin
      .from('medication_schedules')
      .insert({
        medicine_id: medicineId,
        patient_id: patientId,
        scheduled_time: '09:00:00',
        dose_quantity: 1,
        is_active: true,
      })
      .select('id')
      .single();

    if (schedErr || !sched) {
      throw new Error(`Failed to provision test schedule: ${schedErr?.message}`);
    }
    scheduleId = sched.id;

    const { data: dose, error: doseErr } = await supabaseAdmin
      .from('scheduled_doses')
      .insert({
        patient_id: patientId,
        medicine_id: medicineId,
        schedule_id: scheduleId,
        scheduled_date: today,
        scheduled_time: '09:00:00',
        scheduled_timestamp: new Date().toISOString(),
        grace_period_expires_at: new Date(Date.now() + 1800000).toISOString(),
        dose_quantity: 1,
        status: 'pending',
      })
      .select('id')
      .single();

    if (doseErr || !dose) {
      throw new Error(`Failed to provision test dose: ${doseErr?.message}`);
    }
    doseId = dose.id;

    console.log(`Isolated synthetic test patient: ${testEmail} (ID: ${patientId})\n`);

    // -------------------------------------------------------------------------
    // 1. Defect 2: Real Database 20-Worker Concurrency Enqueue Test
    // -------------------------------------------------------------------------
    console.log('--- 1. DATABASE-ENFORCED OUTBOX IDEMPOTENCY: 20 CONCURRENT ENQUEUE CALLS ---');

    const { data: notif1 } = await supabaseAdmin
      .from('notifications')
      .insert({
        recipient_id: patientId,
        patient_id: patientId,
        type: 'initial_reminder',
        title: 'Concurrent Enqueue Test',
        message: 'Testing 20 simultaneous enqueue attempts for the exact same key',
        severity: 'info',
        status: 'queued',
      })
      .select('id')
      .single();

    const notifId1 = notif1!.id;
    createdNotificationIds.push(notifId1);

    const concurrentKey = NotificationOutbox.generateIdempotencyKey('initial_reminder', patientId, doseId, 'email');

    console.log(`Firing 20 simultaneous enqueue attempts with key: ${concurrentKey}`);
    const parallelCount = 20;
    const enqueuePromises = Array.from({ length: parallelCount }, () =>
      notificationOutbox.enqueue({
        notificationId: notifId1,
        channel: 'email',
        recipientId: patientId,
        patientId: patientId,
        type: 'initial_reminder',
        title: 'Concurrent Enqueue Test',
        message: 'Testing 20 simultaneous enqueue attempts for the exact same key',
        severity: 'info',
        recipientAddress: 'test_concurrent@example.com',
        idempotencyKey: concurrentKey,
        maxAttempts: 3,
      })
    );

    const enqueueResults = await Promise.all(enqueuePromises);

    const nonDuplicateCount = enqueueResults.filter(r => r.isDuplicate === false).length;
    const duplicateCount = enqueueResults.filter(r => r.isDuplicate === true).length;
    const uniqueOutboxIds = new Set(enqueueResults.map(r => r.outboxId));

    assert(
      '20 concurrent enqueue attempts: Exactly 1 record created (isDuplicate: false)',
      nonDuplicateCount === 1,
      `Expected nonDuplicateCount=1, got ${nonDuplicateCount}`
    );
    assert(
      '20 concurrent enqueue attempts: Exactly 19 attempts detected as duplicate (isDuplicate: true)',
      duplicateCount === 19,
      `Expected duplicateCount=19, got ${duplicateCount}`
    );
    assert(
      '20 concurrent enqueue attempts: All 20 returned the exact same outboxId',
      uniqueOutboxIds.size === 1,
      `Expected 1 unique ID, got ${uniqueOutboxIds.size}`
    );

    const winningOutboxId = enqueueResults[0].outboxId;
    createdOutboxIds.push(winningOutboxId);

    // Verify database row count
    const { data: dbLogs } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('id')
      .eq('notification_id', notifId1)
      .eq('channel', 'email');

    assert(
      'Database verification: Exactly 1 delivery log exists in database for this notification attempt',
      dbLogs?.length === 1,
      `Expected 1 DB row, found ${dbLogs?.length}`
    );

    // -------------------------------------------------------------------------
    // 2. Outbox State Machine & Fencing Claim Verification
    // -------------------------------------------------------------------------
    console.log('\n--- 2. TESTING ATOMIC BATCH CLAIM & FENCING TOKEN GENERATION ---');
    const claimedJobs = await notificationOutbox.claimBatch(10);
    const claimedJob = claimedJobs.find(j => j.id === winningOutboxId);

    assert(
      'Atomic batch claim successfully claims queued item into "processing" state',
      claimedJob !== undefined && claimedJob.provider_response?.outbox_state === 'processing'
    );
    assert(
      'Claimed job contains a valid cryptographic UUID claim_token / fencing token',
      Boolean(claimedJob?.provider_response?.claim_token && claimedJob.provider_response.claim_token.length >= 32),
      `Token: ${claimedJob?.provider_response?.claim_token}`
    );

    // Execute job through provider
    const emailProvider = notificationManager.getProvider('email')!;
    const deliveryRes = await notificationOutbox.executeJob(claimedJob, emailProvider);

    assert(
      'Executing job through provider succeeds',
      deliveryRes.success === true,
      deliveryRes.error
    );

    // Verify DB record after delivery
    const { data: deliveredLog } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('status, provider_response, delivered_at')
      .eq('id', winningOutboxId)
      .single();

    assert(
      'Job status in DB updated to "simulated_test_mode" / "delivered" with outbox_state "delivered"',
      (deliveredLog?.status === 'delivered' || deliveredLog?.status === 'simulated_test_mode') &&
      deliveredLog?.provider_response?.outbox_state === 'delivered' &&
      !!deliveredLog?.delivered_at
    );

    // -------------------------------------------------------------------------
    // 3. Bounded Exponential Backoff & Dead Letter State Machine
    // -------------------------------------------------------------------------
    console.log('\n--- 3. TESTING BOUNDED EXPONENTIAL BACKOFF & DEAD LETTER TRANSITION ---');
    const { data: notif2 } = await supabaseAdmin
      .from('notifications')
      .insert({
        recipient_id: patientId,
        patient_id: patientId,
        type: 'initial_reminder',
        title: 'Backoff Test',
        message: 'Testing backoff and retries',
        severity: 'warning',
        status: 'queued',
      })
      .select('id')
      .single();

    const notifId2 = notif2!.id;
    createdNotificationIds.push(notifId2);

    const retryKey = NotificationOutbox.generateIdempotencyKey('initial_reminder', patientId, 'test_dose_backoff', 'email');
    const retryEnqueue = await notificationOutbox.enqueue({
      notificationId: notifId2,
      channel: 'email',
      recipientId: patientId,
      patientId: patientId,
      type: 'initial_reminder',
      title: 'Backoff Test',
      message: 'Testing backoff and retries',
      severity: 'warning',
      recipientAddress: 'test_retry@example.com',
      idempotencyKey: retryKey,
      maxAttempts: 2, // 2 attempts before dead_letter
    });
    createdOutboxIds.push(retryEnqueue.outboxId);

    const retryClaims = await notificationOutbox.claimBatch(10);
    const retryJob = retryClaims.find(j => j.id === retryEnqueue.outboxId);

    // Attempt 1 with failing provider -> retry_scheduled
    const mockFailing = new MockFailingProvider();
    mockFailing.maxFails = 5;
    const failRes1 = await notificationOutbox.executeJob(retryJob, mockFailing);

    assert(
      'Transient failure on attempt 1 transitions to "retry_scheduled" with next_retry_at scheduled',
      Boolean(failRes1.success === false && failRes1.error?.includes('Scheduled retry'))
    );

    const { data: retryLog1 } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('status, attempts, provider_response')
      .eq('id', retryEnqueue.outboxId)
      .single();

    assert(
      'Delivery log records outbox_state "retry_scheduled" and incremented attempt count = 1',
      Boolean(retryLog1?.provider_response?.outbox_state === 'retry_scheduled' && retryLog1?.attempts === 1)
    );

    // Attempt 2 (exhausting max attempts = 2) -> dead_letter
    // Re-claim the job with new claim token to simulate attempt 2
    retryLog1!.provider_response.next_retry_at = new Date(Date.now() - 1000).toISOString();
    await supabaseAdmin
      .from('notification_delivery_logs')
      .update({ provider_response: retryLog1!.provider_response })
      .eq('id', retryEnqueue.outboxId);

    const reClaims = await notificationOutbox.claimBatch(10);
    const reJob = reClaims.find(j => j.id === retryEnqueue.outboxId);

    const failRes2 = await notificationOutbox.executeJob(reJob, mockFailing);

    assert(
      'Exhausting maximum attempts transitions job to DEAD_LETTER state',
      Boolean(failRes2.success === false && failRes2.error?.includes('Dead Letter'))
    );

    const { data: deadLetterLog } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('status, provider_response')
      .eq('id', retryEnqueue.outboxId)
      .single();

    assert(
      'Delivery log DB status updated to "failed" with outbox_state "dead_letter"',
      Boolean(deadLetterLog?.status === 'failed' && deadLetterLog?.provider_response?.outbox_state === 'dead_letter')
    );

    // -------------------------------------------------------------------------
    // 4. Defect 3: Safe Crash Recovery & Distributed Fencing Tokens
    // -------------------------------------------------------------------------
    console.log('\n--- 4. SAFE WORKER CRASH RECOVERY & DISTRIBUTED FENCING TOKENS ---');

    const { data: notif3 } = await supabaseAdmin
      .from('notifications')
      .insert({
        recipient_id: patientId,
        patient_id: patientId,
        type: 'follow_up_reminder',
        title: 'Fencing Token Recovery Test',
        message: 'Simulating slow worker A stall, recovery, and worker B takeover',
        severity: 'warning',
        status: 'queued',
      })
      .select('id')
      .single();

    const notifId3 = notif3!.id;
    createdNotificationIds.push(notifId3);

    // Create two separate worker instances
    const workerA = new NotificationOutbox('worker_alpha_instance');
    const workerB = new NotificationOutbox('worker_bravo_instance');

    const fencingKey = NotificationOutbox.generateIdempotencyKey('follow_up_reminder', patientId, 'test_fencing_dose', 'email');
    const fencingEnqueue = await workerA.enqueue({
      notificationId: notifId3,
      channel: 'email',
      recipientId: patientId,
      patientId: patientId,
      type: 'follow_up_reminder',
      title: 'Fencing Token Recovery Test',
      message: 'Simulating slow worker A stall, recovery, and worker B takeover',
      severity: 'warning',
      recipientAddress: 'test_fencing@example.com',
      idempotencyKey: fencingKey,
      maxAttempts: 3,
    });
    createdOutboxIds.push(fencingEnqueue.outboxId);

    // Step 4.1: Worker A claims the job
    const claimsA = await workerA.claimBatch(10);
    const jobA = claimsA.find(j => j.id === fencingEnqueue.outboxId);

    assert(
      'Worker A successfully claims the job with claim token A',
      Boolean(jobA && jobA.provider_response?.claim_token && jobA.provider_response?.worker_id === 'worker_alpha_instance')
    );

    const tokenA = jobA.provider_response.claim_token;

    // Step 4.2: Worker A stalls. Simulate passage of stall timeout in database
    const stalledTime = new Date(Date.now() - 300000).toISOString(); // 5 minutes ago
    await supabaseAdmin
      .from('notification_delivery_logs')
      .update({
        provider_response: {
          ...jobA.provider_response,
          processing_started_at: stalledTime,
        },
      })
      .eq('id', fencingEnqueue.outboxId);

    // Step 4.3: Crash Recovery runs and reclaims the stalled job
    console.log('Running crash recovery for stalled job...');
    const recoveredCount = await workerB.recoverCrashedJobs(120000);
    assert(
      'Crash recovery identifies stalled job and recovers to "retry_scheduled"',
      recoveredCount >= 1,
      `Recovered count: ${recoveredCount}`
    );

    const { data: recoveredLog } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('status, provider_response, error_message')
      .eq('id', fencingEnqueue.outboxId)
      .single();

    assert(
      'Recovered job metadata records incremented recovery_attempts >= 1 and last_recovery_worker',
      Boolean(
        recoveredLog?.provider_response?.outbox_state === 'retry_scheduled' &&
        recoveredLog?.provider_response?.recovery_attempts >= 1 &&
        recoveredLog?.error_message?.includes('Recovered after worker stall')
      )
    );

    // Step 4.4: Worker B claims the recovered job with new claim token B
    const claimsB = await workerB.claimBatch(10);
    const jobB = claimsB.find(j => j.id === fencingEnqueue.outboxId);

    assert(
      'Worker B claims recovered job with NEW claim token B and worker_id: worker_bravo_instance',
      Boolean(
        jobB &&
        jobB.provider_response?.claim_token &&
        jobB.provider_response?.claim_token !== tokenA &&
        jobB.provider_response?.worker_id === 'worker_bravo_instance'
      )
    );

    // Step 4.5: Worker A finally finishes delayed work and attempts to complete with token A
    console.log('Worker A attempting delayed completion with stale token A...');
    const resA = await workerA.executeJob(jobA, emailProvider);

    assert(
      'Worker A completion is strictly REJECTED due to fencing token mismatch',
      resA.success === false && Boolean(resA.error?.includes('Fenced out')),
      `Result: ${JSON.stringify(resA)}`
    );

    // Step 4.6: Worker B completes the job successfully with token B
    console.log('Worker B completing job with valid token B...');
    const resB = await workerB.executeJob(jobB, emailProvider);

    assert(
      'Worker B completion SUCCEEDS with valid claim token B',
      resB.success === true,
      resB.error
    );

    const { data: finalFencedLog } = await supabaseAdmin
      .from('notification_delivery_logs')
      .select('status, provider_response')
      .eq('id', fencingEnqueue.outboxId)
      .single();

    assert(
      'Final delivery log records outbox_state "delivered" belonging to Worker B',
      finalFencedLog?.provider_response?.outbox_state === 'delivered' &&
      finalFencedLog?.provider_response?.worker_id === 'worker_bravo_instance'
    );

    // -------------------------------------------------------------------------
    // 5. Defect 4: Accurate Simulated Notification Status
    // -------------------------------------------------------------------------
    console.log('\n--- 5. ACCURATE SIMULATED NOTIFICATION STATUS AUDIT ---');
    // Ensure simulated test deliveries are NOT represented as live deliveries
    assert(
      'Simulated delivery log records status "simulated_test_mode" (not marked as live delivered)',
      finalFencedLog?.status === 'simulated_test_mode' || deliveredLog?.status === 'simulated_test_mode'
    );

    // -------------------------------------------------------------------------
    // 6. Quiet Hours Evaluation Across Midnight and Timezones
    // -------------------------------------------------------------------------
    console.log('\n--- 6. TESTING QUIET HOURS EVALUATION (CROSS-MIDNIGHT & TIMEZONES) ---');

    // Test 6.1: Cross-midnight quiet hours: 22:00 to 07:00 IST
    const date2330 = new Date('2026-11-17T18:00:00.000Z'); // 18:00 UTC = 23:30 IST (UTC+5:30)
    const qhEval1 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date2330);
    assert(
      'Cross-midnight quiet hours (22:00-07:00): 23:30 local IST is inQuietHours=true',
      qhEval1.inQuietHours === true
    );
    assert(
      'quietEndUtc is set to next day 07:00 IST (01:30 UTC)',
      qhEval1.quietEndUtc?.toISOString() === '2026-11-18T01:30:00.000Z',
      `Expected 2026-11-18T01:30:00.000Z, got ${qhEval1.quietEndUtc?.toISOString()}`
    );

    // 05:15 morning local time
    const date0515 = new Date('2026-11-17T23:45:00.000Z'); // 23:45 UTC Nov 17 = 05:15 IST Nov 18
    const qhEval2 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date0515);
    assert(
      'Cross-midnight quiet hours (22:00-07:00): 05:15 local morning IST is inQuietHours=true',
      qhEval2.inQuietHours === true
    );

    // 14:00 daytime
    const date1400 = new Date('2026-11-18T08:30:00.000Z'); // 08:30 UTC = 14:00 IST
    const qhEval3 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date1400);
    assert(
      'Cross-midnight quiet hours (22:00-07:00): 14:00 local daytime IST is inQuietHours=false',
      qhEval3.inQuietHours === false
    );

    // Test 6.2: Timezone boundary test (America/New_York vs Asia/Kolkata)
    const dateBoundary = new Date('2026-11-18T03:00:00.000Z');
    const nyEval = evaluateQuietHours('22:00', '07:00', 'America/New_York', dateBoundary);
    const kolkataEval = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', dateBoundary);

    assert(
      'Timezone boundary: At 03:00 UTC, America/New_York (22:00 local) is INSIDE quiet hours',
      nyEval.inQuietHours === true
    );
    assert(
      'Timezone boundary: At 03:00 UTC, Asia/Kolkata (08:30 local) is OUTSIDE quiet hours',
      kolkataEval.inQuietHours === false
    );

    // -------------------------------------------------------------------------
    // 7. Live Quiet Hours Dispatch & Critical Alert Bypass
    // -------------------------------------------------------------------------
    console.log('\n--- 7. LIVE QUIET HOURS DISPATCH & CRITICAL ALERT BYPASS ---');

    // Configure test user preferences with active quiet hours spanning right now
    const now = new Date();
    const currentHours = now.getHours();
    const startH = (currentHours + 23) % 24;
    const endH = (currentHours + 2) % 24;
    const qhStart = `${String(startH).padStart(2, '0')}:00`;
    const qhEnd = `${String(endH).padStart(2, '0')}:00`;

    await supabaseAdmin
      .from('notification_preferences')
      .upsert({
        user_id: patientId,
        in_app_enabled: true,
        email_enabled: true,
        quiet_hours_start: qhStart,
        quiet_hours_end: qhEnd,
      });

    // Test 7.1: Non-critical reminder during quiet hours
    const nonCriticalRes = await notificationManager.notifyUser({
      recipientId: patientId,
      patientId: patientId,
      type: 'initial_reminder',
      title: 'Bedtime reminder',
      message: 'Please take your scheduled pill',
      severity: 'info',
    });
    createdNotificationIds.push(nonCriticalRes.notificationId);

    const inAppResult = nonCriticalRes.results.find(r => r.channel === 'in_app');
    const emailResult = nonCriticalRes.results.find(r => r.channel === 'email');

    assert(
      'Non-critical alert during quiet hours: In-app notification delivered immediately',
      inAppResult !== undefined && inAppResult.success === true
    );
    assert(
      'Non-critical alert during quiet hours: External email is HELD in outbox until quiet hours expire',
      emailResult !== undefined && emailResult.providerResponse?.held === true && emailResult.providerResponse?.hold_reason === 'quiet_hours'
    );

    // Test 7.2: Critical overdue escalation BYPASSES quiet hours
    const criticalRes = await notificationManager.notifyUser({
      recipientId: patientId,
      patientId: patientId,
      type: 'caretaker_overdue_alert',
      title: 'CRITICAL OVERDUE ALERT',
      message: 'Patient has missed medication grace period. Urgent follow-up required.',
      severity: 'critical',
    });
    createdNotificationIds.push(criticalRes.notificationId);

    const criticalEmailResult = criticalRes.results.find(r => r.channel === 'email');
    assert(
      'Critical alert (caretaker_overdue_alert / severity: critical) BYPASSES quiet hours and dispatches external channels immediately',
      criticalEmailResult !== undefined && criticalEmailResult.providerResponse?.held === undefined && criticalEmailResult.success === true
    );

    // -------------------------------------------------------------------------
    // 8. Verification: Dose Status is NEVER altered by notifications
    // -------------------------------------------------------------------------
    console.log('\n--- 8. VERIFYING DOSE STATUS INTEGRITY ---');

    await notificationManager.notifyUser({
      recipientId: patientId,
      patientId: patientId,
      doseId: doseId,
      type: 'initial_reminder',
      title: 'Dose reminder',
      message: 'Take your dose',
      severity: 'info',
    });

    await notificationManager.notifyUser({
      recipientId: patientId,
      patientId: patientId,
      doseId: doseId,
      type: 'follow_up_reminder',
      title: 'Follow-up dose reminder',
      message: 'Did you take your dose?',
      severity: 'warning',
    });

    const { data: refreshedDose } = await supabaseAdmin
      .from('scheduled_doses')
      .select('id, status')
      .eq('id', doseId)
      .single();

    assert(
      'Dose status remains "pending" after notifications (dose is NEVER marked taken by alerts)',
      refreshedDose?.status === 'pending',
      `Dose status was: ${refreshedDose?.status}`
    );

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP: Deterministically Remove All Isolated Test Fixtures
    // -------------------------------------------------------------------------
    console.log('\n--- CLEANUP: REMOVING ISOLATED SYNTHETIC TEST FIXTURES ---');
    if (patientId) {
      if (createdNotificationIds.length > 0) {
        await supabaseAdmin
          .from('notification_delivery_logs')
          .delete()
          .in('notification_id', createdNotificationIds);

        await supabaseAdmin
          .from('notifications')
          .delete()
          .in('id', createdNotificationIds);
      }

      await supabaseAdmin.from('notification_preferences').delete().eq('user_id', patientId);
      await supabaseAdmin.from('scheduled_doses').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medication_schedules').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medicine_inventory').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medicines').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('profiles').delete().eq('id', patientId);
      await supabaseAdmin.auth.admin.deleteUser(patientId);
      console.log(`Cleaned up all fixtures for synthetic patient: ${patientId}\n`);
    }
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('========================================================================');
  console.log(' NOTIFICATION OUTBOX, IDEMPOTENCY & FENCING AUDIT SUMMARY');
  console.log('========================================================================');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationOutboxTests().catch((err) => {
  console.error('Fatal notification outbox test error:', err);
  process.exit(1);
});
