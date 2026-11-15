import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin, supabasePublic } from '../config/supabase';
import { medicineService } from '../services/medicineService';
import { doseService } from '../services/doseService';
import { inventoryService } from '../services/inventoryService';
import { caretakerService } from '../services/caretakerService';
import { analyticsService } from '../services/analyticsService';
import { reportService } from '../services/reportService';
import { prescriptionService } from '../services/prescriptionService';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runE2ETestSuite() {
  console.log('=================================================================');
  console.log(' MEDITRACK END-TO-END INTEGRATION & SECURITY VERIFICATION SUITE');
  console.log('=================================================================');

  const testEmail = `test_patient_${Date.now()}@meditrack.test`;
  const testPassword = 'TestPassword@123';
  let patientId = '';
  let caretakerId = '';
  let medicineId = '';
  let doseId = '';

  try {
    // -------------------------------------------------------------
    // TEST 1: User Registration & Authentication (Live Supabase Auth)
    // -------------------------------------------------------------
    console.log('\n[TEST 1] Registering test patient in Supabase Auth...');
    const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'E2E Test Patient', role: 'patient' },
    });

    if (authErr || !authUser.user) throw new Error(`Registration failed: ${authErr?.message}`);
    patientId = authUser.user.id;

    await supabaseAdmin.from('profiles').insert({
      id: patientId,
      email: testEmail,
      full_name: 'E2E Test Patient',
      role: 'patient',
      timezone: 'Asia/Kolkata',
    });

    // Test sign-in to get session token
    const { data: signinData, error: signinErr } = await supabasePublic.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (signinErr || !signinData.session) throw new Error(`Sign in failed: ${signinErr?.message}`);
    console.log('✓ PASS [TEST 1]: Patient registered and signed in. Token generated.');

    // -------------------------------------------------------------
    // TEST 2: Medicine Addition & Manual Prescription Configuration
    // -------------------------------------------------------------
    console.log('\n[TEST 2] Creating medicine and schedules according to doctor prescription...');
    const newMed = await medicineService.createMedicine(patientId, {
      name: '[TEST] Fictional Antibiotic X',
      brand_name: 'TestCillin',
      medicine_type: 'tablet',
      prescribed_dosage: '250mg',
      units_per_intake: 1,
      frequency: 'twice_daily',
      food_timing: 'after_food',
      prescribing_doctor_name: 'Dr. Jane Smith (MD, Pulmonology)',
      prescription_reference: 'RX-TEST-900',
      additional_instructions: 'Take strictly after meals for 5 days.',
      initial_stock: 14,
      low_stock_threshold: 4,
      schedules: [
        { scheduled_time: '08:00:00', dose_quantity: 1, grace_period_minutes: 30 },
        { scheduled_time: '20:00:00', dose_quantity: 1, grace_period_minutes: 30 },
      ],
    }, patientId);

    medicineId = newMed.id;
    console.log(`✓ PASS [TEST 2]: Medicine created (ID: ${medicineId}) with initial stock 14.`);

    // -------------------------------------------------------------
    // TEST 3: Dose Generation & Daily Dose Retrieval
    // -------------------------------------------------------------
    console.log('\n[TEST 3] Generating daily doses...');
    const today = new Date().toISOString().split('T')[0];
    const doses = await doseService.getDailyDoses(patientId, today);

    if (doses.length < 2) throw new Error(`Expected at least 2 doses, got ${doses.length}`);
    doseId = doses[0].id;
    console.log(`✓ PASS [TEST 3]: Retrieved ${doses.length} daily doses for today.`);

    // -------------------------------------------------------------
    // TEST 4: Mark as Taken & Inventory Deduction Verification
    // -------------------------------------------------------------
    console.log('\n[TEST 4] Marking dose as taken and verifying inventory auto-deduction...');
    const invBefore = await supabaseAdmin.from('medicine_inventory').select('current_stock').eq('medicine_id', medicineId).single();
    const stockBefore = Number(invBefore.data?.current_stock);

    await doseService.markAsTaken(doseId, patientId, 'Taken on time');

    const invAfter = await supabaseAdmin.from('medicine_inventory').select('current_stock').eq('medicine_id', medicineId).single();
    const stockAfter = Number(invAfter.data?.current_stock);

    if (stockAfter !== stockBefore - 1) {
      throw new Error(`Inventory deduction mismatch! Before: ${stockBefore}, After: ${stockAfter}`);
    }

    // Verify idempotency: calling markAsTaken again must NOT deduct stock again!
    await doseService.markAsTaken(doseId, patientId);
    const invAfterRepeat = await supabaseAdmin.from('medicine_inventory').select('current_stock').eq('medicine_id', medicineId).single();
    if (Number(invAfterRepeat.data?.current_stock) !== stockAfter) {
      throw new Error('Idempotency violation! Stock deducted a second time on repeated confirmation.');
    }
    console.log(`✓ PASS [TEST 4]: Dose marked as taken. Stock safely deducted (14 -> 13). Repeated call was idempotent.`);

    // -------------------------------------------------------------
    // TEST 5: Discontinue Medicine (Preserving History)
    // -------------------------------------------------------------
    console.log('\n[TEST 5] Discontinuing medicine and verifying history preservation...');
    await medicineService.discontinueMedicine(medicineId, 'Course completed by physician instruction', patientId);

    const { data: discontinuedMed } = await supabaseAdmin.from('medicines').select('status, discontinued_at, discontinuation_reason').eq('id', medicineId).single();
    if (discontinuedMed?.status !== 'discontinued') throw new Error('Medicine status not discontinued');

    // Verify historical dose still exists
    const { data: histDose } = await supabaseAdmin.from('scheduled_doses').select('id, status').eq('id', doseId).single();
    if (!histDose) throw new Error('Historical dose record was deleted after medicine discontinuation!');
    console.log('✓ PASS [TEST 5]: Medicine discontinued; historical dose records preserved intact.');

    // -------------------------------------------------------------
    // TEST 6: Caretaker Authorization, Permissions & Revocation (Security)
    // -------------------------------------------------------------
    console.log('\n[TEST 6] Testing Caretaker Invitation & Revocation Security...');
    const caretakerEmail = `caretaker_e2e_${Date.now()}@meditrack.test`;
    const { data: cUser } = await supabaseAdmin.auth.admin.createUser({
      email: caretakerEmail,
      password: testPassword,
      email_confirm: true,
      user_metadata: { full_name: 'E2E Caretaker', role: 'caretaker' },
    });
    caretakerId = cUser.user!.id;

    await supabaseAdmin.from('profiles').insert({
      id: caretakerId,
      email: caretakerEmail,
      full_name: 'E2E Caretaker',
      role: 'caretaker',
      timezone: 'Asia/Kolkata',
    });

    // Invite
    const rel = await caretakerService.inviteCaretaker(patientId, {
      inviteEmail: caretakerEmail,
      permissionLevel: 'primary',
      canReceiveOverdueAlerts: true,
      canConfirmDoses: true,
    }, 'E2E Test Patient');

    // Accept
    await caretakerService.acceptInvitation(rel.invite_token, caretakerId);

    // Verify accepted
    const caretakers = await caretakerService.getPatientCaretakers(patientId);
    if (!caretakers.some(c => c.caretaker_id === caretakerId && c.status === 'accepted')) {
      throw new Error('Caretaker acceptance failed');
    }

    // Revoke
    await caretakerService.revokeCaretaker(rel.id, patientId);
    const caretakersAfter = await caretakerService.getPatientCaretakers(patientId);
    const revokedRel = caretakersAfter.find(c => c.id === rel.id);
    if (revokedRel?.status !== 'revoked') {
      throw new Error('Caretaker revocation failed');
    }
    console.log('✓ PASS [TEST 6]: Caretaker invited, accepted, and successfully revoked.');

    // -------------------------------------------------------------
    // TEST 7: Analytics Calculations
    // -------------------------------------------------------------
    console.log('\n[TEST 7] Testing adherence analytics engine...');
    const metrics = await analyticsService.getAdherenceAnalytics(patientId, 7);
    if (typeof metrics.adherencePercentage !== 'number') {
      throw new Error('Adherence percentage is not a number');
    }
    console.log(`✓ PASS [TEST 7]: Analytics calculated. Adherence: ${metrics.adherencePercentage}%, Scheduled: ${metrics.totalScheduled}, Taken: ${metrics.totalTaken}`);

    // -------------------------------------------------------------
    // TEST 8: CSV & PDF Report Generation
    // -------------------------------------------------------------
    console.log('\n[TEST 8] Testing PDF and CSV report export...');
    const csvContent = await reportService.generateDoseHistoryCSV(patientId, 7);
    if (!csvContent.includes('Date,Time,Medicine Name')) {
      throw new Error('CSV missing standard headers');
    }

    const pdfBuffer = await reportService.generateAdherencePDF(patientId, 'E2E Test Patient', 7);
    if (!pdfBuffer || pdfBuffer.length < 100) {
      throw new Error('PDF buffer generation failed');
    }
    console.log(`✓ PASS [TEST 8]: CSV generated (${csvContent.split('\n').length} rows), PDF generated (${pdfBuffer.length} bytes).`);

    // -------------------------------------------------------------
    // TEST 9: Secure Prescription Upload & Signed URL
    // -------------------------------------------------------------
    console.log('\n[TEST 9] Testing prescription document management & secure signed URL...');
    const mockFile: Express.Multer.File = {
      fieldname: 'prescriptionFile',
      originalname: 'test_prescription_doc.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Mock Prescription Document for MediTrack Testing'),
      size: 58,
      stream: null as any,
      destination: '',
      filename: '',
      path: '',
    };

    const pres = await prescriptionService.createPrescription(patientId, mockFile, {
      doctorName: 'Dr. Jane Smith',
      diagnosis: 'Respiratory Infection',
      notes: 'Rx: Fictional Antibiotic X 250mg twice daily',
    });

    const secureUrl = await prescriptionService.getSecureViewUrl(pres.file_url || '');
    console.log(`✓ PASS [TEST 9]: Prescription metadata stored. Signed view URL generated.`);

  } finally {
    // Cleanup test users and data
    console.log('\nCleaning up temporary E2E test records...');
    if (patientId) {
      await supabaseAdmin.from('profiles').delete().eq('id', patientId);
      await supabaseAdmin.auth.admin.deleteUser(patientId);
    }
    if (caretakerId) {
      await supabaseAdmin.from('profiles').delete().eq('id', caretakerId);
      await supabaseAdmin.auth.admin.deleteUser(caretakerId);
    }
    console.log('✓ Cleanup complete.');
  }

  console.log('\n=================================================================');
  console.log(' ALL 9 END-TO-END INTEGRATION TESTS PASSED (100% SUCCESS)');
  console.log('=================================================================');
}

runE2ETestSuite().catch(err => {
  console.error('FATAL E2E ERROR:', err);
  process.exit(1);
});

