-- Collapse automatic ONP conversion into one atomic database request and
-- prevent concurrent clients from running the same branch refresh together.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.apply_auto_onp_patient_type(
  p_location_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- Do not queue duplicate refreshes from simultaneous tabs or workstations.
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('apply_auto_onp_patient_type:' || COALESCE(p_location_id::TEXT, '*'), 0)
  ) THEN
    RETURN 0;
  END IF;

  IF NOT COALESCE((
    SELECT settings.auto_onp_patient_type_enabled
    FROM public.app_settings settings
    WHERE settings.id = 1
  ), FALSE) THEN
    RETURN 0;
  END IF;

  UPDATE public.patients patient
  SET patient_type = 'ONP'
  WHERE patient.created_at <= NOW() - INTERVAL '1 month'
    AND patient.patient_type IS DISTINCT FROM 'ONP'
    AND (p_location_id IS NULL OR patient.location_id = p_location_id);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_auto_onp_patient_type(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_auto_onp_patient_type(UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;