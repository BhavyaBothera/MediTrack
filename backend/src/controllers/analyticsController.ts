import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { analyticsService } from '../services/analyticsService';
import { reportService } from '../services/reportService';
import { authorizePatientAccess } from '../middleware/rbac';

export class AnalyticsController {
  async getMetrics(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user!.id;
      const days = parseInt((req.query.days as string) || '30', 10);

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const metrics = await analyticsService.getAdherenceAnalytics(patientId, days);
      res.json({ success: true, metrics });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async exportCSV(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user!.id;
      const days = parseInt((req.query.days as string) || '30', 10);

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const csv = await reportService.generateDoseHistoryCSV(patientId, days);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=meditrack_adherence_${patientId}_${days}days.csv`);
      res.status(200).send(csv);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async exportPDF(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user!.id;
      const days = parseInt((req.query.days as string) || '30', 10);

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const patientName = req.user?.profile?.full_name || 'Patient';
      const pdfBuffer = await reportService.generateAdherencePDF(patientId, patientName, days);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=meditrack_report_${days}days.pdf`);
      res.status(200).send(pdfBuffer);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const analyticsController = new AnalyticsController();

