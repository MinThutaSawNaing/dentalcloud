-- Freeze the applicable doctor commission when a treatment is created.
-- Later doctor/default/custom rate changes affect new treatments only.
BEGIN;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS commission_type_snapshot TEXT;

ALTER TABLE public.treatments
  ADD COLUMN IF NOT EXISTS commission_rate_snapshot NUMERIC(12,2);

ALTER TABLE public.treatments
  DROP CONSTRAINT IF EXISTS treatments_commission_type_snapshot_check;

ALTER TABLE public.treatments
  ADD CONSTRAINT treatments_commission_type_snapshot_check
  CHECK (commission_type_snapshot IS NULL OR commission_type_snapshot IN ('percentage', 'flat_visit'));

ALTER TABLE public.treatments
  DROP CONSTRAINT IF EXISTS treatments_commission_rate_snapshot_check;

ALTER TABLE public.treatments
  ADD CONSTRAINT treatments_commission_rate_snapshot_check
  CHECK (
    commission_rate_snapshot IS NULL OR (
      commission_rate_snapshot >= 0
      AND (commission_type_snapshot <> 'percentage' OR commission_rate_snapshot <= 100)
    )
  );

CREATE OR REPLACE FUNCTION public.set_treatment_commission_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_commission_type TEXT;
BEGIN
  IF NEW.doctor_id IS NULL THEN
    NEW.commission_type_snapshot := NULL;
    NEW.commission_rate_snapshot := NULL;
    RETURN NEW;
  END IF;

  SELECT d.commission_type
  INTO v_commission_type
  FROM public.doctors AS d
  WHERE d.id = NEW.doctor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor not found while snapshotting treatment commission';
  END IF;

  NEW.commission_type_snapshot := COALESCE(v_commission_type, 'percentage');
  NEW.commission_rate_snapshot := public.get_applicable_commission_rate(
    NEW.doctor_id,
    NEW.treatment_type_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_treatments_commission_snapshot ON public.treatments;
CREATE TRIGGER trg_treatments_commission_snapshot
BEFORE INSERT OR UPDATE OF doctor_id, treatment_type_id
ON public.treatments
FOR EACH ROW
EXECUTE FUNCTION public.set_treatment_commission_snapshot();

-- Freeze existing treatments at the rate that is applicable at deployment time.
UPDATE public.treatments AS treatment
SET
  commission_type_snapshot = doctor.commission_type,
  commission_rate_snapshot = public.get_applicable_commission_rate(
    treatment.doctor_id,
    treatment.treatment_type_id
  )
FROM public.doctors AS doctor
WHERE treatment.doctor_id = doctor.id
  AND (
    treatment.commission_type_snapshot IS NULL
    OR treatment.commission_rate_snapshot IS NULL
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
