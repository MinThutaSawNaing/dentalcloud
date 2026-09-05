-- Allow fixed-per-visit doctors to override their fixed amount for a treatment.
-- Existing percentage override rows and historical commission entries remain unchanged.
BEGIN;

ALTER TABLE public.doctor_treatment_commissions
  ADD COLUMN IF NOT EXISTS fixed_amount NUMERIC(12,2);

ALTER TABLE public.doctor_treatment_commissions
  DROP CONSTRAINT IF EXISTS doctor_treatment_commissions_fixed_amount_check;

ALTER TABLE public.doctor_treatment_commissions
  ADD CONSTRAINT doctor_treatment_commissions_fixed_amount_check
  CHECK (fixed_amount IS NULL OR fixed_amount >= 0);

CREATE OR REPLACE FUNCTION public.get_applicable_commission_rate(
  p_doctor_id UUID,
  p_treatment_id UUID
)
RETURNS DECIMAL(12,2) AS $$
DECLARE
  v_commission_type TEXT;
  v_commission_per_visit DECIMAL(12,2);
  v_default_rate DECIMAL(5,2);
  v_custom_rate DECIMAL(5,2);
  v_fixed_amount DECIMAL(12,2);
BEGIN
  SELECT d.commission_type, COALESCE(d.commission_per_visit, 0), COALESCE(d.commission_percentage, 0)
  INTO v_commission_type, v_commission_per_visit, v_default_rate
  FROM public.doctors AS d
  WHERE d.id = p_doctor_id
  LIMIT 1;

  SELECT dtc.commission_rate, dtc.fixed_amount
  INTO v_custom_rate, v_fixed_amount
  FROM public.doctor_treatment_commissions AS dtc
  WHERE dtc.doctor_id = p_doctor_id
    AND dtc.treatment_id = p_treatment_id
  LIMIT 1;

  IF v_commission_type = 'flat_visit' THEN
    RETURN COALESCE(v_fixed_amount, v_commission_per_visit, 0);
  END IF;

  RETURN COALESCE(v_custom_rate, v_default_rate, 0);
END;
$$ LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;