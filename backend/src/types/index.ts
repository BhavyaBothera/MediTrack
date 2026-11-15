export type UserRole = 'patient' | 'caretaker' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  timezone: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  avatar_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type MedicineType = 'tablet' | 'capsule' | 'syrup' | 'injection' | 'drops' | 'inhaler' | 'cream' | 'other';
export type FoodTiming = 'before_food' | 'after_food' | 'with_food' | 'anytime';
export type MedicineStatus = 'active' | 'discontinued' | 'archived';
export type Frequency = 'once_daily' | 'twice_daily' | 'thrice_daily' | 'four_times_daily' | 'custom' | 'as_needed';

export interface Medicine {
  id: string;
  patient_id: string;
  doctor_id?: string;
  name: string;
  brand_name?: string;
  medicine_type: MedicineType;
  prescribed_dosage: string;
  units_per_intake: number;
  frequency: Frequency;
  food_timing: FoodTiming;
  start_date: string;
  end_date?: string;
  prescribing_doctor_name?: string;
  prescription_reference?: string;
  additional_instructions?: string;
  status: MedicineStatus;
  discontinued_at?: string;
  discontinuation_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface MedicationSchedule {
  id: string;
  medicine_id: string;
  patient_id: string;
  scheduled_time: string; // HH:mm:ss
  dose_quantity: number;
  days_of_week: number[]; // 1=Mon, 7=Sun
  reminder_lead_minutes: number;
  follow_up_reminder_minutes: number;
  grace_period_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DoseStatus = 'pending' | 'taken' | 'overdue' | 'missed' | 'skipped';

export interface ScheduledDose {
  id: string;
  schedule_id: string;
  medicine_id: string;
  patient_id: string;
  scheduled_date: string;
  scheduled_time: string;
  scheduled_timestamp: string;
  grace_period_expires_at: string;
  status: DoseStatus;
  dose_quantity: number;
  confirmed_at?: string;
  confirmed_by?: string;
  skip_reason?: string;
  initial_reminder_sent: boolean;
  follow_up_reminder_sent: boolean;
  caretaker_alert_sent: boolean;
  late_confirmation_notified: boolean;
  created_at: string;
  updated_at: string;
  // Joined fields
  medicine?: Medicine;
}

export interface MedicationLog {
  id: string;
  dose_id?: string;
  medicine_id: string;
  patient_id: string;
  action: 'marked_taken' | 'skipped' | 'corrected' | 'discontinued' | 'schedule_modified' | 'stock_adjusted';
  performed_by: string;
  original_status?: string;
  new_status?: string;
  notes?: string;
  recorded_at: string;
  created_at: string;
}

export interface MedicineInventory {
  id: string;
  medicine_id: string;
  patient_id: string;
  current_stock: number;
  unit_name: string;
  low_stock_threshold: number;
  last_refill_date?: string;
  last_refill_quantity?: number;
  low_stock_alert_sent: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  medicine?: Medicine;
}

export interface InventoryTransaction {
  id: string;
  inventory_id: string;
  medicine_id: string;
  patient_id: string;
  transaction_type: 'dose_deduction' | 'manual_refill' | 'adjustment' | 'correction';
  quantity_change: number;
  balance_after: number;
  dose_id?: string;
  reference_note?: string;
  idempotency_key?: string;
  performed_by: string;
  created_at: string;
}

export type CaretakerPermissionLevel = 'primary' | 'secondary' | 'read_only';

export interface CaretakerRelationship {
  id: string;
  patient_id: string;
  caretaker_id?: string;
  invite_email: string;
  invite_phone?: string;
  invite_token: string;
  relationship_type: string;
  status: 'pending' | 'accepted' | 'rejected' | 'revoked';
  invited_at: string;
  responded_at?: string;
  created_at: string;
  updated_at: string;
  // Joined
  patient?: Profile;
  caretaker?: Profile;
  permissions?: CaretakerPermissions;
}

export interface CaretakerPermissions {
  id: string;
  relationship_id: string;
  permission_level: CaretakerPermissionLevel;
  can_receive_overdue_alerts: boolean;
  can_receive_missed_alerts: boolean;
  can_receive_stock_alerts: boolean;
  can_receive_daily_summary: boolean;
  can_receive_weekly_reports: boolean;
  can_edit_medicines: boolean;
  can_confirm_doses: boolean;
  notification_channels: string[];
  created_at: string;
  updated_at: string;
}

export interface Prescription {
  id: string;
  patient_id: string;
  doctor_id?: string;
  doctor_name?: string;
  prescription_date: string;
  valid_until?: string;
  diagnosis?: string;
  file_url?: string;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  notes?: string;
  ocr_extracted_text?: string;
  ocr_data?: any;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export type NotificationType =
  | 'initial_reminder'
  | 'follow_up_reminder'
  | 'caretaker_overdue_alert'
  | 'caretaker_late_confirmation'
  | 'low_stock_alert'
  | 'refill_reminder'
  | 'system';

export interface NotificationItem {
  id: string;
  recipient_id: string;
  patient_id: string;
  dose_id?: string;
  medicine_id?: string;
  type: NotificationType;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'read';
  is_read: boolean;
  read_at?: string;
  scheduled_for: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
  push_subscription?: any;
  created_at: string;
  updated_at: string;
}

