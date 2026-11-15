import webpush from 'web-push';
import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { env } from '../config/env';

export class PushProvider implements NotificationProvider {
  channelName = 'push' as const;

  constructor() {
    if (this.isConfigured()) {
      webpush.setVapidDetails(
        env.VAPID_SUBJECT,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const subscription = payload.metadata?.pushSubscription;

    if (!subscription) {
      return {
        channel: 'push',
        success: false,
        isTestMode: !this.isConfigured(),
        error: 'No push subscription found for user',
      };
    }

    if (!this.isConfigured()) {
      console.log(`[PushProvider - TEST MODE] Push to: ${payload.recipientId} | ${payload.title}: ${payload.message}`);
      return {
        channel: 'push',
        success: true,
        isTestMode: true,
        providerResponse: { mode: 'test_simulation' },
      };
    }

    try {
      const pushData = JSON.stringify({
        title: payload.title,
        body: payload.message,
        icon: '/assets/icons/icon-192x192.png',
        badge: '/assets/icons/badge-72x72.png',
        data: {
          url: '/#dashboard',
          notificationId: payload.notificationId,
          type: payload.type,
        },
      });

      await webpush.sendNotification(subscription, pushData);

      return {
        channel: 'push',
        success: true,
        isTestMode: false,
        providerResponse: { sent: true },
      };
    } catch (err: any) {
      console.error('[PushProvider Error]', err.message);
      return {
        channel: 'push',
        success: false,
        isTestMode: false,
        error: err.message,
      };
    }
  }
}

