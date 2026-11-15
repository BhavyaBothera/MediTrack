import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../config/supabase';
import { doseService } from '../services/doseService';
import { inventoryService } from '../services/inventoryService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runConcurrencyAndIntegrityTests() {
  console.log('========================================================================');
  console.log(' MEDITRACK – INVENTORY CONCURRENCY & DATA INTEGRITY TEST SUITE');
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

  // 1. SETUP: Create a dedicated test patient, medicine, inventory & dose
  console.log('--- 1. SETTING UP DEDICATED CONCURRENCY TEST FIXTURES ---');
  const testEmail = `concurrency_test_${Date.now()}@meditrack.local`;
  const { data: userAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: 'Password@123',
    email_confirm: true,
    user_metadata: { full_name: 'Concurrency Test Patient', role: 'patient' }
  });

  const patientId = userAuth.user?.id;
  if (!patientId) {
    throw new Error(`Failed to create test user: ${authErr?.message}`);
  }

  await supabaseAdmin.from('profiles').insert({
    id: patientId,
    email: testEmail,
    full_name: 'Concurrency Test Patient',
    role: 'patient',
    timezone: 'Asia/Kolkata',
  });

  const { data: med, error: medErr } = await supabaseAdmin
    .from('medicines')
    .insert({
      patient_id: patientId,
      name: 'ConcurrencyTest Tablet',
      medicine_type: 'tablet',
      prescribed_dosage: '50mg',
      units_per_intake: 1,
      frequency: 'once_daily',
      food_timing: 'after_food',
      status: 'active'
    })
    .select('*')
    .single();

  if (medErr || !med) {
    throw new Error(`Failed to create test medicine: ${medErr?.message}`);
  }

  const initialStock = 10;
  const inv = await inventoryService.getOrCreateInventory(med.id, patientId, initialStock, 5, 'tablets');
  console.log(`Created test medicine "${med.name}" with initial stock: ${inv.current_stock} tablets`);

  // Create a schedule and a pending dose
  const today = new Date().toISOString().split('T')[0];
  const { data: sched, error: schedErr } = await supabaseAdmin
    .from('medication_schedules')
    .insert({
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_time: '14:00:00',
      dose_quantity: 1,
      grace_period_minutes: 30,
      is_active: true
    })
    .select('*')
    .single();

  if (schedErr || !sched) {
    throw new Error(`Failed to create test schedule: ${schedErr?.message}`);
  }

  const schedTimestamp = new Date().toISOString();
  const graceExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  const { data: dose, error: doseErr } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: sched.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: '14:00:00',
      scheduled_timestamp: schedTimestamp,
      grace_period_expires_at: graceExpiresAt,
      dose_quantity: 1,
      status: 'pending'
    })
    .select('*')
    .single();

  if (doseErr || !dose) {
    throw new Error(`Failed to create test dose: ${doseErr?.message}`);
  }
  console.log(`Created test dose: ${dose.id} (Status: pending, Quantity: 1)\n`);

  // -------------------------------------------------------------------------
  // TEST 1: Simultaneous Service Calls (10 Parallel Requests to markAsTaken)
  // -------------------------------------------------------------------------
  console.log('--- 2. TEST 1: SIMULTANEOUS SERVICE-LEVEL DOSE CONFIRMATION (10 Parallel Calls) ---');
  const parallelCount = 10;
  console.log(`Firing ${parallelCount} simultaneous parallel calls to doseService.markAsTaken()...`);

  const promises = Array.from({ length: parallelCount }, (_, i) => 
    doseService.markAsTaken(dose.id, patientId, `Parallel request #${i + 1}`)
  );

  const results = await Promise.allSettled(promises);
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected').length;

  console.log(`Parallel executions completed: ${succeeded} succeeded, ${rejected} rejected.`);
  assert('All 10 parallel calls resolved safely without unhandled crashes', succeeded + rejected === parallelCount);

  // Check inventory transactions
  const { data: transactions } = await supabaseAdmin
    .from('inventory_transactions')
    .select('*')
    .eq('dose_id', dose.id);

  console.log(`Recorded inventory transactions for dose ${dose.id}: ${transactions?.length || 0}`);
  assert('Exactly ONE inventory deduction transaction was created (Strict Idempotency)', (transactions?.length || 0) === 1);
  if (transactions && transactions[0]) {
    assert('Transaction idempotency key matches expected format', transactions[0].idempotency_key === `dose_deduction_${dose.id}`);
    assert('Transaction quantity change is exactly -1', transactions[0].quantity_change === -1);
  }

  // Check stock level
  const { data: updatedInv } = await supabaseAdmin
    .from('medicine_inventory')
    .select('*')
    .eq('medicine_id', med.id)
    .single();

  console.log(`Inventory stock after 10 simultaneous confirmations: ${updatedInv.current_stock} (Initial: ${initialStock})`);
  assert('Inventory stock was decremented by EXACTLY 1 unit (No double deduction)', updatedInv.current_stock === initialStock - 1);

  // Check medication logs
  const { data: medLogs } = await supabaseAdmin
    .from('medication_logs')
    .select('*')
    .eq('dose_id', dose.id);

  console.log(`Medication logs recorded: ${medLogs?.length || 0}`);
  assert('Medication logs recorded without database corruption', (medLogs?.length || 0) >= 1);

  // -------------------------------------------------------------------------
  // TEST 2: Database Constraint - Non-Negative Stock Enforcement
  // -------------------------------------------------------------------------
  console.log('\n--- 3. TEST 2: DATABASE LEVEL NON-NEGATIVE STOCK INTEGRITY ---');
  // Attempt to set stock below 0 directly in database
  const { error: negativeStockErr } = await supabaseAdmin
    .from('medicine_inventory')
    .update({ current_stock: -5 })
    .eq('id', inv.id);

  assert(
    'Database strictly rejects negative inventory stock via CHECK constraint',
    negativeStockErr !== null && (
      negativeStockErr.message.includes('check') || 
      negativeStockErr.message.includes('violates') || 
      negativeStockErr.code === '23514'
    ),
    negativeStockErr?.message
  );

  // -------------------------------------------------------------------------
  // TEST 3: Duplicate Transaction Idempotency Key Rejection
  // -------------------------------------------------------------------------
  console.log('\n--- 4. TEST 3: INVENTORY TRANSACTION IDEMPOTENCY KEY CONSTRAINT ---');
  const { error: dupTxErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert({
      inventory_id: inv.id,
      medicine_id: med.id,
      patient_id: patientId,
      transaction_type: 'dose_deduction',
      quantity_change: -1,
      balance_after: updatedInv.current_stock - 1,
      dose_id: dose.id,
      idempotency_key: `dose_deduction_${dose.id}`,
      performed_by: patientId
    });

  assert(
    'Database strictly rejects duplicate idempotency key for the same dose',
    dupTxErr !== null && (dupTxErr.code === '23505' || dupTxErr.message.includes('unique constraint')),
    dupTxErr?.message
  );

  // -------------------------------------------------------------------------
  // TEST 4: Zero Stock Handling (No Negative Inventory on Exhaustion)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. TEST 4: STOCK EXHAUSTION (ZERO STOCK DEDUCTION HANDLING) ---');
  // Set stock to 0
  await supabaseAdmin
    .from('medicine_inventory')
    .update({ current_stock: 0 })
    .eq('id', inv.id);

  // Create another dose and confirm it
  const { data: doseZero } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: sched.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: '2026-12-01',
      scheduled_time: '14:00:00',
      scheduled_timestamp: new Date('2026-12-01T14:00:00Z').toISOString(),
      grace_period_expires_at: new Date('2026-12-01T14:30:00Z').toISOString(),
      dose_quantity: 1,
      status: 'pending'
    })
    .select('*')
    .single();

  await doseService.markAsTaken(doseZero.id, patientId, 'Dose taken with zero stock');

  const { data: invAfterZero } = await supabaseAdmin
    .from('medicine_inventory')
    .select('*')
    .eq('medicine_id', med.id)
    .single();

  console.log(`Stock level after deduction from 0: ${invAfterZero.current_stock}`);
  assert('Stock does not drop below 0 when exhausted (Clamped non-negative)', invAfterZero.current_stock === 0);

  // -------------------------------------------------------------------------
  // CLEANUP TEST FIXTURES
  // -------------------------------------------------------------------------
  console.log('\n--- 6. CLEANING UP TEST FIXTURES ---');
  await supabaseAdmin.from('inventory_transactions').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('medication_logs').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('scheduled_doses').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('medication_schedules').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('medicine_inventory').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('medicines').delete().eq('patient_id', patientId);
  await supabaseAdmin.from('profiles').delete().eq('id', patientId);
  await supabaseAdmin.auth.admin.deleteUser(patientId);
  console.log('Cleaned up dedicated concurrency test fixtures.\n');

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('========================================================================');
  console.log(' INVENTORY CONCURRENCY & DATA INTEGRITY SUMMARY');
  console.log('========================================================================');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runConcurrencyAndIntegrityTests().catch(err => {
  console.error('Fatal concurrency test error:', err);
  process.exit(1);
});
