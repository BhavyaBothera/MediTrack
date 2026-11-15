import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { medicineService } from '../services/medicineService';
import { authorizePatientAccess } from '../middleware/rbac';

export class MedicineController {
  async listMedicines(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user?.id;
      if (!patientId) {
        res.status(400).json({ success: false, error: 'Patient ID is required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const filter = {
        status: req.query.status as string,
        search: req.query.search as string,
      };

      const medicines = await medicineService.getMedicines(patientId, filter);
      res.json({ success: true, medicines });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getMedicine(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const med = await medicineService.getMedicineById(req.params.id);
      const authorized = await authorizePatientAccess(req, res, () => {}, med.patient_id);
      if (!authorized) return;

      res.json({ success: true, medicine: med });
    } catch (err: any) {
      res.status(404).json({ success: false, error: err.message });
    }
  }

  async createMedicine(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = req.body.patientId || req.user?.id;
      const authorized = await authorizePatientAccess(req, res, () => {}, patientId, 'can_edit_medicines');
      if (!authorized) return;

      const med = await medicineService.createMedicine(patientId, req.body, req.user!.id);
      res.status(201).json({ success: true, medicine: med });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateMedicine(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const med = await medicineService.getMedicineById(req.params.id);
      const authorized = await authorizePatientAccess(req, res, () => {}, med.patient_id, 'can_edit_medicines');
      if (!authorized) return;

      const updated = await medicineService.updateMedicine(req.params.id, req.body, req.user!.id);
      res.json({ success: true, medicine: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async discontinueMedicine(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const med = await medicineService.getMedicineById(req.params.id);
      const authorized = await authorizePatientAccess(req, res, () => {}, med.patient_id, 'can_edit_medicines');
      if (!authorized) return;

      const updated = await medicineService.discontinueMedicine(req.params.id, req.body.reason, req.user!.id);
      res.json({ success: true, medicine: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const medicineController = new MedicineController();

