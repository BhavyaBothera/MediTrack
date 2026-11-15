import { supabaseAdmin } from '../config/supabase';
import { InAppProvider } from './inAppProvider';
import { EmailProvider } from './emailProvider';
import { WhatsAppProvider } from './whatsappProvider';
import { SMSProvider } from './smsProvider';
import { PushProvider } from './pushProvider';
import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';

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

    // 1. Fetch recipient profile and preferences
    const { data: recipient } = await supabaseAdmin
      .from('profiles')
      .select('id, email, phone')
      .eq('id', params.recipientId)
      .single();

    const { data: preferences } = await supabaseAdmin
      .from('notification_preferences')
      .select('*')
      .eq('user_id', params.recipientId)
      .single();

    // 2. Check quiet hours (unless critical)
    if (severity !== 'critical' && preferences?.quiet_hours_start && preferences?.quiet_hours_end) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = preferences.quiet_hours_start.split(':').map(Number);
      const [endH, endM] = preferences.quiet_hours_end.split(':').map(Number);
      const startMin = startH * 60 + startM;
      const endMin = endH * 60 + endM;

      let inQuietHours = false;
      if (startMin <= endMin) {
        inQuietHours = currentMinutes >= startMin && currentMinutes <= endMin;
      } else {
        inQuietHours = currentMinutes >= startMin || currentMinutes <= endMin;
      }

      if (inQuietHours) {
        console.log(`[NotificationManager] User ${params.recipientId} is in quiet hours. Suppressing non-critical alert.`);
      }
    }

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

    // 5. Dispatch to each provider
    for (const channel of targetChannels) {
      const provider = this.providers.get(channel);
      if (!provider) continue;

      let recipientAddress = recipient?.email;
      if (channel === 'whatsapp' || channel === 'sms') {
        recipientAddress = recipient?.phone;
      }

      const payload: NotificationPayload = {
        notificationId,
        recipientId: params.recipientId,
        patientId: params.patientId,
        type: params.type,
        title: params.title,
        message: params.message,
        severity,
        recipientAddress,
        metadata: {
          pushSubscription: preferences?.push_subscription,
        },
      };

      try {
        const res = await provider.send(payload);
        results.push(res);

        // Record in delivery logs
        await supabaseAdmin.from('notification_delivery_logs').insert({
          notification_id: notificationId,
          channel: res.channel,
          recipient_address: res.recipientAddress || null,
          status: res.isTestMode ? 'simulated_test_mode' : (res.success ? 'delivered' : 'failed'),
          attempts: 1,
          error_message: res.error || null,
          provider_response: res.providerResponse || null,
          delivered_at: res.success ? new Date().toISOString() : null,
        });
      } catch (sendErr: any) {
        console.error(`[NotificationManager] Error delivering via ${channel}:`, sendErr.message);
        results.push({
          channel: channel as any,
          success: false,
          isTestMode: false,
          error: sendErr.message,
        });

        await supabaseAdmin.from('notification_delivery_logs').insert({
          notification_id: notificationId,
          channel,
          recipient_address: recipientAddress || null,
          status: 'failed',
          attempts: 1,
          error_message: sendErr.message,
        });
      }
    }

    // Update overall notification status
    const anyDelivered = results.some(r => r.success);
    await supabaseAdmin
      .from('notifications')
      .update({ status: anyDelivered ? 'delivered' : 'failed' })
      .eq('id', notificationId);

    return { notificationId, results };
  }
}

export const notificationManager = new NotificationManager();

