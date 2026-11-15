import { supabaseAdmin } from '../config/supabase';
import { inventoryService } from './inventoryService';
import { scheduleService } from './scheduleService';
import { notificationManager } from '../notifications/notificationManager';
import { ScheduledDose } from '../types';

export class DoseService {
  /**
   * Retrieves today's scheduled doses for a patient.
   * Automatically ensures doses are generated for today if not already present.
   */
  async getDailyDoses(patientId: string, targetDateStr?: string): Promise<ScheduledDose[]> {
    const targetDate = targetDateStr || new Date().toISOString().split('T')[0];

    // Ensure doses for today exist
    await scheduleService.generateDailyDoses(patientId, targetDate);

    const { data: doses, error } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        *,
        medicines (
          id,
          name,
          brand_name,
          medicine_type,
          prescribed_dosage,
          units_per_intake,
          frequency,
          food_timing,
          prescribing_doctor_name,
          additional_instructions,
          status
        )
      `)
      .eq('patient_id', patientId)
      .eq('scheduled_date', targetDate)
      .order('scheduled_time', { ascending: true });

    if (error) {
      console.error('[DoseService] Error fetching daily doses:', error);
      throw error;
    }

    return (doses || []).map(d => ({
      ...d,
      medicine: (d as any).medicines,
    }));
  }

  /**
   * Mark dose as Taken.
   * 1. Idempotency check: if already taken, return immediately.
   * 2. Update dose record in Supabase.
   * 3. Record confirmation timestamp.
   * 4. Deduct inventory exactly once.
   * 5. Record medication audit log.
   * 6. Notify caretakers if overdue alert was previously sent.
   */
  async markAsTaken(doseId: string, performedBy: string, notes?: string): Promise<ScheduledDose> {
    // 1. Fetch current dose
    const { data: dose, error: fetchErr } = await supabaseAdmin
      .from('scheduled_doses')
      .select('*, medicines (name)')
      .eq('id', doseId)
      .single();

    if (fetchErr || !dose) {
      throw new Error('Scheduled dose not found');
    }

    if (dose.status === 'taken') {
      console.log(`[DoseService] Dose ${doseId} is already marked as taken.`);
      return dose;
    }

    const previousStatus = dose.status;
    const now = new Date().toISOString();

    // 2. Update dose status in Supabase
    const { data: updatedDose, error: updateErr } = await supabaseAdmin
      .from('scheduled_doses')
      .update({
        status: 'taken',
        confirmed_at: now,
        confirmed_by: performedBy,
        late_confirmation_notified: dose.caretaker_alert_sent ? true : dose.late_confirmation_notified,
      })
      .eq('id', doseId)
      .select('*, medicines (*)')
      .single();

    if (updateErr || !updatedDose) {
      throw new Error(`Failed to confirm dose: ${updateErr?.message}`);
    }

    // 3. Log event in medication_logs
    await supabaseAdmin.from('medication_logs').insert({
      dose_id: dose.id,
      medicine_id: dose.medicine_id,
      patient_id: dose.patient_id,
      action: 'marked_taken',
      performed_by: performedBy,
      original_status: previousStatus,
      new_status: 'taken',
      notes: notes || (previousStatus === 'overdue' ? 'Confirmed after grace period' : 'Taken on schedule'),
    });

    // 4. Deduct inventory safely (idempotent)
    await inventoryService.deductStockForDose(updatedDose, performedBy);

    // 5. If an overdue alert was already sent to caretakers, send follow-up confirmation update
    if (dose.caretaker_alert_sent && !dose.late_confirmation_notified) {
      await this.sendLateConfirmationToCaretakers(updatedDose);
    }

    return {
      ...updatedDose,
      medicine: (updatedDose as any).medicines,
    };
  }

  /**
   * Skip a dose with mandatory reason.
   */
  async skipDose(doseId: string, performedBy: string, reason: string): Promise<ScheduledDose> {
    if (!reason || reason.trim().length === 0) {
      throw new Error('A reason is required to skip a scheduled dose');
    }

    const { data: dose, error: fetchErr } = await supabaseAdmin
      .from('scheduled_doses')
      .select('*')
      .eq('id', doseId)
      .single();

    if (fetchErr || !dose) {
      throw new Error('Scheduled dose not found');
    }

    const previousStatus = dose.status;

    const { data: updatedDose, error: updateErr } = await supabaseAdmin
      .from('scheduled_doses')
      .update({
        status: 'skipped',
        skip_reason: reason,
        confirmed_by: performedBy,
      })
      .eq('id', doseId)
      .select('*, medicines (*)')
      .single();

    if (updateErr || !updatedDose) {
      throw new Error(`Failed to skip dose: ${updateErr?.message}`);
    }

    await supabaseAdmin.from('medication_logs').insert({
      dose_id: dose.id,
      medicine_id: dose.medicine_id,
      patient_id: dose.patient_id,
      action: 'skipped',
      performed_by: performedBy,
      original_status: previousStatus,
      new_status: 'skipped',
      notes: reason,
    });

    return {
      ...updatedDose,
      medicine: (updatedDose as any).medicines,
    };
  }

  /**
   * Correct dose status (authorized correction with reason and audit log).
   */
  async correctDose(doseId: string, performedBy: string, newStatus: 'pending' | 'taken' | 'skipped' | 'missed', reason: string): Promise<ScheduledDose> {
    const { data: dose } = await supabaseAdmin
      .from('scheduled_doses')
      .select('*')
      .eq('id', doseId)
      .single();

    if (!dose) throw new Error('Dose not found');

    const prevStatus = dose.status;
    const { data: updated, error } = await supabaseAdmin
      .from('scheduled_doses')
      .update({
        status: newStatus,
        confirmed_by: performedBy,
        skip_reason: newStatus === 'skipped' ? reason : dose.skip_reason,
      })
      .eq('id', doseId)
      .select('*, medicines (*)')
      .single();

    if (error || !updated) throw new Error('Failed to correct dose status');

    // Audit log
    await supabaseAdmin.from('medication_logs').insert({
      dose_id: dose.id,
      medicine_id: dose.medicine_id,
      patient_id: dose.patient_id,
      action: 'corrected',
      performed_by: performedBy,
      original_status: prevStatus,
      new_status: newStatus,
      notes: `Manual status correction: ${reason}`,
    });

    return {
      ...updated,
      medicine: (updated as any).medicines,
    };
  }

  /**
   * Sends late confirmation update to caretakers
   */
  private async sendLateConfirmationToCaretakers(dose: any): Promise<void> {
    const medName = dose.medicines?.name || 'Medicine';
    const message = `UPDATE: Scheduled medicine "${medName}" (scheduled for ${dose.scheduled_time}) has now been confirmed as TAKEN.`;

    const { data: caretakers } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select(`
        caretaker_id,
        caretaker_permissions (
          can_receive_overdue_alerts,
          notification_channels
        )
      `)
      .eq('patient_id', dose.patient_id)
      .eq('status', 'accepted');

    if (caretakers) {
      const notifiedCaretakers = new Set<string>();
      for (const c of caretakers) {
        if (!c.caretaker_id || notifiedCaretakers.has(c.caretaker_id)) continue;
        notifiedCaretakers.add(c.caretaker_id);
        const rawPerms = (c as any).caretaker_permissions;
        const perms = Array.isArray(rawPerms) ? rawPerms[0] : rawPerms;
        await notificationManager.notifyUser({
          recipientId: c.caretaker_id,
          patientId: dose.patient_id,
          doseId: dose.id,
          medicineId: dose.medicine_id,
          type: 'caretaker_late_confirmation',
          title: `Medication Confirmed: ${medName}`,
          message,
          severity: 'info',
          channelsOverride: perms?.notification_channels,
        });
      }
    }
  }
}

export const doseService = new DoseService();

