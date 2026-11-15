import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { supabaseAdmin } from '../config/supabase';

export class InAppProvider implements NotificationProvider {
  channelName = 'in_app' as const;

  isConfigured(): boolean {
    return true; // Always available
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    try {
      // In-app notifications are stored in public.notifications
      // Mark notification as delivered in DB
      await supabaseAdmin
        .from('notifications')
        .update({ status: 'delivered' })
        .eq('id', payload.notificationId);

      return {
        channel: 'in_app',
        success: true,
        isTestMode: false,
        recipientAddress: payload.recipientId,
        providerResponse: { recorded: true },
      };
    } catch (err: any) {
      return {
        channel: 'in_app',
        success: false,
        isTestMode: false,
        error: err.message,
      };
    }
  }
}

