import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { doseService } from '../services/doseService';
import { authorizePatientAccess } from '../middleware/rbac';
import { supabaseAdmin } from '../config/supabase';

export class DoseController {
  /**
   * Get today's medication schedule and doses
   */
  async getDailyDoses(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user?.id;
      if (!patientId) {
        res.status(400).json({ success: false, error: 'Patient ID is required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const dateStr = req.query.date as string;
      const doses = await doseService.getDailyDoses(patientId, dateStr);

      // Summary counts
      const total = doses.length;
      const taken = doses.filter(d => d.status === 'taken').length;
      const pending = doses.filter(d => d.status === 'pending').length;
      const overdue = doses.filter(d => d.status === 'overdue').length;
      const skipped = doses.filter(d => d.status === 'skipped').length;
      const progress = total > 0 ? Math.round((taken / total) * 100) : 0;

      res.json({
        success: true,
        summary: { total, taken, pending, overdue, skipped, progress },
        doses,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Mark dose as Taken
   */
  async markAsTaken(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { notes } = req.body;

      // Fetch dose to check patient ID
      const { data: dose } = await supabaseAdmin
        .from('scheduled_doses')
        .select('patient_id')
        .eq('id', id)
        .single();

      if (!dose) {
        res.status(404).json({ success: false, error: 'Dose record not found' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, dose.patient_id, 'can_confirm_doses');
      if (!authorized) return;

      const updated = await doseService.markAsTaken(id, req.user!.id, notes);
      res.json({ success: true, dose: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Skip dose with reason
   */
  async skipDose(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ success: false, error: 'Reason is required to skip a dose' });
        return;
      }

      const { data: dose } = await supabaseAdmin
        .from('scheduled_doses')
        .select('patient_id')
        .eq('id', id)
        .single();

      if (!dose) {
        res.status(404).json({ success: false, error: 'Dose record not found' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, dose.patient_id, 'can_confirm_doses');
      if (!authorized) return;

      const updated = await doseService.skipDose(id, req.user!.id, reason);
      res.json({ success: true, dose: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Correct dose status
   */
  async correctDose(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { newStatus, reason } = req.body;

      if (!newStatus || !reason) {
        res.status(400).json({ success: false, error: 'newStatus and reason are required' });
        return;
      }

      const { data: dose } = await supabaseAdmin
        .from('scheduled_doses')
        .select('patient_id')
        .eq('id', id)
        .single();

      if (!dose) {
        res.status(404).json({ success: false, error: 'Dose not found' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, dose.patient_id, 'can_confirm_doses');
      if (!authorized) return;

      const updated = await doseService.correctDose(id, req.user!.id, newStatus, reason);
      res.json({ success: true, dose: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Get dose history across dates and filters
   */
  async getHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user?.id;
      if (!patientId) {
        res.status(400).json({ success: false, error: 'Patient ID is required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      let query = supabaseAdmin
        .from('scheduled_doses')
        .select(`
          *,
          medicines (id, name, brand_name, prescribed_dosage, food_timing)
        `)
        .eq('patient_id', patientId)
        .order('scheduled_date', { ascending: false })
        .order('scheduled_time', { ascending: false });

      if (req.query.startDate) query = query.gte('scheduled_date', req.query.startDate as string);
      if (req.query.endDate) query = query.lte('scheduled_date', req.query.endDate as string);
      if (req.query.status && req.query.status !== 'all') query = query.eq('status', req.query.status as string);
      if (req.query.medicineId) query = query.eq('medicine_id', req.query.medicineId as string);

      const { data, error } = await query.limit(200);
      if (error) throw error;

      res.json({ success: true, history: data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const doseController = new DoseController();

