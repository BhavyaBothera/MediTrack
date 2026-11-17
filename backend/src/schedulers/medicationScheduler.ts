import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { scheduleService } from '../services/scheduleService';
import { notificationManager } from '../notifications/notificationManager';
import { notificationOutbox } from '../notifications/notificationOutbox';
import { formatTimeInTimezone } from '../utils/timezone';

export class MedicationScheduler {
  private isRunning = false;

  public start(): void {
    console.log('[MedicationScheduler] Initializing background medication cron jobs...');

    // 1. Daily dose generation job: runs every night at 00:05 (and also on startup)
    cron.schedule('5 0 * * *', async () => {
      console.log('[Scheduler] Running daily dose generation job...');
      try {
        await scheduleService.generateDailyDosesForAllPatients();
      } catch (err: any) {
        console.error('[Scheduler] Error generating daily doses:', err.message);
      }
    });

    // 2. Monitoring & Alert Engine: runs every 1 minute
    cron.schedule('* * * * *', async () => {
      if (this.isRunning) return; // Prevent overlapping runs
      this.isRunning = true;

      try {
        // Step A: Recover stalled outbox jobs from any crashed worker processes
        await notificationOutbox.recoverCrashedJobs();

        // Step B: Process pending / retrying / released outbox deliveries
        await notificationOutbox.processPending(notificationManager.getAllProviders());

        // Step C: Execute medication schedule checks
        await this.processMedicationChecks();
      } catch (err: any) {
        console.error('[MedicationScheduler] Error in monitoring cycle:', err.message);
      } finally {
        this.isRunning = false;
      }
    });

    // Also run immediate check on startup
    setTimeout(() => {
      scheduleService.generateDailyDosesForAllPatients().catch(e => console.error('[Init Sched]', e.message));
      this.processMedicationChecks().catch(e => console.error('[Init Check]', e.message));
    }, 3000);

    console.log('✓ [MedicationScheduler] Active and running independently of browser.');
  }

  /**
   * Main monitoring loop:
   * 1. Send Initial Reminders
   * 2. Send Follow-up Reminders
   * 3. Detect Expired Grace Periods -> Transition to Overdue -> Alert Caretakers!
   */
  public async processMedicationChecks(): Promise<void> {
    const now = new Date();
    const nowIso = now.toISOString();

    // -------------------------------------------------------------
    // Step 1: Initial Reminders (scheduled_timestamp <= now, initial_reminder_sent = false)
    // -------------------------------------------------------------
    const { data: initialDue, error: initErr } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        id,
        patient_id,
        medicine_id,
        scheduled_time,
        dose_quantity,
        status,
        medicines (name, prescribed_dosage, food_timing)
      `)
      .eq('status', 'pending')
      .eq('initial_reminder_sent', false)
      .lte('scheduled_timestamp', nowIso)
      .limit(50);

    if (!initErr && initialDue && initialDue.length > 0) {
      for (const dose of initialDue) {
        const med = (dose as any).medicines;
        const medName = med?.name || 'Medicine';
        const dosage = med?.prescribed_dosage || '';
        const food = med?.food_timing ? `(${med.food_timing.replace('_', ' ')})` : '';

        // Atomic database claim: only proceed if initial_reminder_sent is STILL false.
        // In a multi-instance deployment, this atomic conditional update acts as a distributed row-level lock.
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from('scheduled_doses')
          .update({ initial_reminder_sent: true })
          .eq('id', dose.id)
          .eq('initial_reminder_sent', false)
          .select('id');

        if (claimErr || !claimed || claimed.length === 0) {
          // Another instance or thread already claimed and sent this reminder
          continue;
        }

        try {
          await notificationManager.notifyUser({
            recipientId: dose.patient_id,
            patientId: dose.patient_id,
            doseId: dose.id,
            medicineId: dose.medicine_id,
            type: 'initial_reminder',
            title: `Time to take ${medName}`,
            message: `It is time for your scheduled medicine: ${medName} ${dosage} ${food}. Please take it and mark as taken in MediTrack.`,
            severity: 'info',
          });
        } catch (notifErr: any) {
          console.error(`[Scheduler] Failed to queue initial reminder for dose ${dose.id}:`, notifErr.message);
          // Rollback atomic claim so scheduler retries on subsequent cycle
          await supabaseAdmin
            .from('scheduled_doses')
            .update({ initial_reminder_sent: false })
            .eq('id', dose.id);
        }
      }
    }

    // -------------------------------------------------------------
    // Step 2: Follow-up Reminders (15 mins after scheduled time, follow_up_reminder_sent = false)
    // -------------------------------------------------------------
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

    const { data: followUpsDue } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        id,
        patient_id,
        medicine_id,
        scheduled_time,
        medicines (name, prescribed_dosage)
      `)
      .eq('status', 'pending')
      .eq('initial_reminder_sent', true)
      .eq('follow_up_reminder_sent', false)
      .lte('scheduled_timestamp', fifteenMinsAgo)
      .limit(50);

    if (followUpsDue && followUpsDue.length > 0) {
      for (const dose of followUpsDue) {
        const medName = (dose as any).medicines?.name || 'Medicine';

        // Atomic database claim: only proceed if follow_up_reminder_sent is STILL false.
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from('scheduled_doses')
          .update({ follow_up_reminder_sent: true })
          .eq('id', dose.id)
          .eq('follow_up_reminder_sent', false)
          .select('id');

        if (claimErr || !claimed || claimed.length === 0) {
          // Another instance already claimed and sent this follow-up reminder
          continue;
        }

        try {
          await notificationManager.notifyUser({
            recipientId: dose.patient_id,
            patientId: dose.patient_id,
            doseId: dose.id,
            medicineId: dose.medicine_id,
            type: 'follow_up_reminder',
            title: `Follow-up: Did you take ${medName}?`,
            message: `Friendly reminder: Your scheduled ${medName} was due at ${dose.scheduled_time}. If you haven't taken it yet, please take it now and mark it in MediTrack.`,
            severity: 'warning',
          });
        } catch (notifErr: any) {
          console.error(`[Scheduler] Failed to queue follow-up reminder for dose ${dose.id}:`, notifErr.message);
          // Rollback atomic claim so scheduler retries on subsequent cycle
          await supabaseAdmin
            .from('scheduled_doses')
            .update({ follow_up_reminder_sent: false })
            .eq('id', dose.id);
        }
      }
    }

    // -------------------------------------------------------------
    // Step 3: Grace Period Expired -> Transition to Overdue -> Alert Caretaker!
    // -------------------------------------------------------------
    const { data: overdueDoses } = await supabaseAdmin
      .from('scheduled_doses')
      .select(`
        id,
        patient_id,
        medicine_id,
        scheduled_time,
        grace_period_expires_at,
        caretaker_alert_sent,
        medicines (name, prescribed_dosage, food_timing),
        patient:profiles!scheduled_doses_patient_id_fkey (
          full_name,
          phone,
          timezone,
          emergency_contact_phone
        )
      `)
      .eq('status', 'pending')
      .lte('grace_period_expires_at', nowIso)
      .limit(50);

    if (overdueDoses && overdueDoses.length > 0) {
      for (const dose of overdueDoses) {
        const med = (dose as any).medicines;
        const patient = (dose as any).patient;
        const medName = med?.name || 'Medicine';
        const patientName = patient?.full_name || 'Your patient';

        // 1. Mark dose as overdue in database atomically:
        // Only proceed if status is STILL 'pending' and caretaker_alert_sent is false
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from('scheduled_doses')
          .update({
            status: 'overdue',
            caretaker_alert_sent: true,
          })
          .eq('id', dose.id)
          .eq('status', 'pending')
          .select('id');

        if (claimErr || !claimed || claimed.length === 0) {
          // Another instance or user action already transitioned this dose
          continue;
        }

        // 2. Alert the patient that dose is overdue
        await notificationManager.notifyUser({
          recipientId: dose.patient_id,
          patientId: dose.patient_id,
          doseId: dose.id,
          medicineId: dose.medicine_id,
          type: 'caretaker_overdue_alert',
          title: `OVERDUE MEDICATION: ${medName}`,
          message: `Grace period expired for ${medName} scheduled at ${dose.scheduled_time}. Your caretakers have been notified.`,
          severity: 'critical',
        });

        // 3. Find authorized caretakers for this patient with can_receive_overdue_alerts
        const { data: caretakers } = await supabaseAdmin
          .from('patient_caretaker_relationships')
          .select(`
            caretaker_id,
            caretaker_permissions (
              permission_level,
              can_receive_overdue_alerts,
              notification_channels
            )
          `)
          .eq('patient_id', dose.patient_id)
          .eq('status', 'accepted');

        if (caretakers && caretakers.length > 0) {
          const notifiedCaretakers = new Set<string>();
          for (const c of caretakers) {
            if (!c.caretaker_id || notifiedCaretakers.has(c.caretaker_id)) continue;
            const rawPerms = (c as any).caretaker_permissions;
            const perms = Array.isArray(rawPerms) ? rawPerms[0] : rawPerms;
            if (perms?.can_receive_overdue_alerts) {
              notifiedCaretakers.add(c.caretaker_id);
              const alertMessage = 
`MEDICATION ALERT

A scheduled medicine has not been confirmed as taken.

Patient: ${patientName}
Medicine: ${medName} (${med?.prescribed_dosage || ''})
Scheduled Time: ${dose.scheduled_time}
Grace Period Expired: ${formatTimeInTimezone(new Date(dose.grace_period_expires_at), patient?.timezone || 'Asia/Kolkata')}
Current Status: Unconfirmed

Please contact the patient to verify.`;

              await notificationManager.notifyUser({
                recipientId: c.caretaker_id,
                patientId: dose.patient_id,
                doseId: dose.id,
                medicineId: dose.medicine_id,
                type: 'caretaker_overdue_alert',
                title: `URGENT: ${patientName} has unconfirmed medicine (${medName})`,
                message: alertMessage,
                severity: 'critical',
                channelsOverride: perms.notification_channels,
              });
            }
          }
        }
      }
    }
  }
}

export const medicationScheduler = new MedicationScheduler();

