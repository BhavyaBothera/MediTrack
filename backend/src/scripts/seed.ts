import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../config/supabase';
import { medicineService } from '../services/medicineService';
import { scheduleService } from '../services/scheduleService';
import { assertSafeExecutionEnvironment } from '../utils/environmentGuard';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function seed() {
  // Production Environment Guard: refuse to seed fictional mock data in production
  assertSafeExecutionEnvironment('Database Seed');

  console.log('--- MediTrack Development Setup & Verification Seed ---');
  const isEmpty = process.argv.includes('--empty');

  // 1. Create Patient User in Supabase Auth
  const patientEmail = 'patient@meditrack.local';
  const password = 'Password@123';

  console.log('Ensuring development demo patient user...');
  const { data: patientAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email: patientEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Patient (Test Account)', role: 'patient' },
  });
  if (createErr) {
    console.log(`createUser info: ${createErr.message}`);
  }

  let patientId = patientAuth?.user?.id;
  if (!patientId) {
    const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
    if (listErr) {
      console.log(`listUsers error: ${listErr.message}`);
    }
    patientId = listData?.users?.find(u => u.email === patientEmail)?.id;
  }
  if (!patientId) {
    const { data: prof, error: profErr } = await supabaseAdmin.from('profiles').select('id').eq('email', patientEmail).single();
    if (profErr) {
      console.log(`profiles select error: ${profErr.message}`);
    }
    patientId = prof?.id;
  }

  if (!patientId) {
    console.error('Failed to obtain patient ID');
    return;
  }

  // Ensure patient profile
  await supabaseAdmin.from('profiles').upsert({
    id: patientId,
    email: patientEmail,
    full_name: 'Demo Patient (Test Account)',
    phone: '+91 98765 43210',
    role: 'patient',
    timezone: 'Asia/Kolkata',
    emergency_contact_name: 'Demo Caretaker',
    emergency_contact_phone: '+91 98765 43211',
  });

  // Ensure notification preferences
  await supabaseAdmin.from('notification_preferences').upsert({
    user_id: patientId,
    in_app_enabled: true,
    email_enabled: true,
    whatsapp_enabled: true,
    sms_enabled: true,
    push_enabled: true,
  });

  // 2. Create Caretaker User
  const caretakerEmail = 'caretaker@meditrack.local';
  console.log('Ensuring development demo caretaker user...');
  const { data: cAuth } = await supabaseAdmin.auth.admin.createUser({
    email: caretakerEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Demo Caretaker (Test Account)', role: 'caretaker' },
  });

  let caretakerId = cAuth.user?.id;
  if (!caretakerId) {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
    caretakerId = listData?.users.find(u => u.email === caretakerEmail)?.id;
  }
  if (!caretakerId) {
    const { data: prof } = await supabaseAdmin.from('profiles').select('id').eq('email', caretakerEmail).single();
    caretakerId = prof?.id;
  }

  if (caretakerId) {
    await supabaseAdmin.from('profiles').upsert({
      id: caretakerId,
      email: caretakerEmail,
      full_name: 'Demo Caretaker (Test Account)',
      phone: '+91 98765 43211',
      role: 'caretaker',
      timezone: 'Asia/Kolkata',
    });

    await supabaseAdmin.from('notification_preferences').upsert({
      user_id: caretakerId,
      in_app_enabled: true,
      email_enabled: true,
      whatsapp_enabled: true,
      sms_enabled: true,
      push_enabled: true,
    });

    // 3. Establish Caretaker Relationship (Deduplicated)
    const { data: existingRel } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select('id')
      .eq('patient_id', patientId)
      .eq('caretaker_id', caretakerId)
      .limit(1);

    let relId = existingRel?.[0]?.id;

    if (!relId) {
      const { data: newRel } = await supabaseAdmin
        .from('patient_caretaker_relationships')
        .insert({
          patient_id: patientId,
          caretaker_id: caretakerId,
          invite_email: caretakerEmail,
          relationship_type: 'Primary Caregiver (Family)',
          status: 'accepted',
        })
        .select('id')
        .single();
      relId = newRel?.id;
    }

    if (relId) {
      await supabaseAdmin.from('caretaker_permissions').upsert({
        relationship_id: relId,
        permission_level: 'primary',
        can_receive_overdue_alerts: true,
        can_receive_missed_alerts: true,
        can_receive_stock_alerts: true,
        can_receive_daily_summary: true,
        can_receive_weekly_reports: true,
        can_edit_medicines: true,
        can_confirm_doses: true,
        notification_channels: ['in_app', 'email', 'whatsapp', 'sms'],
      });
    }
  }

  // Clear any existing medicines first so we don't duplicate
  await supabaseAdmin.from('medicines').delete().eq('patient_id', patientId);

  if (isEmpty) {
    console.log('✓ Seeding complete in EMPTY mode. Patient account starts with 0 medicines.');
    return;
  }

  // 4. Seed clearly labeled FICTIONAL sample records for UI/UX testing
  console.log('Seeding clearly labeled fictional test medicines...');

  const fictionalSampleMedicines = [
    { name: '[DEMO] Sample Tablet Alpha', brand: 'DemoBrand-A', type: 'tablet', dosage: '50mg', food: 'before_food', time: '07:00:00', stock: 25, threshold: 5, qty: 1 },
    { name: '[DEMO] Sample Capsule Beta', brand: 'DemoBrand-B', type: 'capsule', dosage: '100mg', food: 'after_food', time: '08:00:00', stock: 30, threshold: 7, qty: 1 },
    { name: '[DEMO] Sample Tablet Gamma', brand: 'DemoBrand-C', type: 'tablet', dosage: '10mg', food: 'after_food', time: '09:00:00', stock: 20, threshold: 5, qty: 1 },
    { name: '[DEMO] Sample Syrup Delta', brand: 'DemoBrand-D', type: 'syrup', dosage: '5ml', food: 'with_food', time: '13:00:00', stock: 100, threshold: 20, qty: 5 },
    { name: '[DEMO] Sample Tablet Epsilon', brand: 'DemoBrand-E', type: 'tablet', dosage: '25mg', food: 'after_food', time: '20:00:00', stock: 30, threshold: 7, qty: 1 },
    { name: '[DEMO] Sample Nightcap Zeta', brand: 'DemoBrand-Z', type: 'tablet', dosage: '5mg', food: 'before_food', time: '22:00:00', stock: 4, threshold: 6, qty: 1 }, // Low stock test item!
  ];

  for (const m of fictionalSampleMedicines) {
    await medicineService.createMedicine(patientId, {
      name: m.name,
      brand_name: m.brand,
      medicine_type: m.type as any,
      prescribed_dosage: m.dosage,
      units_per_intake: m.qty,
      frequency: 'once_daily',
      food_timing: m.food as any,
      start_date: new Date().toISOString().split('T')[0],
      prescribing_doctor_name: 'Dr. Sample Physician (Demo Only - Fictional)',
      prescription_reference: 'DEMO-FICTIONAL-REF-001',
      additional_instructions: 'FICTIONAL DEMO RECORD - Take with water as prescribed by your real doctor.',
      initial_stock: m.stock,
      low_stock_threshold: m.threshold,
      schedules: [
        {
          scheduled_time: m.time,
          dose_quantity: m.qty,
          grace_period_minutes: 30,
        },
      ],
    }, patientId);
  }

  // 5. Generate daily doses
  const res = await scheduleService.generateDailyDoses(patientId);
  console.log(`✓ Generated ${res.created} test doses for today.`);

  console.log('\n======================================================');
  console.log(' MediTrack Setup Completed Successfully');
  console.log(' Mode: Clearly Labeled Fictional Demo Medicines');
  console.log(' Note: To reset patient to empty 0 medicines, run:');
  console.log('       npm run clean-slate');
  console.log('======================================================\n');
}

seed().catch(console.error);
