import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin, supabasePublic } from '../config/supabase';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const API_BASE = 'http://localhost:5000/api';

async function runApiConcurrencySuite() {
  assertSafeExecutionEnvironment('API Concurrency Test');

  console.log('========================================================================');
  console.log(' MEDITRACK – HTTP API CONCURRENCY & TRANSACTION INTEGRITY TEST SUITE');
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

  let patientId = '';

  try {
    // 1. SETUP: Create dedicated test patient & sign in to obtain valid JWT
    console.log('--- 1. SETTING UP TEST PATIENT & OBTAINING REAL JWT TOKEN ---');
    const testEmail = `api_concurrency_${Date.now()}@meditrack.local`;
    const password = 'Password@123';

    const { data: userAuth, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'API Concurrency Patient', role: 'patient' }
    });

    patientId = userAuth.user?.id || '';
    if (!patientId) {
      throw new Error(`Failed to create test user: ${authErr?.message}`);
    }

  await supabaseAdmin.from('profiles').insert({
    id: patientId,
    email: testEmail,
    full_name: 'API Concurrency Patient',
    role: 'patient',
    timezone: 'Asia/Kolkata',
  });

  // Sign in to get authentic Bearer token
  const { data: sessionData, error: loginErr } = await supabasePublic.auth.signInWithPassword({
    email: testEmail,
    password,
  });

  const token = sessionData.session?.access_token;
  if (!token) {
    throw new Error(`Failed to obtain JWT token: ${loginErr?.message}`);
  }
  console.log(`✓ Test patient authenticated successfully. JWT token obtained.`);

  // Create test medicine
  const { data: med, error: medErr } = await supabaseAdmin
    .from('medicines')
    .insert({
      patient_id: patientId,
      name: 'ApiConcurrency Tablet',
      medicine_type: 'tablet',
      prescribed_dosage: '25mg',
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

  // Initial stock: 10 tablets
  const initialStock = 10;
  const { data: inv } = await supabaseAdmin
    .from('medicine_inventory')
    .insert({
      medicine_id: med.id,
      patient_id: patientId,
      current_stock: initialStock,
      low_stock_threshold: 5,
      unit_name: 'tablets'
    })
    .select('*')
    .single();

  console.log(`Created test medicine "${med.name}" with initial stock: ${inv.current_stock} tablets`);

  // Create schedule & pending dose for Test 1
  const today = new Date().toISOString().split('T')[0];
  const { data: sched } = await supabaseAdmin
    .from('medication_schedules')
    .insert({
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_time: '12:00:00',
      dose_quantity: 1,
      grace_period_minutes: 30,
      is_active: true
    })
    .select('*')
    .single();

  const { data: dose1 } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: sched.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: '12:00:00',
      scheduled_timestamp: new Date().toISOString(),
      grace_period_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      dose_quantity: 1,
      status: 'pending'
    })
    .select('*')
    .single();

  console.log(`Created test dose: ${dose1.id} (Status: pending)\n`);

  // -------------------------------------------------------------------------
  // TEST 1: 10 Simultaneous Authenticated HTTP Requests to /api/doses/:id/take
  // -------------------------------------------------------------------------
  console.log('--- 2. TEST 1: 10 SIMULTANEOUS AUTHENTICATED HTTP API REQUESTS FOR SAME DOSE ---');
  const url = `${API_BASE}/doses/${dose1.id}/take`;
  console.log(`Sending 10 concurrent HTTP POST requests to ${url}...`);

  const requests = Array.from({ length: 10 }, (_, i) => 
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ notes: `Concurrent HTTP Request #${i + 1}` })
    }).then(async res => ({
      status: res.status,
      body: await res.json()
    }))
  );

  const responses = await Promise.all(requests);
  const statusCodes = responses.map(r => r.status);
  console.log(`HTTP Responses received:`, statusCodes);

  // All should be successful (HTTP 200) due to idempotent dose confirmation
  const all200 = responses.every(r => r.status === 200 && (r.body as any).success === true);
  assert('All 10 parallel HTTP requests returned HTTP 200 with success: true (Idempotent API)', all200);

  // Verify exactly 1 inventory transaction was created in DB
  const { data: txList1 } = await supabaseAdmin
    .from('inventory_transactions')
    .select('*')
    .eq('dose_id', dose1.id);

  console.log(`Inventory transactions recorded for dose ${dose1.id}: ${txList1?.length || 0}`);
  assert('Exactly ONE inventory deduction transaction was created across 10 concurrent HTTP calls', (txList1?.length || 0) === 1);

  // Verify stock decremented by exactly 1 unit
  const { data: invAfter1 } = await supabaseAdmin
    .from('medicine_inventory')
    .select('*')
    .eq('medicine_id', med.id)
    .single();

  console.log(`Stock level after 10 HTTP requests: ${invAfter1.current_stock} (Initial: ${initialStock})`);
  assert('Stock decremented by EXACTLY 1 unit (10 -> 9, strictly no duplicate deduction)', invAfter1.current_stock === initialStock - 1);

  // -------------------------------------------------------------------------
  // TEST 2: Two Different Doses Competing For The Final Inventory Unit
  // -------------------------------------------------------------------------
  console.log('\n--- 3. TEST 2: TWO DIFFERENT DOSES COMPETING FOR FINAL INVENTORY UNIT (RACE CONDITION) ---');
  // Set stock to exactly 1 tablet
  await supabaseAdmin
    .from('medicine_inventory')
    .update({ current_stock: 1, low_stock_alert_sent: false })
    .eq('id', inv.id);

  console.log('Set inventory stock to exactly 1 unit.');

  // Create two distinct schedules & doses for the same medicine
  const { data: schedA } = await supabaseAdmin
    .from('medication_schedules')
    .insert({
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_time: '18:00:00',
      dose_quantity: 1,
      grace_period_minutes: 30,
      is_active: true
    })
    .select('*')
    .single();

  const { data: schedB } = await supabaseAdmin
    .from('medication_schedules')
    .insert({
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_time: '21:00:00',
      dose_quantity: 1,
      grace_period_minutes: 30,
      is_active: true
    })
    .select('*')
    .single();

  const { data: doseA } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: schedA.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: '18:00:00',
      scheduled_timestamp: new Date().toISOString(),
      grace_period_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      dose_quantity: 1,
      status: 'pending'
    })
    .select('*')
    .single();

  const { data: doseB } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: schedB.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: '21:00:00',
      scheduled_timestamp: new Date().toISOString(),
      grace_period_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      dose_quantity: 1,
      status: 'pending'
    })
    .select('*')
    .single();

  console.log(`Created competing Dose A (${doseA.id}) and Dose B (${doseB.id}).`);
  console.log(`Firing simultaneous HTTP confirmations for Dose A and Dose B...`);

  const [resA, resB] = await Promise.all([
    fetch(`${API_BASE}/doses/${doseA.id}/take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }).then(async r => ({ status: r.status, body: await r.json() })),
    fetch(`${API_BASE}/doses/${doseB.id}/take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
    }).then(async r => ({ status: r.status, body: await r.json() })),
  ]);

  console.log(`Dose A Response: ${resA.status}, Dose B Response: ${resB.status}`);
  assert('Both competing dose confirmations returned HTTP 200 (Clinical ingestion preserved)', resA.status === 200 && resB.status === 200);

  // Check inventory stock level
  const { data: invAfterCompete } = await supabaseAdmin
    .from('medicine_inventory')
    .select('*')
    .eq('medicine_id', med.id)
    .single();

  console.log(`Inventory stock after competition: ${invAfterCompete.current_stock} (Expected: exactly 0, never negative)`);
  assert('Inventory stock was decremented to exactly 0 (No negative stock underflow)', invAfterCompete.current_stock === 0);

  // Check total quantity change across both competing transactions
  const { data: txCompete } = await supabaseAdmin
    .from('inventory_transactions')
    .select('*')
    .in('dose_id', [doseA.id, doseB.id]);

  console.log(`Recorded transactions for competing doses: ${txCompete?.length || 0}`);
  const totalDeducted = txCompete?.reduce((acc, t) => acc + Math.abs(Number(t.quantity_change)), 0) || 0;
  console.log(`Total physical units deducted: ${totalDeducted} (Initial stock was: 1)`);
  assert('Physical stock deducted equals EXACTLY 1 unit (Atomic conditional guard)', totalDeducted === 1);

  // -------------------------------------------------------------------------
  // TEST 3: Database Rollback & Constraints Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 4. TEST 3: POSTGRESQL CONSTRAINTS & ROLLBACK BEHAVIOR ---');

  // 3.1 Non-existent dose returns 404 and does NOT alter inventory
  const fakeDoseId = '00000000-0000-0000-0000-000000000000';
  const badRes = await fetch(`${API_BASE}/doses/${fakeDoseId}/take`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  });
  assert('Invalid dose confirmation fails cleanly with HTTP 404 (No partial modification)', badRes.status === 404);

  // 3.2 Database CHECK constraint: current_stock >= 0
  const { error: checkErr } = await supabaseAdmin
    .from('medicine_inventory')
    .update({ current_stock: -10 })
    .eq('id', inv.id);

  assert(
    'PostgreSQL strictly enforces CHECK (current_stock >= 0)',
    checkErr !== null && (checkErr.code === '23514' || checkErr.message.includes('check constraint')),
    checkErr?.message
  );

  // 3.3 Database UNIQUE constraint on idempotency_key
  const { error: uniqErr } = await supabaseAdmin
    .from('inventory_transactions')
    .insert({
      inventory_id: inv.id,
      medicine_id: med.id,
      patient_id: patientId,
      transaction_type: 'dose_deduction',
      quantity_change: -1,
      balance_after: 0,
      dose_id: dose1.id,
      idempotency_key: `dose_deduction_${dose1.id}`,
      performed_by: patientId
    });

  assert(
    'PostgreSQL strictly enforces UNIQUE (idempotency_key)',
    uniqErr !== null && (uniqErr.code === '23505' || uniqErr.message.includes('unique constraint')),
    uniqErr?.message
  );

  // 3.4 Database UNIQUE constraint on scheduled_doses (schedule_id, scheduled_date)
  const { error: dupDoseErr } = await supabaseAdmin
    .from('scheduled_doses')
    .insert({
      schedule_id: sched.id,
      medicine_id: med.id,
      patient_id: patientId,
      scheduled_date: today,
      scheduled_time: '12:00:00',
      scheduled_timestamp: new Date().toISOString(),
      grace_period_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      dose_quantity: 1,
      status: 'pending'
    });

  assert(
    'PostgreSQL strictly enforces UNIQUE (schedule_id, scheduled_date) preventing duplicate daily doses',
    dupDoseErr !== null && (dupDoseErr.code === '23505' || dupDoseErr.message.includes('unique constraint')),
    dupDoseErr?.message
  );
  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP TEST FIXTURES
    // -------------------------------------------------------------------------
    console.log('\n--- 5. CLEANING UP TEST FIXTURES ---');
    if (patientId) {
      await supabaseAdmin.from('inventory_transactions').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medication_logs').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('scheduled_doses').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medication_schedules').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medicine_inventory').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('medicines').delete().eq('patient_id', patientId);
      await supabaseAdmin.from('profiles').delete().eq('id', patientId);
      await supabaseAdmin.auth.admin.deleteUser(patientId);
      console.log('Cleaned up dedicated API concurrency test fixtures.\n');
    }
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('========================================================================');
  console.log(' HTTP API CONCURRENCY & TRANSACTION INTEGRITY SUMMARY');
  console.log('========================================================================');
  console.log(`Tests Passed: ${passed}`);
  console.log(`Tests Failed: ${failed}`);
  console.log(`Success Rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runApiConcurrencySuite().catch(err => {
  console.error('Fatal API concurrency test error:', err);
  process.exit(1);
});
