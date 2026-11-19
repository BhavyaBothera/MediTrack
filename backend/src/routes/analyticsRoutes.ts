import { Router } from 'express';
import { analyticsController } from '../controllers/analyticsController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => analyticsController.getMetrics(req, res));
router.get('/delivery', (req, res) => analyticsController.getDeliveryMetrics(req, res));
router.get('/export/csv', (req, res) => analyticsController.exportCSV(req, res));
router.get('/export/pdf', (req, res) => analyticsController.exportPDF(req, res));

export default router;

