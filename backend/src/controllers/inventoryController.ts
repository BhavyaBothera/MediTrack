import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import { inventoryService } from '../services/inventoryService';
import { authorizePatientAccess } from '../middleware/rbac';
import { supabaseAdmin } from '../config/supabase';

export class InventoryController {
  async getInventory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const patientId = (req.query.patientId as string) || req.user?.id;
      if (!patientId) {
        res.status(400).json({ success: false, error: 'Patient ID is required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId);
      if (!authorized) return;

      const items = await inventoryService.getInventorySummary(patientId);

      const totalMedicines = items.length;
      const lowStockCount = items.filter(i => i.isLowStock && !i.isOutOfStock).length;
      const outOfStockCount = items.filter(i => i.isOutOfStock).length;

      // Fetch recent 10 transactions
      const { data: recentTransactions } = await supabaseAdmin
        .from('inventory_transactions')
        .select(`
          *,
          medicines (name)
        `)
        .eq('patient_id', patientId)
        .order('created_at', { ascending: false })
        .limit(10);

      res.json({
        success: true,
        summary: { totalMedicines, lowStockCount, outOfStockCount },
        inventory: items,
        recentTransactions: recentTransactions || [],
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async refillStock(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { medicineId, quantity, note, newThreshold } = req.body;
      const patientId = req.body.patientId || req.user?.id;

      if (!medicineId || !quantity) {
        res.status(400).json({ success: false, error: 'medicineId and quantity are required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId, 'can_edit_medicines');
      if (!authorized) return;

      const result = await inventoryService.updateStock({
        medicineId,
        patientId,
        quantityChange: Number(quantity),
        transactionType: 'manual_refill',
        referenceNote: note || 'Manual refill',
        performedBy: req.user!.id,
        newThreshold: newThreshold ? Number(newThreshold) : undefined,
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async adjustStock(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { medicineId, quantityChange, note, newThreshold } = req.body;
      const patientId = req.body.patientId || req.user?.id;

      if (!medicineId || quantityChange === undefined) {
        res.status(400).json({ success: false, error: 'medicineId and quantityChange are required' });
        return;
      }

      const authorized = await authorizePatientAccess(req, res, () => {}, patientId, 'can_edit_medicines');
      if (!authorized) return;

      const result = await inventoryService.updateStock({
        medicineId,
        patientId,
        quantityChange: Number(quantityChange),
        transactionType: 'adjustment',
        referenceNote: note || 'Stock adjustment',
        performedBy: req.user!.id,
        newThreshold: newThreshold ? Number(newThreshold) : undefined,
      });

      res.json({ success: true, result });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const inventoryController = new InventoryController();

