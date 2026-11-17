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
      providerResponse: { messageId: 'mock_smtp_ok_after_retry' },
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
  console.log(' MEDITRACK – P0.2 & P0.3 NOTIFICATION OUTBOX, RETRY & QUIET HOURS TEST');
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

  // Setup: Find or create a test patient profile
  const { data: testProfile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, phone, timezone')
    .limit(1)
    .single();

  if (profileErr || !testProfile) {
    throw new Error(`Failed to find test profile: ${profileErr?.message}`);
  }

  const patientId = testProfile.id;
  console.log(`Using test profile: ${testProfile.email || patientId} (Timezone: ${testProfile.timezone || 'Asia/Kolkata'})`);

  // -------------------------------------------------------------------------
  // 1. P0.2 State Machine: Queued -> Processing -> Delivered
  // -------------------------------------------------------------------------
  console.log('\n--- 1. TESTING OUTBOX STATE MACHINE: QUEUED -> PROCESSING -> DELIVERED ---');
  const dummyNotifId = (await supabaseAdmin.from('notifications').insert({
    recipient_id: patientId,
    patient_id: patientId,
    type: 'initial_reminder',
    title: 'Test Reminder',
    message: 'Test outbox delivery flow',
    severity: 'info',
    status: 'queued',
  }).select('id').single()).data!.id;

  const idempotencyKey1 = NotificationOutbox.generateIdempotencyKey('initial_reminder', patientId, 'test_dose_101', 'email');

  const enqueueRes = await notificationOutbox.enqueue({
    notificationId: dummyNotifId,
    channel: 'email',
    recipientId: patientId,
    patientId: patientId,
    type: 'initial_reminder',
    title: 'Test Reminder',
    message: 'Test outbox delivery flow',
    severity: 'info',
    recipientAddress: 'test@example.com',
    idempotencyKey: idempotencyKey1,
    maxAttempts: 3,
  });

  assert('Outbox enqueue succeeds with state "queued"', enqueueRes.state === 'queued');
  assert('Outbox enqueue is not marked duplicate on first call', enqueueRes.isDuplicate === false);

  // Test idempotency: enqueuing with identical key returns isDuplicate: true
  const duplicateRes = await notificationOutbox.enqueue({
    notificationId: dummyNotifId,
    channel: 'email',
    recipientId: patientId,
    patientId: patientId,
    type: 'initial_reminder',
    title: 'Test Reminder',
    message: 'Test outbox delivery flow',
    severity: 'info',
    recipientAddress: 'test@example.com',
    idempotencyKey: idempotencyKey1,
  });
  assert('Re-enqueuing with identical idempotency key detects duplicate and suppresses duplicate dispatch', duplicateRes.isDuplicate === true);

  // Claim batch
  const claimedJobs = await notificationOutbox.claimBatch(10);
  const claimedJob = claimedJobs.find(j => j.id === enqueueRes.outboxId);
  assert(
    'Atomic batch claim successfully claims queued outbox item into "processing" state',
    claimedJob !== undefined && claimedJob.provider_response?.outbox_state === 'processing'
  );

  // Execute job with successful provider
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
    .eq('id', enqueueRes.outboxId)
    .single();

  assert(
    'Job status in DB updated to delivered/simulated_test_mode with outbox_state "delivered"',
    (deliveredLog?.status === 'delivered' || deliveredLog?.status === 'simulated_test_mode') &&
    deliveredLog?.provider_response?.outbox_state === 'delivered' &&
    !!deliveredLog?.delivered_at
  );

  // -------------------------------------------------------------------------
  // 2. P0.2 Bounded Exponential Backoff & Dead Letter State Machine
  // -------------------------------------------------------------------------
  console.log('\n--- 2. TESTING BOUNDED EXPONENTIAL BACKOFF & DEAD LETTER TRANSITION ---');
  const dummyNotifId2 = (await supabaseAdmin.from('notifications').insert({
    recipient_id: patientId,
    patient_id: patientId,
    type: 'initial_reminder',
    title: 'Test Transient Failure',
    message: 'Testing backoff and retries',
    severity: 'warning',
    status: 'queued',
  }).select('id').single()).data!.id;

  const retryIdempotencyKey = NotificationOutbox.generateIdempotencyKey('initial_reminder', patientId, 'test_dose_102', 'email');
  const retryEnqueue = await notificationOutbox.enqueue({
    notificationId: dummyNotifId2,
    channel: 'email',
    recipientId: patientId,
    patientId: patientId,
    type: 'initial_reminder',
    title: 'Test Transient Failure',
    message: 'Testing backoff and retries',
    severity: 'warning',
    recipientAddress: 'test@example.com',
    idempotencyKey: retryIdempotencyKey,
    maxAttempts: 2, // 2 attempts before dead_letter
  });

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
    'Delivery log records outbox_state "retry_scheduled" and incremented attempt count',
    Boolean(retryLog1?.provider_response?.outbox_state === 'retry_scheduled' && retryLog1?.attempts === 1)
  );

  // Attempt 2 (exhausting max attempts = 2) -> dead_letter
  const deadLetterJob = {
    ...retryJob,
    attempts: 1,
    provider_response: retryLog1?.provider_response,
  };
  const failRes2 = await notificationOutbox.executeJob(deadLetterJob, mockFailing);

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
  // 3. P0.2 Crash Recovery: Stalled Processing Jobs
  // -------------------------------------------------------------------------
  console.log('\n--- 3. TESTING WORKER CRASH RECOVERY ---');
  // Simulate a crashed job by inserting a log in 'processing' state with a timestamp in the past
  const dummyNotifId3 = (await supabaseAdmin.from('notifications').insert({
    recipient_id: patientId,
    patient_id: patientId,
    type: 'follow_up_reminder',
    title: 'Test Stalled Worker',
    message: 'Simulating crashed worker recovery',
    severity: 'warning',
    status: 'queued',
  }).select('id').single()).data!.id;

  const stalledStartedAt = new Date(Date.now() - 300000).toISOString(); // 5 minutes ago
  const { data: stalledLog } = await supabaseAdmin
    .from('notification_delivery_logs')
    .insert({
      notification_id: dummyNotifId3,
      channel: 'email',
      recipient_address: 'crash_test@example.com',
      status: 'pending',
      attempts: 1,
      provider_response: {
        outbox_state: 'processing',
        idempotency_key: 'notif:crashed:worker:email',
        attempts: 1,
        max_attempts: 3,
        next_retry_at: stalledStartedAt,
        processing_started_at: stalledStartedAt,
        worker_id: 'dead_worker_pid_99999',
      },
    })
    .select('id')
    .single();

  // Run crash recovery with 120s timeout threshold
  const recoveredCount = await notificationOutbox.recoverCrashedJobs(120000);
  assert(
    'Crash recovery scans for stalled jobs and returns recovered count >= 1',
    recoveredCount >= 1,
    `Recovered: ${recoveredCount}`
  );

  const { data: recoveredLog } = await supabaseAdmin
    .from('notification_delivery_logs')
    .select('status, provider_response, error_message')
    .eq('id', stalledLog!.id)
    .single();

  assert(
    'Stalled job was successfully reclaimed to "retry_scheduled" with crash recovery notice',
    Boolean(
      recoveredLog?.provider_response?.outbox_state === 'retry_scheduled' &&
      recoveredLog?.error_message?.includes('Recovered after worker stall / crash')
    )
  );

  // -------------------------------------------------------------------------
  // 4. P0.3 Quiet Hours Evaluation Across Midnight and Timezones
  // -------------------------------------------------------------------------
  console.log('\n--- 4. TESTING QUIET HOURS EVALUATION (CROSS-MIDNIGHT & TIMEZONES) ---');

  // Test 4.1: Cross-midnight quiet hours: 22:00 to 07:00 IST
  // Simulating 23:30 local time (should be in quiet hours)
  const date2330 = new Date('2026-11-17T18:00:00.000Z'); // 18:00 UTC = 23:30 IST (UTC+5:30)
  const qhEval1 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date2330);
  assert(
    'Cross-midnight quiet hours (22:00-07:00): 23:30 local IST is evaluated as inQuietHours=true',
    qhEval1.inQuietHours === true
  );
  assert(
    'quietEndUtc is set to next day 07:00 IST (01:30 UTC)',
    qhEval1.quietEndUtc?.toISOString() === '2026-11-18T01:30:00.000Z',
    `Expected 2026-11-18T01:30:00.000Z, got ${qhEval1.quietEndUtc?.toISOString()}`
  );

  // Simulating 05:15 morning local time (should be in quiet hours)
  const date0515 = new Date('2026-11-17T23:45:00.000Z'); // 23:45 UTC Nov 17 = 05:15 IST Nov 18
  const qhEval2 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date0515);
  assert(
    'Cross-midnight quiet hours (22:00-07:00): 05:15 local morning IST is inQuietHours=true',
    qhEval2.inQuietHours === true
  );

  // Simulating 14:00 daytime (should NOT be in quiet hours)
  const date1400 = new Date('2026-11-18T08:30:00.000Z'); // 08:30 UTC = 14:00 IST
  const qhEval3 = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', date1400);
  assert(
    'Cross-midnight quiet hours (22:00-07:00): 14:00 local daytime IST is inQuietHours=false',
    qhEval3.inQuietHours === false
  );

  // Test 4.2: Timezone boundary test (America/New_York vs Asia/Kolkata)
  // At 03:00 UTC Nov 18:
  // In New York (UTC-5): 22:00 Nov 17 (INSIDE quiet hours 22:00-07:00 NY)
  // In Kolkata (UTC+5:30): 08:30 Nov 18 (OUTSIDE quiet hours 22:00-07:00 IST)
  const dateBoundary = new Date('2026-11-18T03:00:00.000Z');
  const nyEval = evaluateQuietHours('22:00', '07:00', 'America/New_York', dateBoundary);
  const kolkataEval = evaluateQuietHours('22:00', '07:00', 'Asia/Kolkata', dateBoundary);

  assert(
    'Timezone boundary check: At 03:00 UTC, America/New_York is inside quiet hours',
    nyEval.inQuietHours === true
  );
  assert(
    'Timezone boundary check: At 03:00 UTC, Asia/Kolkata is outside quiet hours',
    kolkataEval.inQuietHours === false
  );

  // -------------------------------------------------------------------------
  // 5. P0.3 Live Quiet Hours Dispatch & Critical Alert Bypass
  // -------------------------------------------------------------------------
  console.log('\n--- 5. LIVE QUIET HOURS DISPATCH & CRITICAL ALERT BYPASS ---');

  // Configure test user preferences with active quiet hours spanning right now
  const now = new Date();
  const currentHours = now.getHours();
  // Set quiet hours window starting 1 hour ago and ending 2 hours from now
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

  // Test 5.1: Non-critical reminder during quiet hours
  // In-app is delivered immediately; email is HELD in outbox with hold_reason: quiet_hours
  const nonCriticalRes = await notificationManager.notifyUser({
    recipientId: patientId,
    patientId: patientId,
    type: 'initial_reminder',
    title: 'Bedtime reminder',
    message: 'Please take your scheduled pill',
    severity: 'info',
  });

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

  // Test 5.2: Critical overdue escalation BYPASSES quiet hours
  const criticalRes = await notificationManager.notifyUser({
    recipientId: patientId,
    patientId: patientId,
    type: 'caretaker_overdue_alert',
    title: 'CRITICAL OVERDUE ALERT',
    message: 'Patient has missed medication grace period. Urgent follow-up required.',
    severity: 'critical',
  });

  const criticalEmailResult = criticalRes.results.find(r => r.channel === 'email');
  assert(
    'Critical alert (caretaker_overdue_alert / severity: critical) BYPASSES quiet hours and dispatches external channels immediately',
    criticalEmailResult !== undefined && criticalEmailResult.providerResponse?.held === undefined && criticalEmailResult.success === true
  );

  // -------------------------------------------------------------------------
  // 6. Verification: Dose Status is NEVER altered by notifications
  // -------------------------------------------------------------------------
  console.log('\n--- 6. VERIFYING DOSE STATUS INTEGRITY ---');
  // Find an existing pending dose or create one with valid schedule reference
  let testDose: { id: string; status: string; patient_id: string } | null = null;
  const { data: existingDose } = await supabaseAdmin
    .from('scheduled_doses')
    .select('id, status, patient_id')
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (existingDose) {
    testDose = existingDose;
  } else {
    // Find or create schedule
    const { data: sched } = await supabaseAdmin
      .from('medication_schedules')
      .select('id, medicine_id, patient_id')
      .limit(1)
      .maybeSingle();

    if (sched) {
      const { data: newDose } = await supabaseAdmin
        .from('scheduled_doses')
        .insert({
          patient_id: sched.patient_id,
          medicine_id: sched.medicine_id,
          schedule_id: sched.id,
          scheduled_date: '2026-11-18',
          scheduled_time: '12:00:00',
          scheduled_timestamp: new Date().toISOString(),
          grace_period_expires_at: new Date(Date.now() + 1800000).toISOString(),
          dose_quantity: 1,
          status: 'pending',
        })
        .select('id, status, patient_id')
        .single();
      testDose = newDose;
    }
  }

  if (!testDose) {
    throw new Error('Unable to locate or provision a pending dose for integrity test');
  }

  // Dispatch initial reminder, follow-up reminder, and caretaker overdue alert
  await notificationManager.notifyUser({
    recipientId: testDose.patient_id,
    patientId: testDose.patient_id,
    doseId: testDose.id,
    type: 'initial_reminder',
    title: 'Dose reminder',
    message: 'Take your dose',
    severity: 'info',
  });

  await notificationManager.notifyUser({
    recipientId: testDose.patient_id,
    patientId: testDose.patient_id,
    doseId: testDose.id,
    type: 'follow_up_reminder',
    title: 'Follow-up dose reminder',
    message: 'Did you take your dose?',
    severity: 'warning',
  });

  // Query the dose from the database
  const { data: refreshedDose } = await supabaseAdmin
    .from('scheduled_doses')
    .select('id, status')
    .eq('id', testDose.id)
    .single();

  assert(
    'Dose status remains "pending" after sending notifications (dose is NEVER marked taken by alerts)',
    refreshedDose?.status === 'pending',
    `Dose status was: ${refreshedDose?.status}`
  );

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(' P0.2 & P0.3 NOTIFICATION & QUIET HOURS TEST AUDIT SUMMARY');
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
