import { Router } from 'express';
import { notificationController } from '../controllers/notificationController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => notificationController.getNotifications(req, res));
router.post('/:id/read', (req, res) => notificationController.markAsRead(req, res));
router.get('/preferences', (req, res) => notificationController.getPreferences(req, res));
router.put('/preferences', (req, res) => notificationController.updatePreferences(req, res));
router.get('/status', (req, res) => notificationController.getChannelStatus(req, res));
router.post('/test-trigger', (req, res) => notificationController.testTrigger(req, res));

export default router;

