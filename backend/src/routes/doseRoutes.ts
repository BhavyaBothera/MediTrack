import { Router } from 'express';
import { doseController } from '../controllers/doseController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/today', (req, res) => doseController.getDailyDoses(req, res));
router.get('/history', (req, res) => doseController.getHistory(req, res));
router.post('/:id/take', (req, res) => doseController.markAsTaken(req, res));
router.post('/:id/skip', (req, res) => doseController.skipDose(req, res));
router.post('/:id/correct', (req, res) => doseController.correctDose(req, res));

export default router;

