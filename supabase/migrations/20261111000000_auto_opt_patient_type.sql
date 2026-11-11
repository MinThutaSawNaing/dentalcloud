-- Opt-in, event-driven conversion. No backfill and no changes to visit history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS auto_opt_patient_type_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- These patient-scoped indexes support existence checks across all branches.
CREATE INDEX IF NOT EXISTS idx_appointments_auto_opt_visit
  ON public.appointments (patient_id, date) WHERE status = 'Completed';
CREATE INDEX IF NOT EXISTS idx_treatments_auto_opt_visit
  ON public.treatments (patient_id, date);

CREATE OR REPLACE FUNCTION public.auto_opt_patient_type_on_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'appointments' THEN
    IF NEW.status IS DISTINCT FROM 'Completed' THEN RETURN NEW; END IF;
    -- Corrections to an already completed visit are not a new attendance event.
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'Completed' THEN RETURN NEW; END IF;
    END IF;
  END IF;

  -- CURRENT_DATE matches the clinical RPC defaults. Backdated corrections/imports
  -- and future-dated records are not a current actual visit. Never use created_at:
  -- Auto ONP ages registration, which is NOT evidence of an earlier visit.
  IF NEW.patient_id IS NULL OR NEW.date IS DISTINCT FROM CURRENT_DATE THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE((SELECT auto_opt_patient_type_enabled
                  FROM public.app_settings WHERE id = 1), FALSE) THEN
    RETURN NEW;
  END IF;

  -- Serialize only this patient. NO KEY UPDATE is compatible with FK KEY SHARE
  -- locks held by concurrent treatment/appointment inserts (avoid lock upgrades).
  SELECT patient_type INTO v_type FROM public.patients
  WHERE id = NEW.patient_id FOR NO KEY UPDATE;
  IF v_type IS NULL OR v_type NOT IN ('ONP', 'RNP') THEN RETURN NEW; END IF;

  -- A prior actual visit must exist on a strictly earlier calendar day. Neither
  -- registration, booking, cancellation nor multiple same-day treatments count.
  IF EXISTS (SELECT 1 FROM public.appointments
             WHERE patient_id = NEW.patient_id AND status = 'Completed'
               AND date < NEW.date)
     OR EXISTS (SELECT 1 FROM public.treatments
                WHERE patient_id = NEW.patient_id AND date < NEW.date) THEN
    UPDATE public.patients
    SET patient_type = CASE v_type WHEN 'ONP' THEN 'OPT(ONP)' ELSE 'OPT(RNP)' END
    WHERE id = NEW.patient_id AND patient_type = v_type;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auto_opt_patient_type_on_visit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_auto_opt_appointment_visit ON public.appointments;
CREATE TRIGGER trg_auto_opt_appointment_visit
  AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.auto_opt_patient_type_on_visit();

DROP TRIGGER IF EXISTS trg_auto_opt_treatment_visit ON public.treatments;
CREATE TRIGGER trg_auto_opt_treatment_visit
  AFTER INSERT ON public.treatments
  FOR EACH ROW EXECUTE FUNCTION public.auto_opt_patient_type_on_visit();

-- Defense against BOTH the existing Auto ONP RPC and stale legacy PATCH batches.
-- Unconditional even when the opt-in is disabled: disabling does not undo a
-- conversion. A manual OPT -> ONP write is indistinguishable and is also blocked.
-- Preserve other fields in the same update (balance, loyalty points, etc.).
CREATE OR REPLACE FUNCTION public.preserve_opt_patient_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.patient_type IN ('OPT(ONP)', 'OPT(RNP)') AND NEW.patient_type = 'ONP' THEN
    NEW.patient_type := OLD.patient_type;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_opt_patient_type() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_preserve_opt_patient_type ON public.patients;
CREATE TRIGGER trg_preserve_opt_patient_type
  BEFORE UPDATE OF patient_type ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.preserve_opt_patient_type();

-- No new direct-call RPC, grants or RLS bypass. Trigger invocation uses existing
-- table privileges, as do record_treatment_atomic/apply_auto_onp_patient_type.
NOTIFY pgrst, 'reload schema';
COMMIT;
