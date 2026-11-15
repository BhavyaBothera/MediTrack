import { Router } from 'express';
import { medicineController } from '../controllers/medicineController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => medicineController.listMedicines(req, res));
router.post('/', (req, res) => medicineController.createMedicine(req, res));
router.get('/:id', (req, res) => medicineController.getMedicine(req, res));
router.put('/:id', (req, res) => medicineController.updateMedicine(req, res));
router.post('/:id/discontinue', (req, res) => medicineController.discontinueMedicine(req, res));

export default router;

