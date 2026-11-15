import { supabaseAdmin } from '../config/supabase';
import { notificationManager } from '../notifications/notificationManager';
import { MedicineInventory, ScheduledDose } from '../types';

export class InventoryService {
  /**
   * Initializes or gets inventory record for a medicine
   */
  async getOrCreateInventory(medicineId: string, patientId: string, initialStock = 0, threshold = 10, unit = 'tablets'): Promise<MedicineInventory> {
    const { data: existing } = await supabaseAdmin
      .from('medicine_inventory')
      .select('*')
      .eq('medicine_id', medicineId)
      .single();

    if (existing) return existing;

    const { data: created, error } = await supabaseAdmin
      .from('medicine_inventory')
      .insert({
        medicine_id: medicineId,
        patient_id: patientId,
        current_stock: initialStock,
        low_stock_threshold: threshold,
        unit_name: unit,
      })
      .select('*')
      .single();

    if (error || !created) {
      throw new Error(`Failed to initialize inventory: ${error?.message}`);
    }

    return created;
  }

  /**
   * Safe, idempotent deduction of medicine stock upon dose confirmation.
   * Guarantees that a single dose NEVER deducts stock more than once!
   */
  async deductStockForDose(dose: ScheduledDose, performedBy: string): Promise<boolean> {
    const idempotencyKey = `dose_deduction_${dose.id}`;

    // 1. Check if transaction already exists for this dose
    const { data: existingTx } = await supabaseAdmin
      .from('inventory_transactions')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (existingTx) {
      console.log(`[Inventory] Idempotency check: Dose ${dose.id} already deducted stock. Skipping.`);
      return true;
    }

    // 2. Fetch inventory record
    const { data: inventory, error: invError } = await supabaseAdmin
      .from('medicine_inventory')
      .select('*')
      .eq('medicine_id', dose.medicine_id)
      .single();

    if (invError || !inventory) {
      console.warn(`[Inventory] No inventory record for medicine ${dose.medicine_id}. Initializing with 0.`);
      await this.getOrCreateInventory(dose.medicine_id, dose.patient_id, 0);
      return false;
    }

    const qty = dose.dose_quantity || 1;
    const newStock = Math.max(0, Number(inventory.current_stock) - Number(qty));

    // 3. Insert transaction log with unique idempotency key
    const { error: txError } = await supabaseAdmin
      .from('inventory_transactions')
      .insert({
        inventory_id: inventory.id,
        medicine_id: dose.medicine_id,
        patient_id: dose.patient_id,
        transaction_type: 'dose_deduction',
        quantity_change: -qty,
        balance_after: newStock,
        dose_id: dose.id,
        reference_note: `Dose confirmed for ${dose.scheduled_date} at ${dose.scheduled_time}`,
        idempotency_key: idempotencyKey,
        performed_by: performedBy,
      });

    if (txError) {
      if (txError.code === '23505') {
        console.log(`[Inventory] Duplicate transaction caught by unique constraint for dose ${dose.id}`);
        return true;
      }
      console.error('[Inventory] Error recording transaction:', txError);
      return false;
    }

    // 4. Update inventory stock
    const isLowStock = newStock <= Number(inventory.low_stock_threshold);
    await supabaseAdmin
      .from('medicine_inventory')
      .update({
        current_stock: newStock,
        low_stock_alert_sent: isLowStock ? true : inventory.low_stock_alert_sent,
      })
      .eq('id', inventory.id);

    // 5. If stock reached low threshold, trigger notification
    if (isLowStock && !inventory.low_stock_alert_sent) {
      await this.triggerLowStockAlert(dose.patient_id, dose.medicine_id, newStock, inventory.unit_name);
    }

    return true;
  }

  /**
   * Refill or manually adjust stock
   */
  async updateStock(params: {
    medicineId: string;
    patientId: string;
    quantityChange: number;
    transactionType: 'manual_refill' | 'adjustment' | 'correction';
    referenceNote?: string;
    performedBy: string;
    newThreshold?: number;
  }): Promise<{ success: boolean; currentStock: number }> {
    const inv = await this.getOrCreateInventory(params.medicineId, params.patientId);
    let newBalance = 0;

    if (params.transactionType === 'manual_refill') {
      newBalance = Number(inv.current_stock) + Number(params.quantityChange);
    } else if (params.transactionType === 'adjustment' || params.transactionType === 'correction') {
      newBalance = Math.max(0, Number(inv.current_stock) + Number(params.quantityChange));
    }

    // Insert transaction
    await supabaseAdmin.from('inventory_transactions').insert({
      inventory_id: inv.id,
      medicine_id: params.medicineId,
      patient_id: params.patientId,
      transaction_type: params.transactionType,
      quantity_change: params.quantityChange,
      balance_after: newBalance,
      reference_note: params.referenceNote || 'Manual stock update',
      performed_by: params.performedBy,
    });

    const isLowStock = newBalance <= (params.newThreshold || Number(inv.low_stock_threshold));

    await supabaseAdmin
      .from('medicine_inventory')
      .update({
        current_stock: newBalance,
        low_stock_threshold: params.newThreshold || inv.low_stock_threshold,
        last_refill_date: params.transactionType === 'manual_refill' ? new Date().toISOString().split('T')[0] : inv.last_refill_date,
        last_refill_quantity: params.transactionType === 'manual_refill' ? params.quantityChange : inv.last_refill_quantity,
        low_stock_alert_sent: isLowStock,
      })
      .eq('id', inv.id);

    return { success: true, currentStock: newBalance };
  }

  /**
   * Trigger low-stock alerts to patient and primary caretakers
   */
  private async triggerLowStockAlert(patientId: string, medicineId: string, currentStock: number, unitName: string) {
    const { data: med } = await supabaseAdmin
      .from('medicines')
      .select('name')
      .eq('id', medicineId)
      .single();

    const medName = med?.name || 'Medicine';
    const message = `LOW STOCK ALERT: ${medName} has only ${currentStock} ${unitName} remaining. Please refill soon.`;

    // Notify patient
    await notificationManager.notifyUser({
      recipientId: patientId,
      patientId,
      medicineId,
      type: 'low_stock_alert',
      title: 'Low Medicine Stock',
      message,
      severity: 'warning',
    });

    // Notify authorized caretakers
    const { data: caretakers } = await supabaseAdmin
      .from('patient_caretaker_relationships')
      .select(`
        caretaker_id,
        caretaker_permissions (
          can_receive_stock_alerts,
          notification_channels
        )
      `)
      .eq('patient_id', patientId)
      .eq('status', 'accepted');

    if (caretakers) {
      const notifiedCaretakers = new Set<string>();
      for (const c of caretakers) {
        if (!c.caretaker_id || notifiedCaretakers.has(c.caretaker_id)) continue;
        const rawPerms = (c as any).caretaker_permissions;
        const perms = Array.isArray(rawPerms) ? rawPerms[0] : rawPerms;
        if (perms?.can_receive_stock_alerts) {
          notifiedCaretakers.add(c.caretaker_id);
          await notificationManager.notifyUser({
            recipientId: c.caretaker_id,
            patientId,
            medicineId,
            type: 'low_stock_alert',
            title: `Patient Stock Alert: ${medName}`,
            message: `Alert for your patient: ${medName} has only ${currentStock} ${unitName} left.`,
            severity: 'warning',
            channelsOverride: perms.notification_channels,
          });
        }
      }
    }
  }

  /**
   * Get full inventory summary with calculated daily consumption and remaining days
   */
  async getInventorySummary(patientId: string) {
    const { data: items, error } = await supabaseAdmin
      .from('medicine_inventory')
      .select(`
        *,
        medicines (
          id,
          name,
          brand_name,
          medicine_type,
          prescribed_dosage,
          units_per_intake,
          frequency,
          status
        )
      `)
      .eq('patient_id', patientId);

    if (error || !items) return [];

    // Calculate daily consumption for each medicine from active schedules
    const { data: schedules } = await supabaseAdmin
      .from('medication_schedules')
      .select('medicine_id, dose_quantity, days_of_week')
      .eq('patient_id', patientId)
      .eq('is_active', true);

    const consumptionMap: Record<string, number> = {};
    if (schedules) {
      for (const s of schedules) {
        const daysPerWeek = s.days_of_week?.length || 7;
        const dailyAvg = (Number(s.dose_quantity) * daysPerWeek) / 7;
        consumptionMap[s.medicine_id] = (consumptionMap[s.medicine_id] || 0) + dailyAvg;
      }
    }

    return items.map(item => {
      const dailyConsumption = consumptionMap[item.medicine_id] || 1;
      const remainingDays = dailyConsumption > 0 ? Math.floor(Number(item.current_stock) / dailyConsumption) : 999;
      return {
        ...item,
        dailyConsumption,
        estimatedRemainingDays: remainingDays,
        isLowStock: Number(item.current_stock) <= Number(item.low_stock_threshold),
        isOutOfStock: Number(item.current_stock) <= 0,
      };
    });
  }
}

export const inventoryService = new InventoryService();

