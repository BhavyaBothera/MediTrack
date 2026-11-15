import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { supabaseAdmin } from '../config/supabase';
import { UserRole } from '../types';

export function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Unauthorized: Authentication required' });
      return;
    }

    if (!allowedRoles.includes(req.user.role as UserRole)) {
      res.status(403).json({
        success: false,
        error: `Forbidden: Requires one of [${allowedRoles.join(', ')}] role`,
      });
      return;
    }

    next();
  };
}

/**
 * Checks whether the current user is either:
 * 1. The patient themselves (targetPatientId === req.user.id)
 * 2. An accepted caretaker for targetPatientId with required permission
 * 3. An admin
 */
export async function authorizePatientAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
  targetPatientId: string,
  requiredPermission?: 'can_edit_medicines' | 'can_confirm_doses'
): Promise<boolean> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return false;
  }

  // Admins have universal access
  if (user.role === 'admin') {
    return true;
  }

  // Patient accessing own data
  if (user.id === targetPatientId) {
    return true;
  }

  // Check caretaker authorization
  const { data: relationship, error } = await supabaseAdmin
    .from('patient_caretaker_relationships')
    .select(`
      id,
      status,
      caretaker_permissions (*)
    `)
    .eq('patient_id', targetPatientId)
    .eq('caretaker_id', user.id)
    .eq('status', 'accepted')
    .single();

  if (error || !relationship) {
    res.status(403).json({
      success: false,
      error: 'Forbidden: You do not have authorized caretaker access to this patient',
    });
    return false;
  }

  if (requiredPermission) {
    const rawPerms = (relationship as any).caretaker_permissions;
    const perms = Array.isArray(rawPerms) ? rawPerms[0] : rawPerms;
    if (!perms || !perms[requiredPermission]) {
      res.status(403).json({
        success: false,
        error: `Forbidden: Caretaker lacks required permission: ${requiredPermission}`,
      });
      return false;
    }
  }

  return true;
}

