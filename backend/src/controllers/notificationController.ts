import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { supabaseAdmin } from '../config/supabase';
import { notificationManager } from '../notifications/notificationManager';

export class NotificationController {
  async getNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .select(`
          *,
          delivery_logs:notification_delivery_logs (*)
        `)
        .eq('recipient_id', req.user!.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      res.json({ success: true, notifications: data || [] });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async markAsRead(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('recipient_id', req.user!.id);

      if (error) throw error;
      res.json({ success: true, message: 'Notification marked as read' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getPreferences(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { data, error } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('user_id', req.user!.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      res.json({
        success: true,
        preferences: data || {
          in_app_enabled: true,
          email_enabled: true,
          whatsapp_enabled: false,
          sms_enabled: false,
          push_enabled: true,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updatePreferences(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { in_app_enabled, email_enabled, whatsapp_enabled, sms_enabled, push_enabled, quiet_hours_start, quiet_hours_end, push_subscription } = req.body;

      const { data, error } = await supabaseAdmin
        .from('notification_preferences')
        .upsert({
          user_id: req.user!.id,
          in_app_enabled,
          email_enabled,
          whatsapp_enabled,
          sms_enabled,
          push_enabled,
          quiet_hours_start: quiet_hours_start || null,
          quiet_hours_end: quiet_hours_end || null,
          push_subscription: push_subscription || null,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();

      if (error) throw error;
      res.json({ success: true, preferences: data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getChannelStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const status = notificationManager.getChannelStatus();
      res.json({ success: true, channels: status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Safe test trigger: Allows immediate testing of notification delivery pipeline
   */
  async testTrigger(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { type, channel } = req.body;
      const notifType = type || 'initial_reminder';

      const result = await notificationManager.notifyUser({
        recipientId: req.user!.id,
        patientId: req.user!.id,
        type: notifType,
        title: `Test Alert: ${notifType.replace(/_/g, ' ').toUpperCase()}`,
        message: `This is a test notification from MediTrack system to verify notification delivery pipeline.`,
        severity: notifType.includes('overdue') ? 'critical' : 'info',
        channelsOverride: channel ? [channel] : undefined,
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const notificationController = new NotificationController();

