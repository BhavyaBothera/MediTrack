import { supabaseAdmin } from '../config/supabase';
import { notificationManager } from '../notifications/notificationManager';
import { CaretakerPermissionLevel } from '../types';

export interface InviteCaretakerDTO {
  inviteEmail: string;
  invitePhone?: string;
  relationshipType?: string;
  permissionLevel: CaretakerPermissionLevel;
  canReceiveOverdueAlerts?: boolean;
  canReceiveMissedAlerts?: boolean;
  canReceiveStockAlerts?: boolean;
  canReceiveDailySummary?: boolean;
  canReceiveWeeklyReports?: boolean;
  canEditMedicines?: boolean;
  canConfirmDoses?: boolean;
  notificationChannels?: string[];
}

export class CaretakerService {
  /**
   * Patient invites a caretaker
   */
  async inviteCaretaker(patientId: string, data: InviteCaretakerDTO, patientName: string): Promise<any> {
    // Check if caretaker profile already exists for this email
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', data.inviteEmail)
      .single();

    // Insert relationship
    const { data: relationship, error: relError } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .insert({
        patient_id: patientId,
        caretaker_id: existingUser?.id || null,
        invite_email: data.inviteEmail,
        invite_phone: data.invitePhone || null,
        relationship_type: data.relationshipType || 'family',
        status: 'pending',
      })
      .select('*')
      .single();

    if (relError || !relationship) {
      throw new Error(`Failed to create caretaker invite: ${relError?.message}`);
    }

    // Insert permissions
    const { error: permError } = await supabaseAdmin
      .from('caretaker_permissions')
      .insert({
        relationship_id: relationship.id,
        permission_level: data.permissionLevel || 'primary',
        can_receive_overdue_alerts: data.canReceiveOverdueAlerts ?? true,
        can_receive_missed_alerts: data.canReceiveMissedAlerts ?? true,
        can_receive_stock_alerts: data.canReceiveStockAlerts ?? true,
        can_receive_daily_summary: data.canReceiveDailySummary ?? true,
        can_receive_weekly_reports: data.canReceiveWeeklyReports ?? true,
        can_edit_medicines: data.canEditMedicines ?? false,
        can_confirm_doses: data.canConfirmDoses ?? true,
        notification_channels: data.notificationChannels || ['in_app', 'email'],
      });

    if (permError) {
      console.error('[CaretakerService] Error setting permissions:', permError);
    }

    // Send invitation email or notification if user exists
    if (existingUser) {
      await notificationManager.notifyUser({
        recipientId: existingUser.id,
        patientId,
        type: 'system',
        title: 'Caretaker Invitation',
        message: `${patientName} has invited you to be their caretaker on MediTrack.`,
        severity: 'info',
      });
    }

    return relationship;
  }

  /**
   * List caretakers for a patient
   */
  async getPatientCaretakers(patientId: string): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select(`
        *,
        caretaker:profiles!patient_caretaker_relationships_caretaker_id_fkey (
          id,
          full_name,
          email,
          phone,
          avatar_url
        ),
        caretaker_permissions (*)
      `)
      .eq('patient_id', patientId);

    if (error) throw error;
    return data || [];
  }

  /**
   * List authorized patients for a caretaker
   */
  async getCaretakerPatients(caretakerId: string): Promise<any[]> {
    const { data, error } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select(`
        *,
        patient:profiles!patient_caretaker_relationships_patient_id_fkey (
          id,
          full_name,
          email,
          phone,
          avatar_url,
          emergency_contact_name,
          emergency_contact_phone
        ),
        caretaker_permissions (*)
      `)
      .eq('caretaker_id', caretakerId)
      .eq('status', 'accepted');

    if (error) throw error;
    return data || [];
  }

  /**
   * Accept an invitation
   */
  async acceptInvitation(inviteToken: string, caretakerUserId: string): Promise<any> {
    const { data: rel, error } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select('*')
      .eq('invite_token', inviteToken)
      .single();

    if (error || !rel) {
      throw new Error('Invalid or expired invitation token');
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .update({
        caretaker_id: caretakerUserId,
        status: 'accepted',
        responded_at: new Date().toISOString(),
      })
      .eq('id', rel.id)
      .select('*')
      .single();

    if (updateErr) throw updateErr;

    // Notify patient
    await notificationManager.notifyUser({
      recipientId: rel.patient_id,
      patientId: rel.patient_id,
      type: 'system',
      title: 'Caretaker Invitation Accepted',
      message: `Your caretaker invitation has been accepted.`,
      severity: 'info',
    });

    return updated;
  }

  /**
   * Revoke caretaker access immediately
   */
  async revokeCaretaker(relationshipId: string, patientId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .update({ status: 'revoked' })
      .eq('id', relationshipId)
      .eq('patient_id', patientId);

    if (error) throw error;
  }
}

export const caretakerService = new CaretakerService();

