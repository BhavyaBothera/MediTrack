import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { prescriptionService } from '../services/prescriptionService';
import { authorizePatientAccess } from '../middleware/rbac';
import { supabaseAdmin } from '../config/supabase';

export class PrescriptionController {
  async upload(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ success: false, error: 'No prescription file provided' });
        return;
      }

      const patientId = req.body.patientId || req.user!.id;
      const authorized = await authorizePatientAccess(req, res, () => {}, patientId, 'can_edit_medicines');
      if (!authorized) return;

      const metadata = {
        doctorName: req.body.doctorName,
        prescriptionDate: req.body.prescriptionDate,
        validUntil: req.body.validUntil,
        diagnosis: req.body.diagnosis,
        notes: req.body.notes,
      };

      const pres = await prescriptionService.createPrescription(patientId, req.file, metadata);
      res.status(201).json({ success: true, prescription: pres });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user!.id;
      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const prescriptions = await prescriptionService.getPrescriptions(patientId);
      res.json({ success: true, prescriptions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getSecureUrl(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { data: pres } = await supabaseAdmin
        .from('prescriptions')
        .select('patient_id, file_url')
        .eq('id', id)
        .single();

      if (!pres) {
        res.status(404).json({ success: false, error: 'Prescription not found' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, pres.patient_id);
      if (!authorized) return;

      const signedUrl = await prescriptionService.getSecureViewUrl(pres.file_url);
      res.json({ success: true, signedUrl });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const prescriptionController = new PrescriptionController();

