import { supabaseAdmin } from '../config/supabase';
import { inventoryService } from './inventoryService';
import { scheduleService } from './scheduleService';
import { Medicine, MedicineType, FoodTiming, Frequency } from '../types';

export interface CreateMedicineDTO {
  name: string;
  brand_name?: string;
  medicine_type: MedicineType;
  prescribed_dosage: string;
  units_per_intake?: number;
  frequency: Frequency;
  food_timing: FoodTiming;
  start_date?: string;
  end_date?: string;
  prescribing_doctor_name?: string;
  prescription_reference?: string;
  additional_instructions?: string;
  initial_stock?: number;
  low_stock_threshold?: number;
  schedules: Array<{
    scheduled_time: string; // HH:mm or HH:mm:ss
    dose_quantity?: number;
    days_of_week?: number[];
    grace_period_minutes?: number;
  }>;
}

export class MedicineService {
  /**
   * Add a new medicine with schedules and inventory
   */
  async createMedicine(patientId: string, data: CreateMedicineDTO, performedBy: string): Promise<Medicine> {
    // 1. Insert medicine record
    const { data: med, error: medError } = await supabaseAdmin
      .from('medicines')
      .insert({
        patient_id: patientId,
        name: data.name,
        brand_name: data.brand_name || null,
        medicine_type: data.medicine_type || 'tablet',
        prescribed_dosage: data.prescribed_dosage,
        units_per_intake: data.units_per_intake || 1,
        frequency: data.frequency || 'once_daily',
        food_timing: data.food_timing || 'after_food',
        start_date: data.start_date || new Date().toISOString().split('T')[0],
        end_date: data.end_date || null,
        prescribing_doctor_name: data.prescribing_doctor_name || null,
        prescription_reference: data.prescription_reference || null,
        additional_instructions: data.additional_instructions || null,
        status: 'active',
      })
      .select('*')
      .single();

    if (medError || !med) {
      throw new Error(`Failed to create medicine: ${medError?.message}`);
    }

    // 2. Insert schedules
    if (data.schedules && data.schedules.length > 0) {
      const scheduleRows = data.schedules.map(s => {
        let time = s.scheduled_time;
        if (time.length === 5) time += ':00'; // Ensure HH:mm:ss format
        return {
          medicine_id: med.id,
          patient_id: patientId,
          scheduled_time: time,
          dose_quantity: s.dose_quantity || data.units_per_intake || 1,
          days_of_week: s.days_of_week || [1, 2, 3, 4, 5, 6, 7],
          reminder_lead_minutes: 0,
          follow_up_reminder_minutes: 15,
          grace_period_minutes: s.grace_period_minutes || 30,
          is_active: true,
        };
      });

      await supabaseAdmin.from('medication_schedules').insert(scheduleRows);
      // Immediately populate today's schedule for the newly configured medicine
      await scheduleService.generateDailyDoses(patientId).catch(err => {
        console.warn('[MedicineService] Warning generating today doses for new medicine:', err.message);
      });
    }

    // 3. Initialize inventory
    await inventoryService.getOrCreateInventory(
      med.id,
      patientId,
      data.initial_stock || 0,
      data.low_stock_threshold || 10,
      med.medicine_type === 'syrup' ? 'ml' : 'tablets'
    );

    // 4. Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: performedBy,
      action: 'create_medicine',
      entity_type: 'medicine',
      entity_id: med.id,
      new_values: med,
    });

    return med;
  }

  /**
   * Get medicines for a patient with schedules and inventory info
   */
  async getMedicines(patientId: string, filter?: { status?: string; search?: string }): Promise<any[]> {
    let query = supabaseAdmin
      .from('medicines')
      .select(`
        *,
        medication_schedules (*),
        medicine_inventory (*)
      `)
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (filter?.status && filter.status !== 'all') {
      query = query.eq('status', filter.status);
    }

    if (filter?.search) {
      query = query.ilike('name', `%${filter.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /**
   * Get single medicine by ID
   */
  async getMedicineById(medicineId: string): Promise<any> {
    const { data, error } = await supabaseAdmin
      .from('medicines')
      .select(`
        *,
        medication_schedules (*),
        medicine_inventory (*)
      `)
      .eq('id', medicineId)
      .single();

    if (error || !data) throw new Error('Medicine not found');
    return data;
  }

  /**
   * Update existing medicine and its schedules
   */
  async updateMedicine(medicineId: string, data: Partial<CreateMedicineDTO>, performedBy: string): Promise<Medicine> {
    const { data: existing } = await supabaseAdmin
      .from('medicines')
      .select('*')
      .eq('id', medicineId)
      .single();

    if (!existing) throw new Error('Medicine not found');

    const updateFields: any = {};
    if (data.name) updateFields.name = data.name;
    if (data.brand_name !== undefined) updateFields.brand_name = data.brand_name;
    if (data.medicine_type) updateFields.medicine_type = data.medicine_type;
    if (data.prescribed_dosage) updateFields.prescribed_dosage = data.prescribed_dosage;
    if (data.units_per_intake) updateFields.units_per_intake = data.units_per_intake;
    if (data.frequency) updateFields.frequency = data.frequency;
    if (data.food_timing) updateFields.food_timing = data.food_timing;
    if (data.start_date) updateFields.start_date = data.start_date;
    if (data.end_date !== undefined) updateFields.end_date = data.end_date;
    if (data.prescribing_doctor_name !== undefined) updateFields.prescribing_doctor_name = data.prescribing_doctor_name;
    if (data.additional_instructions !== undefined) updateFields.additional_instructions = data.additional_instructions;

    const { data: updated, error } = await supabaseAdmin
      .from('medicines')
      .update(updateFields)
      .eq('id', medicineId)
      .select('*')
      .single();

    if (error || !updated) throw new Error(`Failed to update medicine: ${error?.message}`);

    // If new schedules are provided, update them
    if (data.schedules) {
      // Deactivate old schedules
      await supabaseAdmin
        .from('medication_schedules')
        .update({ is_active: false })
        .eq('medicine_id', medicineId);

      // Insert new schedules
      const newSchedules = data.schedules.map(s => {
        let time = s.scheduled_time;
        if (time.length === 5) time += ':00';
        return {
          medicine_id: medicineId,
          patient_id: existing.patient_id,
          scheduled_time: time,
          dose_quantity: s.dose_quantity || updated.units_per_intake || 1,
          days_of_week: s.days_of_week || [1, 2, 3, 4, 5, 6, 7],
          reminder_lead_minutes: 0,
          follow_up_reminder_minutes: 15,
          grace_period_minutes: s.grace_period_minutes || 30,
          is_active: true,
        };
      });

      await supabaseAdmin.from('medication_schedules').insert(newSchedules);
      // Immediately sync today's schedule for updated medicine
      await scheduleService.generateDailyDoses(existing.patient_id).catch(err => {
        console.warn('[MedicineService] Warning syncing today doses on update:', err.message);
      });
    }

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: performedBy,
      action: 'update_medicine',
      entity_type: 'medicine',
      entity_id: medicineId,
      old_values: existing,
      new_values: updated,
    });

    return updated;
  }

  /**
   * Discontinue medicine (safe soft-discontinuation preserving history)
   */
  async discontinueMedicine(medicineId: string, reason: string, performedBy: string): Promise<Medicine> {
    const { data: existing } = await supabaseAdmin
      .from('medicines')
      .select('*')
      .eq('id', medicineId)
      .single();

    if (!existing) throw new Error('Medicine not found');

    const now = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('medicines')
      .update({
        status: 'discontinued',
        discontinued_at: now,
        discontinuation_reason: reason || 'Discontinued by user/prescriber',
      })
      .eq('id', medicineId)
      .select('*')
      .single();

    if (error || !updated) throw new Error(`Failed to discontinue medicine: ${error?.message}`);

    // Deactivate schedules so future doses are not generated
    await supabaseAdmin
      .from('medication_schedules')
      .update({ is_active: false })
      .eq('medicine_id', medicineId);

    // Audit log
    await supabaseAdmin.from('audit_logs').insert({
      user_id: performedBy,
      action: 'discontinue_medicine',
      entity_type: 'medicine',
      entity_id: medicineId,
      old_values: existing,
      new_values: updated,
    });

    return updated;
  }
}

export const medicineService = new MedicineService();

