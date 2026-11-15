export interface NotificationPayload {
  notificationId: string;
  recipientId: string;
  patientId: string;
  type: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  recipientAddress?: string; // email, phone, push subscription
  metadata?: Record<string, any>;
}

export interface DeliveryResult {
  channel: 'in_app' | 'email' | 'whatsapp' | 'sms' | 'push';
  success: boolean;
  isTestMode: boolean;
  recipientAddress?: string;
  error?: string;
  providerResponse?: any;
}

export interface NotificationProvider {
  channelName: 'in_app' | 'email' | 'whatsapp' | 'sms' | 'push';
  isConfigured(): boolean;
  send(payload: NotificationPayload): Promise<DeliveryResult>;
}

