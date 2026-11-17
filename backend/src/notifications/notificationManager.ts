import { supabaseAdmin } from '../config/supabase';
import { InAppProvider } from './inAppProvider';
import { EmailProvider } from './emailProvider';
import { WhatsAppProvider } from './whatsappProvider';
import { SMSProvider } from './smsProvider';
import { PushProvider } from './pushProvider';
import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { notificationOutbox, NotificationOutbox } from './notificationOutbox';
import { localToUtc } from '../utils/timezone';

export interface QuietHoursEvaluation {
  inQuietHours: boolean;
  quietEndUtc?: Date;
  reason?: string;
}

/**
 * Accurately evaluates quiet hours across midnight and timezone boundaries.
 */
export function evaluateQuietHours(
  startStr?: string | null,
  endStr?: string | null,
  timeZone = 'Asia/Kolkata',
  now = new Date()
): QuietHoursEvaluation {
  if (!startStr || !endStr) {
    return { inQuietHours: false };
  }

  const [startH, startM] = startStr.split(':').map(Number);
  const [endH, endM] = endStr.split(':').map(Number);
  if (isNaN(startH) || isNaN(startM) || isNaN(endH) || isNaN(endM)) {
    return { inQuietHours: false };
  }

  const startTotalMinutes = startH * 60 + startM;
  const endTotalMinutes = endH * 60 + endM;

  // Format current time in user's timezone
  let parts: Intl.DateTimeFormatPart[];
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    parts = formatter.formatToParts(now);
  } catch (err) {
    // If invalid timezone, fallback to Asia/Kolkata
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    parts = formatter.formatToParts(now);
  }

  const p: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      p[part.type] = parseInt(part.value, 10);
    }
  }

  const localHour = p.hour === 24 ? 0 : p.hour;
  const localMinute = p.minute;
  const localTotalMinutes = localHour * 60 + localMinute;
  const todayDateStr = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

  let inQuiet = false;
  let quietEndLocalDay = todayDateStr;

  if (startTotalMinutes < endTotalMinutes) {
    // Daytime window within same calendar day (e.g. 13:00 to 15:00)
    inQuiet = localTotalMinutes >= startTotalMinutes && localTotalMinutes < endTotalMinutes;
    quietEndLocalDay = todayDateStr;
  } else if (startTotalMinutes > endTotalMinutes) {
    // Window spanning midnight (e.g. 22:00 to 07:00)
    if (localTotalMinutes >= startTotalMinutes) {
      inQuiet = true;
      const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
      quietEndLocalDay = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
    } else if (localTotalMinutes < endTotalMinutes) {
      inQuiet = true;
      quietEndLocalDay = todayDateStr;
    }
  }

  if (inQuiet) {
    const endFormatted = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}:00`;
    const quietEndUtc = localToUtc(quietEndLocalDay, endFormatted, timeZone);
    return {
      inQuietHours: true,
      quietEndUtc,
      reason: `Current time (${String(localHour).padStart(2, '0')}:${String(localMinute).padStart(2, '0')} ${timeZone}) is inside quiet hours ${startStr}-${endStr}`,
    };
  }

  return { inQuietHours: false };
}

export class NotificationManager {
  private providers: Map<string, NotificationProvider> = new Map();

  constructor() {
    this.registerProvider(new InAppProvider());
    this.registerProvider(new EmailProvider());
    this.registerProvider(new WhatsAppProvider());
    this.registerProvider(new SMSProvider());
    this.registerProvider(new PushProvider());
  }

  private registerProvider(provider: NotificationProvider) {
    this.providers.set(provider.channelName, provider);
  }

  public getAllProviders(): Map<string, NotificationProvider> {
    return this.providers;
  }

  public getProvider(channelName: string): NotificationProvider | undefined {
    return this.providers.get(channelName);
  }

  public getChannelStatus(): Record<string, { configured: boolean; mode: string }> {
    const status: Record<string, { configured: boolean; mode: string }> = {};
    for (const [name, provider] of this.providers.entries()) {
      const isConfig = provider.isConfigured();
      status[name] = {
        configured: isConfig,
        mode: isConfig ? 'LIVE' : (name === 'in_app' ? 'LIVE' : 'SIMULATED_TEST_MODE'),
      };
    }
    return status;
  }

  /**
   * Dispatches a notification to a user across their configured channels.
   * Handles:
   * - In-app immediate persistence
   * - Quiet-hour suppression / queueing for external channels
   * - Critical alert bypass
   * - Outbox queueing with atomic state transitions and idempotency
   */
  async notifyUser(params: {
    recipientId: string;
    patientId: string;
    type:
      | 'initial_reminder'
      | 'follow_up_reminder'
      | 'caretaker_overdue_alert'
      | 'caretaker_late_confirmation'
      | 'low_stock_alert'
      | 'refill_reminder'
      | 'system';
    title: string;
    message: string;
    severity?: 'info' | 'warning' | 'critical';
    doseId?: string;
    medicineId?: string;
    channelsOverride?: string[];
  }): Promise<{ notificationId: string; results: DeliveryResult[] }> {
    const severity = params.severity || 'info';
    const isCritical = severity === 'critical' || params.type === 'caretaker_overdue_alert';

    // 1. Fetch recipient profile and preferences
    const { data: recipient } = await supabaseAdmin
      .from('profiles')
      .select('id, email, phone, timezone')
      .eq('id', params.recipientId)
      .single();

    const { data: preferences } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', params.recipientId)
      .single();

    const recipientTimezone = recipient?.timezone || 'Asia/Kolkata';

    // 2. Evaluate quiet hours
    const quietEval = evaluateQuietHours(
      preferences?.quiet_hours_start,
      preferences?.quiet_hours_end,
      recipientTimezone,
      new Date()
    );

    // 3. Persist notification in database queue
    const { data: notifRecord, error: notifError } = await supabaseAdmin
      .from('notifications')
      .insert({
        recipient_id: params.recipientId,
        patient_id: params.patientId,
        dose_id: params.doseId || null,
        medicine_id: params.medicineId || null,
        type: params.type,
        title: params.title,
        message: params.message,
        severity,
        status: 'queued',
      })
      .select('id')
      .single();

    if (notifError || !notifRecord) {
      console.error('[NotificationManager] Failed to create notification record:', notifError);
      throw new Error(`Failed to queue notification: ${notifError?.message}`);
    }

    const notificationId = notifRecord.id;

    // 4. Determine channels to use
    let targetChannels: string[] = [];
    if (params.channelsOverride && params.channelsOverride.length > 0) {
      targetChannels = params.channelsOverride;
    } else {
      // In-app is always included
      targetChannels.push('in_app');
      if (preferences?.email_enabled !== false && recipient?.email) targetChannels.push('email');
      if (preferences?.whatsapp_enabled && recipient?.phone) targetChannels.push('whatsapp');
      if (preferences?.sms_enabled && recipient?.phone) targetChannels.push('sms');
      if (preferences?.push_enabled && preferences?.push_subscription) targetChannels.push('push');
    }

    const results: DeliveryResult[] = [];
    let hasHeld = false;

    // 5. Dispatch / enqueue per channel
    for (const channel of targetChannels) {
      const provider = this.providers.get(channel);
      if (!provider) continue;

      let recipientAddress = recipient?.email;
      if (channel === 'whatsapp' || channel === 'sms') {
        recipientAddress = recipient?.phone;
      }

      const idempotencyKey = NotificationOutbox.generateIdempotencyKey(
        params.type,
        params.recipientId,
        params.doseId,
        channel
      );

      // In-App Channel is delivered immediately to ensure the patient has the notification in their UI
      if (channel === 'in_app') {
        const payload: NotificationPayload = {
          notificationId,
          recipientId: params.recipientId,
          patientId: params.patientId,
          type: params.type,
          title: params.title,
          message: params.message,
          severity,
          recipientAddress,
        };

        try {
          const res = await provider.send(payload);
          results.push(res);

          await supabaseAdmin.from('notification_delivery_logs').insert({
            notification_id: notificationId,
            channel: 'in_app',
            recipient_address: null,
            status: res.isTestMode ? 'simulated_test_mode' : 'delivered',
            attempts: 1,
            provider_response: {
              outbox_state: 'delivered',
              idempotency_key: idempotencyKey,
              attempts: 1,
              max_attempts: 1,
              next_retry_at: new Date().toISOString(),
              delivered_at: new Date().toISOString(),
            },
            delivered_at: new Date().toISOString(),
          });
        } catch (inAppErr: any) {
          results.push({ channel: 'in_app', success: false, isTestMode: false, error: inAppErr.message });
        }
        continue;
      }

      // External Channels: Check Quiet Hours
      // Critical alerts bypass quiet hours; non-critical alerts are queued and held until quiet hours end
      if (!isCritical && quietEval.inQuietHours) {
        hasHeld = true;
        console.log(
          `[NotificationManager] User ${params.recipientId} in quiet hours (${preferences?.quiet_hours_start}-${preferences?.quiet_hours_end} ${recipientTimezone}). Holding ${channel} until ${quietEval.quietEndUtc?.toISOString()}.`
        );

        // Queue in outbox with holdUntil set to quietEndUtc
        const { outboxId } = await notificationOutbox.enqueue({
          notificationId,
          channel: channel as any,
          recipientId: params.recipientId,
          patientId: params.patientId,
          type: params.type,
          title: params.title,
          message: params.message,
          severity,
          recipientAddress,
          idempotencyKey,
          holdUntil: quietEval.quietEndUtc,
          holdReason: 'quiet_hours',
          metadata: {
            pushSubscription: preferences?.push_subscription,
          },
        });

        results.push({
          channel: channel as any,
          success: true,
          isTestMode: false,
          recipientAddress,
          providerResponse: {
            held: true,
            hold_reason: 'quiet_hours',
            outbox_id: outboxId,
            release_at: quietEval.quietEndUtc?.toISOString(),
          },
        });
        continue;
      }

      // External Channels: Immediate dispatch through persistent outbox
      try {
        const { outboxId, isDuplicate } = await notificationOutbox.enqueue({
          notificationId,
          channel: channel as any,
          recipientId: params.recipientId,
          patientId: params.patientId,
          type: params.type,
          title: params.title,
          message: params.message,
          severity,
          recipientAddress,
          idempotencyKey,
          metadata: {
            pushSubscription: preferences?.push_subscription,
          },
        });

        if (isDuplicate) {
          console.log(`[NotificationManager] Duplicate notification suppressed by idempotency key: ${idempotencyKey}`);
          continue;
        }

        // Claim and execute immediately
        const job = {
          id: outboxId,
          notification_id: notificationId,
          channel,
          recipient_address: recipientAddress,
          status: 'pending',
          attempts: 0,
          provider_response: {
            outbox_state: 'processing',
            idempotency_key: idempotencyKey,
            attempts: 0,
            max_attempts: 3,
            next_retry_at: new Date().toISOString(),
            worker_id: 'immediate_dispatch',
          },
          notification: {
            id: notificationId,
            recipient_id: params.recipientId,
            patient_id: params.patientId,
            type: params.type,
            title: params.title,
            message: params.message,
            severity,
          },
        };

        const execResult = await notificationOutbox.executeJob(job, provider, preferences?.push_subscription);
        results.push(execResult);
      } catch (sendErr: any) {
        console.error(`[NotificationManager] Error processing outbox for ${channel}:`, sendErr.message);
        results.push({
          channel: channel as any,
          success: false,
          isTestMode: false,
          error: sendErr.message,
        });
      }
    }

    // Update overall notification status in database
    const anyDelivered = results.some(r => r.success);
    const finalStatus = anyDelivered ? 'delivered' : (hasHeld ? 'queued' : 'failed');
    await supabaseAdmin
      .from('notifications')
      .update({ status: finalStatus })
      .eq('id', notificationId);

    return { notificationId, results };
  }
}

export const notificationManager = new NotificationManager();
