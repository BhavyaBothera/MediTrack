import { Router } from 'express';
import { caretakerController } from '../controllers/caretakerController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

router.post('/invite', (req, res) => caretakerController.inviteCaretaker(req, res));
router.get('/', (req, res) => caretakerController.getMyCaretakers(req, res));
router.get('/my-patients', (req, res) => caretakerController.getMyPatients(req, res));
router.post('/accept', (req, res) => caretakerController.acceptInvitation(req, res));
router.post('/:id/revoke', (req, res) => caretakerController.revokeCaretaker(req, res));

export default router;

