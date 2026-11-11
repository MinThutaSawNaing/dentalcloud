-- Opt-in, event-driven conversion. No backfill and no changes to visit history.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Never build large indexes while holding transactional schema locks. A DBA
-- must first run database/auto_opt_patient_type_indexes.sql in autocommit.
DO $$
DECLARE v_table TEXT; v_index TEXT; v_predicate TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['appointments', 'treatments'] LOOP
    v_index := 'idx_' || v_table || '_auto_opt_visit';
    SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_predicate
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam
    WHERE i.indexrelid = to_regclass('public.' || v_index)
      AND i.indrelid = to_regclass('public.' || v_table)
      AND i.indisvalid AND i.indisready AND am.amname = 'btree'
      AND i.indnkeyatts = 2 AND i.indexprs IS NULL
      AND pg_get_indexdef(i.indexrelid, 1, TRUE) = 'patient_id'
      AND pg_get_indexdef(i.indexrelid, 2, TRUE) = 'date';
    IF NOT FOUND OR (v_table = 'treatments' AND v_predicate IS NOT NULL)
      OR (v_table = 'appointments' AND v_predicate IS DISTINCT FROM '((status)::text = ''Completed''::text)') THEN
      RAISE EXCEPTION 'Missing, invalid or unexpected index %. Run and verify database/auto_opt_patient_type_indexes.sql first.', v_index;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS auto_opt_patient_type_enabled BOOLEAN NOT NULL DEFAULT FALSE;
-- Existing clinics use Myanmar/MMK. Explicit, reviewable clinical timezone,
-- independent of the database connection's default (often UTC).
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS auto_opt_clinical_timezone TEXT NOT NULL DEFAULT 'Asia/Yangon';

CREATE OR REPLACE FUNCTION public.auto_opt_patient_type_on_visit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_enabled BOOLEAN;
  v_timezone TEXT;
BEGIN
  IF TG_TABLE_NAME = 'appointments' THEN
    IF NEW.status IS DISTINCT FROM 'Completed' THEN RETURN NEW; END IF;
    -- Corrections to an already completed visit are not a new attendance event.
    IF TG_OP = 'UPDATE' THEN
      IF OLD.status = 'Completed' THEN RETURN NEW; END IF;
    END IF;
  END IF;

  SELECT auto_opt_patient_type_enabled, auto_opt_clinical_timezone
  INTO v_enabled, v_timezone FROM public.app_settings WHERE id = 1;
  IF NOT COALESCE(v_enabled, FALSE) THEN
    RETURN NEW;
  END IF;
  -- Reject backdated/future entries using the clinic's day, not session timezone.
  IF NEW.patient_id IS NULL OR NEW.date IS DISTINCT FROM (CURRENT_TIMESTAMP AT TIME ZONE v_timezone)::DATE THEN
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
-- Exclude protected types before the old refresh locks/updates them. The guard
-- above remains necessary for legacy clients and refreshes already in flight.
CREATE OR REPLACE FUNCTION public.apply_auto_onp_patient_type(p_location_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_updated_count INTEGER := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('apply_auto_onp_patient_type:global-maintenance', 0)
  ) THEN RETURN 0; END IF;
  IF NOT COALESCE((SELECT auto_onp_patient_type_enabled FROM public.app_settings WHERE id = 1), FALSE) THEN
    RETURN 0;
  END IF;
  -- Existing Auto ONP remains gradual maintenance, never an unbounded UPDATE.
  -- One client request changes at most 200 patients, not the whole table.
  WITH eligible AS MATERIALIZED (
    SELECT id FROM public.patients
    WHERE created_at <= NOW() - INTERVAL '1 month'
      AND (patient_type IS NULL OR patient_type NOT IN ('ONP', 'OPT(ONP)', 'OPT(RNP)'))
      AND (p_location_id IS NULL OR location_id = p_location_id)
    LIMIT 200
    FOR NO KEY UPDATE SKIP LOCKED
  )
  UPDATE public.patients patient
  SET patient_type = 'ONP'
  FROM eligible
  WHERE patient.id = eligible.id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_auto_onp_patient_type(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_auto_onp_patient_type(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
