import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { caretakerService } from '../services/caretakerService';

export class CaretakerController {
  async inviteCaretaker(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = req.user!.id;
      const patientName = req.user?.profile?.full_name || 'Patient';

      const rel = await caretakerService.inviteCaretaker(patientId, req.body, patientName);
      res.status(201).json({ success: true, invitation: rel });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getMyCaretakers(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const caretakers = await caretakerService.getPatientCaretakers(req.user!.id);
      res.json({ success: true, caretakers });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async getMyPatients(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patients = await caretakerService.getCaretakerPatients(req.user!.id);
      res.json({ success: true, patients });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async acceptInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { inviteToken } = req.body;
      if (!inviteToken) {
        res.status(400).json({ success: false, error: 'inviteToken is required' });
        return;
      }

      const rel = await caretakerService.acceptInvitation(inviteToken, req.user!.id);
      res.json({ success: true, relationship: rel });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async revokeCaretaker(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await caretakerService.revokeCaretaker(id, req.user!.id);
      res.json({ success: true, message: 'Caretaker access revoked successfully' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const caretakerController = new CaretakerController();

