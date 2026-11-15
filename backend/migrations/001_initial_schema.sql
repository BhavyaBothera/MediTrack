-- ====================================================================
-- MediTrack - Smart Medicine Management & Medication Adherence System
-- Database Schema Migration 001 - Initial Complete Schema
-- ====================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- --------------------------------------------------------------------
-- 1. PROFILES (Extends Supabase auth.users)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT NOT NULL CHECK (role IN ('patient', 'caretaker', 'admin')),
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    avatar_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_profiles_modtime
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 2. DOCTORS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.doctors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    specialization TEXT,
    clinic_hospital TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_doctors_modtime
    BEFORE UPDATE ON public.doctors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 3. MEDICINES
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    brand_name TEXT,
    medicine_type TEXT NOT NULL DEFAULT 'tablet' CHECK (medicine_type IN ('tablet', 'capsule', 'syrup', 'injection', 'drops', 'inhaler', 'cream', 'other')),
    prescribed_dosage TEXT NOT NULL,
    units_per_intake NUMERIC NOT NULL DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'once_daily' CHECK (frequency IN ('once_daily', 'twice_daily', 'thrice_daily', 'four_times_daily', 'custom', 'as_needed')),
    food_timing TEXT NOT NULL DEFAULT 'after_food' CHECK (food_timing IN ('before_food', 'after_food', 'with_food', 'anytime')),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    prescribing_doctor_name TEXT,
    prescription_reference TEXT,
    additional_instructions TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued', 'archived')),
    discontinued_at TIMESTAMPTZ,
    discontinuation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medicines_patient ON public.medicines(patient_id);
CREATE INDEX IF NOT EXISTS idx_medicines_status ON public.medicines(status);

CREATE TRIGGER update_medicines_modtime
    BEFORE UPDATE ON public.medicines
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 4. MEDICATION SCHEDULES
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medication_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scheduled_time TIME NOT NULL,
    dose_quantity NUMERIC NOT NULL DEFAULT 1,
    days_of_week INT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}', -- 1=Monday, 7=Sunday
    reminder_lead_minutes INT NOT NULL DEFAULT 0,
    follow_up_reminder_minutes INT NOT NULL DEFAULT 15,
    grace_period_minutes INT NOT NULL DEFAULT 30,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_medicine ON public.medication_schedules(medicine_id);
CREATE INDEX IF NOT EXISTS idx_schedules_patient ON public.medication_schedules(patient_id);

CREATE TRIGGER update_schedules_modtime
    BEFORE UPDATE ON public.medication_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 5. SCHEDULED DOSES (Daily generated instances)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scheduled_doses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES public.medication_schedules(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    scheduled_timestamp TIMESTAMPTZ NOT NULL,
    grace_period_expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'taken', 'overdue', 'missed', 'skipped')),
    dose_quantity NUMERIC NOT NULL DEFAULT 1,
    confirmed_at TIMESTAMPTZ,
    confirmed_by UUID REFERENCES public.profiles(id),
    skip_reason TEXT,
    initial_reminder_sent BOOLEAN NOT NULL DEFAULT false,
    follow_up_reminder_sent BOOLEAN NOT NULL DEFAULT false,
    caretaker_alert_sent BOOLEAN NOT NULL DEFAULT false,
    late_confirmation_notified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_schedule_date UNIQUE (schedule_id, scheduled_date)
);

CREATE INDEX IF NOT EXISTS idx_doses_patient_date ON public.scheduled_doses(patient_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_doses_status ON public.scheduled_doses(status);
CREATE INDEX IF NOT EXISTS idx_doses_due_monitoring ON public.scheduled_doses(status, scheduled_timestamp, grace_period_expires_at);

CREATE TRIGGER update_doses_modtime
    BEFORE UPDATE ON public.scheduled_doses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 6. MEDICATION LOGS (Audit trail for dose actions)
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medication_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dose_id UUID REFERENCES public.scheduled_doses(id) ON DELETE SET NULL,
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL CHECK (action IN ('marked_taken', 'skipped', 'corrected', 'discontinued', 'schedule_modified', 'stock_adjusted')),
    performed_by UUID NOT NULL REFERENCES public.profiles(id),
    original_status TEXT,
    new_status TEXT,
    notes TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_med_logs_patient ON public.medication_logs(patient_id);
CREATE INDEX IF NOT EXISTS idx_med_logs_dose ON public.medication_logs(dose_id);

-- --------------------------------------------------------------------
-- 7. PATIENT CARETAKER RELATIONSHIPS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patient_caretaker_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    caretaker_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    invite_email TEXT NOT NULL,
    invite_phone TEXT,
    invite_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
    relationship_type TEXT NOT NULL DEFAULT 'family',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
    invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_caretaker_patient ON public.patient_caretaker_relationships(patient_id);
CREATE INDEX IF NOT EXISTS idx_caretaker_caretaker ON public.patient_caretaker_relationships(caretaker_id);

CREATE TRIGGER update_relationships_modtime
    BEFORE UPDATE ON public.patient_caretaker_relationships
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 8. CARETAKER PERMISSIONS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.caretaker_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    relationship_id UUID NOT NULL UNIQUE REFERENCES public.patient_caretaker_relationships(id) ON DELETE CASCADE,
    permission_level TEXT NOT NULL DEFAULT 'primary' CHECK (permission_level IN ('primary', 'secondary', 'read_only')),
    can_receive_overdue_alerts BOOLEAN NOT NULL DEFAULT true,
    can_receive_missed_alerts BOOLEAN NOT NULL DEFAULT true,
    can_receive_stock_alerts BOOLEAN NOT NULL DEFAULT true,
    can_receive_daily_summary BOOLEAN NOT NULL DEFAULT true,
    can_receive_weekly_reports BOOLEAN NOT NULL DEFAULT true,
    can_edit_medicines BOOLEAN NOT NULL DEFAULT false,
    can_confirm_doses BOOLEAN NOT NULL DEFAULT true,
    notification_channels TEXT[] NOT NULL DEFAULT '{"in_app", "email"}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_permissions_modtime
    BEFORE UPDATE ON public.caretaker_permissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 9. PRESCRIPTIONS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doctor_id UUID REFERENCES public.doctors(id) ON DELETE SET NULL,
    doctor_name TEXT,
    prescription_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    diagnosis TEXT,
    file_url TEXT,
    file_name TEXT,
    file_type TEXT,
    file_size BIGINT,
    notes TEXT,
    ocr_extracted_text TEXT,
    ocr_data JSONB,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient ON public.prescriptions(patient_id);

CREATE TRIGGER update_prescriptions_modtime
    BEFORE UPDATE ON public.prescriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 10. PRESCRIPTION REVISIONS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescription_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
    revision_number INT NOT NULL DEFAULT 1,
    change_summary TEXT NOT NULL,
    previous_file_url TEXT,
    updated_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------------------------------
-- 11. MEDICINE INVENTORY
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    medicine_id UUID NOT NULL UNIQUE REFERENCES public.medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    current_stock NUMERIC NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
    unit_name TEXT NOT NULL DEFAULT 'tablets',
    low_stock_threshold NUMERIC NOT NULL DEFAULT 10,
    last_refill_date DATE,
    last_refill_quantity NUMERIC,
    low_stock_alert_sent BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_patient ON public.medicine_inventory(patient_id);

CREATE TRIGGER update_inventory_modtime
    BEFORE UPDATE ON public.medicine_inventory
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 12. INVENTORY TRANSACTIONS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inventory_id UUID NOT NULL REFERENCES public.medicine_inventory(id) ON DELETE CASCADE,
    medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('dose_deduction', 'manual_refill', 'adjustment', 'correction')),
    quantity_change NUMERIC NOT NULL,
    balance_after NUMERIC NOT NULL,
    dose_id UUID REFERENCES public.scheduled_doses(id) ON DELETE SET NULL,
    reference_note TEXT,
    idempotency_key TEXT UNIQUE,
    performed_by UUID NOT NULL REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_tx_inventory ON public.inventory_transactions(inventory_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_dose ON public.inventory_transactions(dose_id);

-- --------------------------------------------------------------------
-- 13. NOTIFICATIONS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    dose_id UUID REFERENCES public.scheduled_doses(id) ON DELETE SET NULL,
    medicine_id UUID REFERENCES public.medicines(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN (
        'initial_reminder',
        'follow_up_reminder',
        'caretaker_overdue_alert',
        'caretaker_late_confirmation',
        'low_stock_alert',
        'refill_reminder',
        'system'
    )),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'read')),
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient ON public.notifications(recipient_id);
CREATE INDEX IF NOT EXISTS idx_notif_status ON public.notifications(status);

CREATE TRIGGER update_notifications_modtime
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 14. NOTIFICATION PREFERENCES
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    email_enabled BOOLEAN NOT NULL DEFAULT true,
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
    sms_enabled BOOLEAN NOT NULL DEFAULT false,
    push_enabled BOOLEAN NOT NULL DEFAULT true,
    quiet_hours_start TIME,
    quiet_hours_end TIME,
    push_subscription JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER update_preferences_modtime
    BEFORE UPDATE ON public.notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------
-- 15. NOTIFICATION DELIVERY LOGS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms', 'push')),
    recipient_address TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'simulated_test_mode')),
    attempts INT NOT NULL DEFAULT 1,
    error_message TEXT,
    provider_response JSONB,
    delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliv_logs_notif ON public.notification_delivery_logs(notification_id);

-- --------------------------------------------------------------------
-- 16. AUDIT LOGS
-- --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

-- --------------------------------------------------------------------
-- ROW LEVEL SECURITY (RLS) POLICIES
-- --------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_doses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_caretaker_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caretaker_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper function: check if user is caretaker for patient
CREATE OR REPLACE FUNCTION public.is_caretaker_for_patient(check_caretaker_id UUID, check_patient_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.patient_caretaker_relationships
        WHERE caretaker_id = check_caretaker_id
          AND patient_id = check_patient_id
          AND status = 'accepted'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles: users read and update their own, caretakers can view their patients
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id OR public.is_caretaker_for_patient(auth.uid(), id));

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Medicines: patients own, authorized caretakers can view
CREATE POLICY "Patients and caretakers can view medicines" ON public.medicines
    FOR SELECT USING (auth.uid() = patient_id OR public.is_caretaker_for_patient(auth.uid(), patient_id));

CREATE POLICY "Patients can insert medicines" ON public.medicines
    FOR INSERT WITH CHECK (auth.uid() = patient_id);

CREATE POLICY "Patients and caretakers with permission can update medicines" ON public.medicines
    FOR UPDATE USING (
        auth.uid() = patient_id OR 
        (public.is_caretaker_for_patient(auth.uid(), patient_id) AND EXISTS (
            SELECT 1 FROM public.caretaker_permissions cp
            JOIN public.patient_caretaker_relationships r ON cp.relationship_id = r.id
            WHERE r.caretaker_id = auth.uid() AND r.patient_id = medicines.patient_id AND cp.can_edit_medicines = true
        ))
    );

-- Scheduled doses: viewable by patient and caretakers, updatable for marking taken
CREATE POLICY "View scheduled doses" ON public.scheduled_doses
    FOR SELECT USING (auth.uid() = patient_id OR public.is_caretaker_for_patient(auth.uid(), patient_id));

CREATE POLICY "Update scheduled doses" ON public.scheduled_doses
    FOR UPDATE USING (
        auth.uid() = patient_id OR 
        (public.is_caretaker_for_patient(auth.uid(), patient_id) AND EXISTS (
            SELECT 1 FROM public.caretaker_permissions cp
            JOIN public.patient_caretaker_relationships r ON cp.relationship_id = r.id
            WHERE r.caretaker_id = auth.uid() AND r.patient_id = scheduled_doses.patient_id AND cp.can_confirm_doses = true
        ))
    );

-- Notifications: recipients can view and update their own notifications
CREATE POLICY "Recipients view own notifications" ON public.notifications
    FOR SELECT USING (auth.uid() = recipient_id);

CREATE POLICY "Recipients update own notifications" ON public.notifications
    FOR UPDATE USING (auth.uid() = recipient_id);

-- Storage bucket for prescriptions
INSERT INTO storage.buckets (id, name, public) 
VALUES ('prescriptions', 'prescriptions', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Patients can upload prescriptions" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'prescriptions' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Patients and caretakers can view prescriptions" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'prescriptions' AND (
            auth.uid()::text = (storage.foldername(name))[1] OR
            public.is_caretaker_for_patient(auth.uid(), (storage.foldername(name))[1]::uuid)
        )
    );

