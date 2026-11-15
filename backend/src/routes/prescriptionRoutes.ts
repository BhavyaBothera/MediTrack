import { Router } from 'express';
import multer from 'multer';
import { prescriptionController } from '../controllers/prescriptionController';
import { requireAuth } from '../middleware/auth';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

router.use(requireAuth);

router.post('/upload', upload.single('prescriptionFile'), (req, res) => prescriptionController.upload(req, res));
router.get('/', (req, res) => prescriptionController.list(req, res));
router.get('/:id/view-url', (req, res) => prescriptionController.getSecureUrl(req, res));

export default router;

