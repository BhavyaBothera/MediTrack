import { Router } from 'express';
import authRoutes from './authRoutes';
import medicineRoutes from './medicineRoutes';
import doseRoutes from './doseRoutes';
import inventoryRoutes from './inventoryRoutes';
import caretakerRoutes from './caretakerRoutes';
import prescriptionRoutes from './prescriptionRoutes';
import analyticsRoutes from './analyticsRoutes';
import notificationRoutes from './notificationRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/medicines', medicineRoutes);
router.use('/doses', doseRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/caretakers', caretakerRoutes);
router.use('/prescriptions', prescriptionRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/notifications', notificationRoutes);

export default router;

