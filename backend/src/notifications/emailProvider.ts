import nodemailer from 'nodemailer';
import { NotificationProvider, NotificationPayload, DeliveryResult } from './provider.interface';
import { env } from '../config/env';

export class EmailProvider implements NotificationProvider {
  channelName = 'email' as const;
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (this.isConfigured()) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
  }

  async send(payload: NotificationPayload): Promise<DeliveryResult> {
    const recipient = payload.recipientAddress;
    if (!recipient) {
      return {
        channel: 'email',
        success: false,
        isTestMode: !this.isConfigured(),
        error: 'No recipient email provided',
      };
    }

    if (!this.isConfigured() || !this.transporter) {
      console.log(`[EmailProvider - TEST MODE] To: ${recipient} | Subject: ${payload.title} | Body: ${payload.message}`);
      return {
        channel: 'email',
        success: true,
        isTestMode: true,
        recipientAddress: recipient,
        providerResponse: { mode: 'test_simulation', preview: payload.message },
      };
    }

    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: ${payload.severity === 'critical' ? '#d32f2f' : '#1976d2'};">${payload.title}</h2>
          <p style="font-size: 16px; line-height: 1.5; color: #333;">${payload.message.replace(/\n/g, '<br>')}</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #777;">This is an automated notification from MediTrack Medicine Management System.</p>
        </div>
      `;

      const result = await this.transporter.sendMail({
        from: env.SMTP_FROM,
        to: recipient,
        subject: `MediTrack Alert: ${payload.title}`,
        text: payload.message,
        html,
      });

      return {
        channel: 'email',
        success: true,
        isTestMode: false,
        recipientAddress: recipient,
        providerResponse: { messageId: result.messageId },
      };
    } catch (err: any) {
      console.error('[EmailProvider Error]', err.message);
      return {
        channel: 'email',
        success: false,
        isTestMode: false,
        recipientAddress: recipient,
        error: err.message,
      };
    }
  }
}

