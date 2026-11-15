import { Router } from 'express';
import { authController } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import { authRateLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authRateLimiter, (req, res) => authController.register(req, res));
router.post('/login', authRateLimiter, (req, res) => authController.login(req, res));
router.get('/me', requireAuth, (req, res) => authController.getMe(req, res));
router.put('/profile', requireAuth, (req, res) => authController.updateProfile(req, res));

export default router;

