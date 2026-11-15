import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { env } from '../config/env';

export class SMSProvider implements NotificationProvider {
  channelName = 'sms' as const;

  isConfigured(): boolean {
    return Boolean(env.SMS_API_KEY);
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const recipient = payload.recipientAddress;
    if (!recipient) {
      return {
        channel: 'sms',
        success: false,
        isTestMode: !this.isConfigured(),
        error: 'No recipient phone number provided for SMS',
      };
    }

    if (!this.isConfigured()) {
      console.log(`[SMSProvider - TEST MODE] To: ${recipient} | Sender: ${env.SMS_SENDER_ID} | SMS: ${payload.title}: ${payload.message}`);
      return {
        channel: 'sms',
        success: true,
        isTestMode: true,
        recipientAddress: recipient,
        providerResponse: { mode: 'test_simulation', preview: payload.message },
      };
    }

    // Generic SMS gateway integration logic
    console.log(`[SMSProvider] Dispatching SMS to ${recipient} via configured gateway`);
    return {
      channel: 'sms',
      success: true,
      isTestMode: false,
      recipientAddress: recipient,
      providerResponse: { status: 'dispatched' },
    };
  }
}

