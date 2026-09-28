-- Category overrides sit between enabled treatment overrides and doctor defaults.
-- Apply before deploying the matching application. Existing treatment snapshots are untouched.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.doctor_treatment_commissions
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS public.doctor_category_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  fixed_amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT doctor_category_commissions_category_check CHECK (category = btrim(category) AND category <> ''),
  CONSTRAINT doctor_category_commissions_rate_check CHECK (commission_rate BETWEEN 0 AND 100),
  CONSTRAINT doctor_category_commissions_fixed_check CHECK (fixed_amount IS NULL OR fixed_amount >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_category_commissions_doctor_category_key
  ON public.doctor_category_commissions (doctor_id, lower(category));
CREATE INDEX IF NOT EXISTS doctor_category_commissions_doctor_idx
  ON public.doctor_category_commissions (doctor_id);

ALTER TABLE public.doctor_category_commissions ENABLE ROW LEVEL SECURITY;
-- Match the existing custom-auth doctor_treatment_commissions policy. The production
-- access model must be reviewed before enabling stricter RLS for BOTH tables.
CREATE POLICY doctor_category_commissions_access ON public.doctor_category_commissions
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_category_commissions TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_applicable_commission_rate(
  p_doctor_id UUID, p_treatment_id UUID
) RETURNS DECIMAL(12,2)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_default_fixed NUMERIC(12,2);
  v_default_percentage NUMERIC(5,2);
  v_treatment_rate NUMERIC(5,2);
  v_treatment_fixed NUMERIC(12,2);
  v_category_rate NUMERIC(5,2);
  v_category_fixed NUMERIC(12,2);
BEGIN
  SELECT d.commission_type, COALESCE(d.commission_per_visit, 0), COALESCE(d.commission_percentage, 0)
    INTO v_type, v_default_fixed, v_default_percentage
    FROM public.doctors d WHERE d.id = p_doctor_id;

  SELECT dtc.commission_rate, dtc.fixed_amount
    INTO v_treatment_rate, v_treatment_fixed
    FROM public.doctor_treatment_commissions dtc
    WHERE dtc.doctor_id = p_doctor_id AND dtc.treatment_id = p_treatment_id
      AND dtc.is_enabled = TRUE;

  SELECT cat.commission_rate, cat.fixed_amount
    INTO v_category_rate, v_category_fixed
    FROM public.treatment_types tt
    JOIN public.doctor_category_commissions cat
      ON cat.doctor_id = p_doctor_id AND lower(cat.category) = lower(btrim(tt.category))
    WHERE tt.id = p_treatment_id AND btrim(COALESCE(tt.category, '')) <> '';

  IF v_type = 'flat_visit' THEN
    IF v_treatment_fixed IS NOT NULL THEN RETURN v_treatment_fixed; END IF;
    IF v_category_fixed IS NOT NULL THEN RETURN v_category_fixed; END IF;
    RETURN COALESCE(v_default_fixed, 0);
  END IF;
  IF v_treatment_rate IS NOT NULL THEN RETURN v_treatment_rate; END IF;
  IF v_category_rate IS NOT NULL THEN RETURN v_category_rate; END IF;
  RETURN COALESCE(v_default_percentage, 0);
END;
$$;
REVOKE ALL ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_applicable_commission_rate(UUID, UUID) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;