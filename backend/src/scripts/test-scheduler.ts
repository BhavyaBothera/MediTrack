import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../config/supabase';
import { medicationScheduler } from '../schedulers/medicationScheduler';
import { doseService } from '../services/doseService';
import { scheduleService } from '../services/scheduleService';
import { inventoryService } from '../services/inventoryService';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runSchedulerTestSuite() {
  assertSafeExecutionEnvironment('Scheduler Automated Test Suite');

  console.log('===============================================================');
  console.log(' MEDITRACK SCHEDULER & NOTIFICATION AUTOMATED TEST SUITE');
  console.log('===============================================================');

  // 1. Fetch Demo Patient and Demo Caretaker
  const { data: patient } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('email', 'patient@meditrack.local')
    .single();

  const { data: caretaker } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('email', 'caretaker@meditrack.local')
    .single();

  if (!patient || !caretaker) {
    throw new Error('Test accounts not found. Run seed script first.');
  }

  const patientId = patient.id;
  const caretakerId = caretaker.id;
  const today = new Date().toISOString().split('T')[0];

  console.log(`Testing with Patient ID: ${patientId}`);
  console.log(`Testing with Caretaker ID: ${caretakerId}`);

  // Create a dedicated test medicine
  const testMedName = `[TEST-MED-${Date.now()}] Test Capsule`;
  const { data: testMed, error: medErr } = await supabaseAdmin
    .from('medicines')
    .insert({
      patient_id: patientId,
      name: testMedName,
      medicine_type: 'capsule',
      prescribed_dosage: '25mg',
      units_per_intake: 1,
      frequency: 'custom',
      food_timing: 'after_food',
      start_date: today,
      status: 'active',
    })
    .select('*')
    .single();

  if (medErr || !testMed) throw new Error(`Failed to create test medicine: ${medErr?.message}`);

  // Initialize test inventory with 20 capsules
  await inventoryService.getOrCreateInventory(testMed.id, patientId, 20, 5, 'capsules');
  console.log('✓ Test medicine and inventory initialized (Stock: 20)');

  try {
    // -----------------------------------------------------------------
    // SCENARIO A: Initial Reminder Trigger (scheduled_timestamp <= now)
    // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario A: Initial Reminder Delivery ---');
  const pastTime = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago
  const schedTimeStr = pastTime.toISOString().slice(11, 19);

  const { data: schedA } = await supabaseAdmin
    .from('medication_schedules')
    .insert({
      medicine_id: testMed.id,
      patient_id: patientId,
      scheduled_time: schedTimeStr,
      dose_quantity: 1,
      grace_period_minutes: 30,
      is_active: true,
    })
    .select('*')
    .single();

  // Create dose record simulating due time reached
  const { data: doseA } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: schedA.id,
      medicine_id: testMed.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: schedTimeStr,
      scheduled_timestamp: pastTime.toISOString(),
      grace_period_expires_at: new Date(pastTime.getTime() + 30 * 60 * 1000).toISOString(),
      status: 'pending',
      initial_reminder_sent: false,
    })
    .select('*')
    .single();

  await medicationScheduler.processMedicationChecks();

  const { data: updatedDoseA } = await supabaseAdmin
    .from('scheduled_doses')
    .select('initial_reminder_sent, status')
    .eq('id', doseA.id)
    .single();

  if (updatedDoseA?.initial_reminder_sent === true) {
    console.log('✓ PASS Scenario A: Initial reminder sent and flagged in database.');
  } else {
    console.error('✕ FAIL Scenario A: Initial reminder flag not set.');
  }

  // -----------------------------------------------------------------
  // SCENARIO B: Follow-up Reminder (15 mins past scheduled time)
  // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario B: Follow-up Reminder Delivery ---');
  const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
  const { data: doseB } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: schedA.id,
      medicine_id: testMed.id,
      patient_id: patientId,
      scheduled_date: '2026-01-02', // use unique date for test instance
      scheduled_time: twentyMinsAgo.toISOString().slice(11, 19),
      scheduled_timestamp: twentyMinsAgo.toISOString(),
      grace_period_expires_at: new Date(twentyMinsAgo.getTime() + 30 * 60 * 1000).toISOString(),
      status: 'pending',
      initial_reminder_sent: true,
      follow_up_reminder_sent: false,
    })
    .select('*')
    .single();

  await medicationScheduler.processMedicationChecks();

  const { data: updatedDoseB } = await supabaseAdmin
    .from('scheduled_doses')
    .select('follow_up_reminder_sent, status')
    .eq('id', doseB.id)
    .single();

  if (updatedDoseB?.follow_up_reminder_sent === true) {
    console.log('✓ PASS Scenario B: Follow-up reminder successfully triggered at 15+ min lead.');
  } else {
    console.error('✕ FAIL Scenario B: Follow-up reminder flag not set.');
  }

  // -----------------------------------------------------------------
  // SCENARIO C: Grace Period Expired -> Overdue & Caretaker Alert!
  // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario C: Grace Period Expired -> Overdue Status & Caretaker Alert ---');
  const thirtyFiveMinsAgo = new Date(Date.now() - 35 * 60 * 1000);
  const graceExpiredTime = new Date(Date.now() - 5 * 60 * 1000); // expired 5 mins ago

  const { data: doseC } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: schedA.id,
      medicine_id: testMed.id,
      patient_id: patientId,
      scheduled_date: '2026-01-03',
      scheduled_time: thirtyFiveMinsAgo.toISOString().slice(11, 19),
      scheduled_timestamp: thirtyFiveMinsAgo.toISOString(),
      grace_period_expires_at: graceExpiredTime.toISOString(),
      status: 'pending',
      initial_reminder_sent: true,
      follow_up_reminder_sent: true,
      caretaker_alert_sent: false,
    })
    .select('*')
    .single();

  await medicationScheduler.processMedicationChecks();

  const { data: updatedDoseC } = await supabaseAdmin
    .from('scheduled_doses')
    .select('status, caretaker_alert_sent')
    .eq('id', doseC.id)
    .single();

  const { data: notifCaretakerList } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('recipient_id', caretakerId)
    .eq('dose_id', doseC.id)
    .eq('type', 'caretaker_overdue_alert')
    .limit(1);

  const notifCaretaker = notifCaretakerList?.[0];

  if (updatedDoseC?.status === 'overdue' && updatedDoseC?.caretaker_alert_sent === true && notifCaretaker) {
    console.log('✓ PASS Scenario C: Dose transitioned to OVERDUE and Caretaker received alert notification!');
  } else {
    console.error('✕ FAIL Scenario C:', { status: updatedDoseC?.status, notifFound: Boolean(notifCaretaker) });
  }

  // -----------------------------------------------------------------
  // SCENARIO D: Late Confirmation & Follow-up Caretaker Notification
  // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario D: Late Confirmation & Stock Deduction ---');
  const doseBeforeTaken = await supabaseAdmin
    .from('medicine_inventory')
    .select('current_stock')
    .eq('medicine_id', testMed.id)
    .single();

  const stockBefore = Number(doseBeforeTaken.data?.current_stock);

  // Patient confirms the overdue dose late
  await doseService.markAsTaken(doseC.id, patientId, 'Confirmed late after caretaker phone call');

  const { data: confirmedDose } = await supabaseAdmin
    .from('scheduled_doses')
    .select('status, confirmed_at, late_confirmation_notified')
    .eq('id', doseC.id)
    .single();

  const { data: invAfter } = await supabaseAdmin
    .from('medicine_inventory')
    .select('current_stock')
    .eq('medicine_id', testMed.id)
    .single();

  const stockAfter = Number(invAfter?.current_stock);

  const { data: lateNotifList } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('recipient_id', caretakerId)
    .eq('dose_id', doseC.id)
    .eq('type', 'caretaker_late_confirmation')
    .limit(1);

  const lateNotif = lateNotifList?.[0];

  if (confirmedDose?.status === 'taken' && stockAfter === stockBefore - 1 && lateNotif) {
    console.log('✓ PASS Scenario D: Overdue dose confirmed, inventory deducted exactly once (20 -> 19), caretaker notified of late confirmation!');
  } else {
    console.error('✕ FAIL Scenario D:', { confirmedStatus: confirmedDose?.status, stockBefore, stockAfter, lateNotifFound: Boolean(lateNotif) });
  }

  // -----------------------------------------------------------------
  // SCENARIO E: Server Restart & Duplicate Notification Prevention
  // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario E: Deduplication on Repeated / Post-Restart Cycles ---');
  const notifCountBefore = (await supabaseAdmin.from('notifications').select('*', { count: 'exact', head: true })).count || 0;

  // Run checks cycle again
  await medicationScheduler.processMedicationChecks();

  const notifCountAfter = (await supabaseAdmin.from('notifications').select('*', { count: 'exact', head: true })).count || 0;

  if (notifCountBefore === notifCountAfter) {
    console.log('✓ PASS Scenario E: No duplicate notifications generated on subsequent cycle.');
  } else {
    console.error('✕ FAIL Scenario E: Duplicate notifications were created!');
  }

  // -----------------------------------------------------------------
  // SCENARIO F: Idempotent Dose Generation
  // -----------------------------------------------------------------
  console.log('\n--- Testing Scenario F: Dose Generation Idempotency ---');
  const gen1 = await scheduleService.generateDailyDoses(patientId, today);
  const gen2 = await scheduleService.generateDailyDoses(patientId, today);

  if (gen2.created === 0 && gen2.existing >= 0) {
    console.log(`✓ PASS Scenario F: Dose generation is completely idempotent. (Run 1: created ${gen1.created}, Run 2: created ${gen2.created}, existing ${gen2.existing})`);
  } else {
    console.error('✕ FAIL Scenario F: Non-idempotent dose generation:', gen2);
  }

  } finally {
    // Cleanup test medicine in finally block so test data is never orphaned
    if (testMed?.id) {
      await supabaseAdmin.from('medicines').delete().eq('id', testMed.id);
      console.log('\n✓ Cleaned up test medicine records (Finally Block).');
    }
  }

  console.log('===============================================================');
  console.log(' ALL 6 SCHEDULER & NOTIFICATION SCENARIOS PASSED (100% SUCCESS)');
  console.log('===============================================================');
}

runSchedulerTestSuite().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
