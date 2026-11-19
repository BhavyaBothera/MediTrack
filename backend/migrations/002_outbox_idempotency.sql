-- ====================================================================
-- MediTrack - Database Migration 002: Notification Outbox Idempotency
-- ====================================================================
-- Purpose:
-- Adds a dedicated, database-enforced unique idempotency key column and
-- index to notification_delivery_logs. This guarantees that concurrent
-- notification enqueue operations cannot insert duplicate delivery jobs
-- for the same notification attempt across distributed workers.
-- ====================================================================

ALTER TABLE public.notification_delivery_logs 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliv_logs_idempotency 
ON public.notification_delivery_logs(idempotency_key);

COMMENT ON COLUMN public.notification_delivery_logs.idempotency_key IS 
'Unique, stable idempotency key preventing duplicate delivery job enqueue attempts across concurrent workers.';
