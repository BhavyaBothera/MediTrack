import https from 'https';
import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { env } from '../config/env';

export class WhatsAppProvider implements NotificationProvider {
  channelName = 'whatsapp' as const;

  isConfigured(): boolean {
    return Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const recipient = payload.recipientAddress;
    if (!recipient) {
      return {
        channel: 'whatsapp',
        success: false,
        isTestMode: !this.isConfigured(),
        error: 'No recipient phone number provided',
      };
    }

    if (!this.isConfigured()) {
      console.log(`[WhatsAppProvider - TEST MODE] To: ${recipient} | Message: ${payload.title} - ${payload.message}`);
      return {
        channel: 'whatsapp',
        success: true,
        isTestMode: true,
        recipientAddress: recipient,
        providerResponse: { mode: 'test_simulation', preview: payload.message },
      };
    }

    return new Promise((resolve) => {
      const data = JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient.replace(/\D/g, ''),
        type: 'text',
        text: { body: `*${payload.title}*\n\n${payload.message}` },
      });

      const options = {
        hostname: 'graph.facebook.com',
        path: `/v19.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      };

      const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', chunk => responseBody += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              channel: 'whatsapp',
              success: true,
              isTestMode: false,
              recipientAddress: recipient,
              providerResponse: JSON.parse(responseBody || '{}'),
            });
          } else {
            resolve({
              channel: 'whatsapp',
              success: false,
              isTestMode: false,
              recipientAddress: recipient,
              error: `WhatsApp API status ${res.statusCode}: ${responseBody}`,
            });
          }
        });
      });

      req.on('error', (err) => {
        resolve({
          channel: 'whatsapp',
          success: false,
          isTestMode: false,
          recipientAddress: recipient,
          error: err.message,
        });
      });

      req.write(data);
      req.end();
    });
  }
}

