import { Request, Response } from 'express';
import { supabaseAdmin, supabasePublic } from '../config/supabase';
import { AuthenticatedRequest } from '../middleware/auth';

export class AuthController {
  /**
   * Register new user (patient, caretaker, or admin)
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, fullName, phone, role, timezone, emergencyContactName, emergencyContactPhone } = req.body;

      if (!email || !password || !fullName) {
        res.status(400).json({ success: false, error: 'Email, password, and full name are required' });
        return;
      }

      const assignedRole = role === 'caretaker' || role === 'admin' ? role : 'patient';

      // 1. Create auth user via Supabase Admin
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // auto-confirm for immediate login
        user_metadata: { full_name: fullName, role: assignedRole },
      });

      if (authError || !authData.user) {
        res.status(400).json({ success: false, error: authError?.message || 'Failed to create user' });
        return;
      }

      const userId = authData.user.id;

      // 2. Insert record into public.profiles
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: userId,
          email,
          full_name: fullName,
          phone: phone || null,
          role: assignedRole,
          timezone: timezone || 'Asia/Kolkata',
          emergency_contact_name: emergencyContactName || null,
          emergency_contact_phone: emergencyContactPhone || null,
        })
        .select('*')
        .single();

      if (profileError) {
        console.error('[Auth Register] Error inserting profile:', profileError);
      }

      // 3. Create default notification preferences
      await supabaseAdmin.from('notification_preferences').insert({
        user_id: userId,
        in_app_enabled: true,
        email_enabled: true,
        whatsapp_enabled: false,
        sms_enabled: false,
        push_enabled: true,
      });

      // 4. Sign in to obtain session tokens
      const { data: sessionData, error: signinError } = await supabasePublic.auth.signInWithPassword({
        email,
        password,
      });

      res.status(201).json({
        success: true,
        message: 'Registration successful',
        user: profile || { id: userId, email, full_name: fullName, role: assignedRole },
        session: sessionData?.session,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Log in user
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ success: false, error: 'Email and password are required' });
        return;
      }

      const { data, error } = await supabasePublic.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        res.status(401).json({ success: false, error: error?.message || 'Invalid credentials' });
        return;
      }

      // Fetch profile
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      res.json({
        success: true,
        user: profile || {
          id: data.user.id,
          email: data.user.email,
          role: data.user.user_metadata?.role || 'patient',
          full_name: data.user.user_metadata?.full_name || 'User',
        },
        session: data.session,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Get current authenticated user profile
   */
  async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .eq('id', req.user.id)
        .single();

      res.json({
        success: true,
        user: profile || req.user,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Update profile
   */
  async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const { fullName, phone, timezone, emergencyContactName, emergencyContactPhone, avatarUrl } = req.body;

      const updateData: any = {};
      if (fullName) updateData.full_name = fullName;
      if (phone !== undefined) updateData.phone = phone;
      if (timezone) updateData.timezone = timezone;
      if (emergencyContactName !== undefined) updateData.emergency_contact_name = emergencyContactName;
      if (emergencyContactPhone !== undefined) updateData.emergency_contact_phone = emergencyContactPhone;
      if (avatarUrl !== undefined) updateData.avatar_url = avatarUrl;

      const { data: updated, error } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('id', req.user.id)
        .select('*')
        .single();

      if (error) throw error;

      res.json({ success: true, profile: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const authController = new AuthController();

