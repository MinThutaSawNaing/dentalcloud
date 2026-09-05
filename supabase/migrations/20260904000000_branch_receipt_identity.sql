-- Branch-specific receipt identity with minimal public reads and secured admin writes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.branch_receipt_settings (
  location_id UUID PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  receipt_header_title TEXT,
  receipt_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT branch_receipt_settings_header_length
    CHECK (receipt_header_title IS NULL OR char_length(receipt_header_title) BETWEEN 1 AND 255),
  CONSTRAINT branch_receipt_settings_email_length
    CHECK (receipt_email IS NULL OR char_length(receipt_email) BETWEEN 3 AND 320)
);

ALTER TABLE public.branch_receipt_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.branch_receipt_settings FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.require_branch_receipt_admin(p_location_id UUID, p_session_token TEXT)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_admin_user_id UUID;
BEGIN
  IF p_location_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.locations AS location WHERE location.id = p_location_id
  ) THEN
    RAISE EXCEPTION 'Location not found.' USING ERRCODE = '22023';
  END IF;

  SELECT staff_user.id INTO v_admin_user_id
  FROM public.staff_auth_sessions AS session
  JOIN public.users AS staff_user ON staff_user.id = session.user_id
  WHERE session.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
    AND session.revoked_at IS NULL AND session.expires_at > NOW()
    AND staff_user.role = 'admin'
    AND (staff_user.location_id IS NULL OR staff_user.location_id = p_location_id)
  ORDER BY session.created_at DESC LIMIT 1;

  IF v_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'A valid administrator session for this location is required.' USING ERRCODE = '42501';
  END IF;
  RETURN v_admin_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_receipt_identity(p_location_id UUID)
RETURNS TABLE (
  location_id UUID, location_name TEXT, location_address TEXT, location_phone TEXT,
  receipt_header_title TEXT, receipt_email TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT location.id, location.name::TEXT, NULLIF(btrim(location.address), ''),
    NULLIF(btrim(location.phone), ''),
    COALESCE(NULLIF(btrim(branch_settings.receipt_header_title), ''),
      NULLIF(btrim(global_settings.receipt_header_title), ''),
      NULLIF(btrim(global_settings.app_name), ''), location.name::TEXT, 'DentalCloud Pro'),
    COALESCE(NULLIF(btrim(branch_settings.receipt_email), ''),
      NULLIF(btrim(global_settings.receipt_email), ''))
  FROM public.locations AS location
  LEFT JOIN public.branch_receipt_settings AS branch_settings ON branch_settings.location_id = location.id
  LEFT JOIN public.app_settings AS global_settings ON global_settings.id = 1
  WHERE location.id = p_location_id;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_receipt_identity_for_admin(
  p_location_id UUID, p_session_token TEXT
)
RETURNS TABLE (
  location_id UUID, location_name TEXT, location_address TEXT, location_phone TEXT,
  receipt_header_title TEXT, receipt_email TEXT, custom_receipt_header_title TEXT,
  custom_receipt_email TEXT, settings_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_branch_receipt_admin(p_location_id, p_session_token);
  RETURN QUERY
  SELECT resolved.*, NULLIF(btrim(settings.receipt_header_title), ''),
    NULLIF(btrim(settings.receipt_email), ''), settings.updated_at
  FROM public.get_branch_receipt_identity(p_location_id) AS resolved
  LEFT JOIN public.branch_receipt_settings AS settings ON settings.location_id = resolved.location_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_branch_receipt_identity(
  p_location_id UUID,
  p_receipt_header_title TEXT,
  p_receipt_email TEXT,
  p_session_token TEXT,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  location_id UUID,
  location_name TEXT,
  location_address TEXT,
  location_phone TEXT,
  receipt_header_title TEXT,
  receipt_email TEXT,
  custom_receipt_header_title TEXT,
  custom_receipt_email TEXT,
  settings_updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_user_id UUID;
  v_header TEXT := NULLIF(btrim(p_receipt_header_title), '');
  v_email TEXT := NULLIF(btrim(p_receipt_email), '');
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
    INSERT INTO public.branch_receipt_settings (
      location_id, receipt_header_title, receipt_email, updated_by
    ) VALUES (p_location_id, v_header, v_email, v_admin_user_id)
    ON CONFLICT (location_id) DO NOTHING
    RETURNING updated_at INTO v_saved_at;
  ELSE
    UPDATE public.branch_receipt_settings AS settings
    SET receipt_header_title = v_header,
        receipt_email = v_email,
        updated_at = clock_timestamp(),
        updated_by = v_admin_user_id
    WHERE settings.location_id = p_location_id
      AND settings.updated_at IS NOT DISTINCT FROM p_expected_updated_at
    RETURNING settings.updated_at INTO v_saved_at;
  END IF;

  IF v_saved_at IS NULL THEN
    RAISE EXCEPTION 'Branch receipt identity was changed by another administrator. Reload and retry.'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT * FROM public.get_branch_receipt_identity_for_admin(p_location_id, p_session_token);
END;
$$;

REVOKE ALL ON FUNCTION public.require_branch_receipt_admin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_branch_receipt_identity(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_receipt_identity(UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_branch_receipt_identity_for_admin(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_branch_receipt_identity_for_admin(UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.save_branch_receipt_identity(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_branch_receipt_identity(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
