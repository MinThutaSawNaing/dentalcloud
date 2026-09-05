-- Atomically save branch receipt settings and canonical contact details for future receipts.
BEGIN;

CREATE OR REPLACE FUNCTION public.save_branch_receipt_identity(
  p_location_id UUID,
  p_receipt_header_title TEXT,
  p_receipt_email TEXT,
  p_location_address TEXT,
  p_location_phone TEXT,
  p_session_token TEXT,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  location_id UUID, location_name TEXT, location_address TEXT, location_phone TEXT,
  receipt_header_title TEXT, receipt_email TEXT, custom_receipt_header_title TEXT,
  custom_receipt_email TEXT, settings_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_user_id UUID;
  v_header TEXT := NULLIF(btrim(p_receipt_header_title), '');
  v_email TEXT := NULLIF(btrim(p_receipt_email), '');
  v_address TEXT := NULLIF(btrim(p_location_address), '');
  v_phone TEXT := NULLIF(btrim(p_location_phone), '');
  v_saved_at TIMESTAMPTZ;
BEGIN
  v_admin_user_id := public.require_branch_receipt_admin(p_location_id, p_session_token);

  IF v_header IS NOT NULL AND char_length(v_header) > 255 THEN
    RAISE EXCEPTION 'Receipt header title must be 255 characters or fewer.' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND char_length(v_email) > 320 THEN
    RAISE EXCEPTION 'Receipt email must be 320 characters or fewer.' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$' THEN
    RAISE EXCEPTION 'Receipt email is invalid.' USING ERRCODE = '22023';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    INSERT INTO public.branch_receipt_settings (location_id, receipt_header_title, receipt_email, updated_by)
    VALUES (p_location_id, v_header, v_email, v_admin_user_id)
    ON CONFLICT (location_id) DO NOTHING
    RETURNING updated_at INTO v_saved_at;
  ELSE
    UPDATE public.branch_receipt_settings AS settings
    SET receipt_header_title = v_header, receipt_email = v_email,
        updated_at = clock_timestamp(), updated_by = v_admin_user_id
    WHERE settings.location_id = p_location_id
      AND settings.updated_at IS NOT DISTINCT FROM p_expected_updated_at
    RETURNING settings.updated_at INTO v_saved_at;
  END IF;

  IF v_saved_at IS NULL THEN
    RAISE EXCEPTION 'Branch receipt identity was changed by another administrator. Reload and retry.'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.locations
  SET address = v_address, phone = v_phone
  WHERE id = p_location_id;

  RETURN QUERY SELECT * FROM public.get_branch_receipt_identity_for_admin(p_location_id, p_session_token);
END;
$$;

REVOKE ALL ON FUNCTION public.save_branch_receipt_identity(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_branch_receipt_identity(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;