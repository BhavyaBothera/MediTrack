import { Router } from 'express';
import { inventoryController } from '../controllers/inventoryController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => inventoryController.getInventory(req, res));
router.post('/refill', (req, res) => inventoryController.refillStock(req, res));
router.post('/adjust', (req, res) => inventoryController.adjustStock(req, res));

export default router;

