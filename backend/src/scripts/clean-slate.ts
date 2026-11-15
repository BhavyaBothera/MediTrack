import path from 'path';
import dotenv from 'dotenv';
import { supabaseAdmin } from '../config/supabase';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function cleanSlate() {
  console.log('--- Cleaning Patient Medicines & Doses (Clean Slate Mode) ---');

  const patientEmail = 'patient@meditrack.local';
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('email', patientEmail)
    .single();

  if (!profile) {
    console.log('No demo patient profile found. Clean slate already active.');
    return;
  }

  // Delete all medicines for this patient (cascades to schedules, inventory, doses)
  const { error: medErr } = await supabaseAdmin
    .from('medicines')
    .delete()
    .eq('patient_id', profile.id);

  if (medErr) {
    console.error('Error deleting medicines:', medErr.message);
  } else {
    console.log('✓ All previous demonstration medicines and dose records removed.');
  }

  // Delete prescriptions
  await supabaseAdmin.from('prescriptions').delete().eq('patient_id', profile.id);

  // Delete notifications
  await supabaseAdmin.from('notifications').delete().eq('recipient_id', profile.id);

  console.log('✓ Clean slate active! Patient account now has 0 medicines and 0 doses.');
  console.log('Patients can now manually add prescribed medicines based on their doctor prescription.');
}

cleanSlate().catch(console.error);

