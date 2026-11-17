import { supabaseAdmin } from '../config/supabase';
import { MedicationSchedule, ScheduledDose } from '../types';
import { getTodayInTimezone, localToUtc } from '../utils/timezone';

export class ScheduleService {
  /**
   * Generates scheduled doses for a given patient and date (default: today in patient's timezone).
   * Safe and idempotent via DB unique constraint (schedule_id, scheduled_date).
   */
  async generateDailyDoses(patientId: string, targetDateStr?: string): Promise<{ created: number; existing: number }> {
    // Fetch patient's configured timezone
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('timezone')
      .eq('id', patientId)
      .single();

    const timeZone = profile?.timezone || 'Asia/Kolkata';
    const today = targetDateStr || getTodayInTimezone(timeZone);
    const targetDate = new Date(today + 'T00:00:00Z');

    // Fast path: check if doses already generated for today
    const { count } = await supabaseAdmin
      .from('scheduled_doses')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('scheduled_date', today);

    if (count && count > 0) {
      return { created: 0, existing: count };
    }
    
    // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat.
    // Our schema: 1=Mon, ..., 7=Sun
    const jsDay = targetDate.getUTCDay();
    const dayOfWeek = jsDay === 0 ? 7 : jsDay;

    // 1. Fetch all active schedules for active medicines for this patient
    const { data: schedules, error: schedError } = await supabaseAdmin
      .from('medication_schedules')
      .select(`
        id,
        medicine_id,
        patient_id,
        scheduled_time,
        dose_quantity,
        days_of_week,
        reminder_lead_minutes,
        follow_up_reminder_minutes,
        grace_period_minutes,
        is_active,
        medicines!inner (
          id,
          status,
          start_date,
          end_date
        )
      `)
      .eq('patient_id', patientId)
      .eq('is_active', true)
      .eq('medicines.status', 'active');

    if (schedError) {
      console.error('[ScheduleService] Error fetching schedules:', schedError);
      throw schedError;
    }

    if (!schedules || schedules.length === 0) {
      return { created: 0, existing: 0 };
    }

    let created = 0;
    let existing = 0;

    for (const schedule of schedules) {
      const med = (schedule as any).medicines;

      // Verify date falls within medicine start/end date
      if (med.start_date && today < med.start_date) continue;
      if (med.end_date && today > med.end_date) continue;

      // Verify day of week
      if (schedule.days_of_week && !schedule.days_of_week.includes(dayOfWeek)) {
        continue;
      }

      // Compute exact UTC timestamp according to patient's local timezone
      const scheduledTimestamp = localToUtc(today, schedule.scheduled_time, timeZone);
      const gracePeriodMinutes = schedule.grace_period_minutes || 30;
      const gracePeriodExpiresAt = new Date(scheduledTimestamp.getTime() + gracePeriodMinutes * 60 * 1000);

      // Insert scheduled_dose with ignoreDuplicates (idempotent)
      const { data, error } = await supabaseAdmin
        .from('scheduled_doses')
        .insert({
          schedule_id: schedule.id,
          medicine_id: schedule.medicine_id,
          patient_id: schedule.patient_id,
          scheduled_date: today,
          scheduled_time: schedule.scheduled_time,
          scheduled_timestamp: scheduledTimestamp.toISOString(),
          grace_period_expires_at: gracePeriodExpiresAt.toISOString(),
          status: 'pending',
          dose_quantity: schedule.dose_quantity,
        })
        .select('id')
        .single();

      if (error) {
        if (error.code === '23505') {
          // Unique violation: dose already generated
          existing++;
        } else {
          console.error(`[ScheduleService] Failed inserting dose for sched ${schedule.id}:`, error.message);
        }
      } else if (data) {
        created++;
      }
    }

    return { created, existing };
  }

  /**
   * Generates doses for ALL active patients for today (used by background cron).
   */
  async generateDailyDosesForAllPatients(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const { data: patients, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('role', 'patient')
      .eq('is_active', true);

    if (error || !patients) return;

    for (const p of patients) {
      await this.generateDailyDoses(p.id, today);
    }
  }
}

export const scheduleService = new ScheduleService();

