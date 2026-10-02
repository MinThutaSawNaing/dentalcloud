-- Additive preparation only. No plaintext conversion or client revocation here.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE SCHEMA IF NOT EXISTS private_auth;
REVOKE ALL ON SCHEMA private_auth FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS private_auth.rollout_state (
  id boolean PRIMARY KEY DEFAULT true CHECK(id), frozen boolean NOT NULL DEFAULT false
);
INSERT INTO private_auth.rollout_state(id,frozen) VALUES(true,false) ON CONFLICT DO NOTHING;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_scheme text;
ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS password_scheme text;
ALTER TABLE public.patient_auth ADD COLUMN IF NOT EXISTS password_scheme text;

CREATE TABLE IF NOT EXISTS private_auth.patient_sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS private_auth.email_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('signup', 'reset')),
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS email_codes_lookup ON private_auth.email_codes(email,purpose,expires_at);
CREATE TABLE IF NOT EXISTS private_auth.request_limits (
  key text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL
);
REVOKE ALL ON ALL TABLES IN SCHEMA private_auth FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.secure_auth_limit(p_key text, p_limit integer, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_attempts integer;
BEGIN
  INSERT INTO private_auth.request_limits(key,window_start,attempts) VALUES(p_key,now(),1)
  ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN request_limits.window_start < now()-make_interval(secs=>p_seconds)
      THEN 1 ELSE request_limits.attempts+1 END,
    window_start=CASE WHEN request_limits.window_start < now()-make_interval(secs=>p_seconds)
      THEN now() ELSE request_limits.window_start END
  RETURNING attempts INTO v_attempts;
  RETURN v_attempts<=p_limit;
END $$;

CREATE OR REPLACE FUNCTION public.secure_auth_ready()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT frozen FROM private_auth.rollout_state WHERE id=true;
$$;
CREATE OR REPLACE FUNCTION public.secure_auth_converted()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.users WHERE password_scheme IS NULL AND password IS NOT NULL
    UNION ALL SELECT 1 FROM public.doctors WHERE password_scheme IS NULL AND password IS NOT NULL
    UNION ALL SELECT 1 FROM public.patient_auth WHERE password_scheme IS NULL AND password IS NOT NULL);
$$;

CREATE OR REPLACE FUNCTION public.secure_auth_session(p_kind text,p_id uuid,p_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_token uuid;
BEGIN
  IF p_kind='staff' THEN
    PERFORM 1 FROM public.users WHERE id=p_id AND password=p_hash FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credential changed; retry login'; END IF;
    INSERT INTO public.staff_auth_sessions(user_id) VALUES(p_id) RETURNING session_token INTO v_token;
  ELSIF p_kind='patient' THEN
    PERFORM 1 FROM public.patient_auth WHERE patient_id=p_id AND password=p_hash
      AND is_verified IS DISTINCT FROM false FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Credential changed; retry login'; END IF;
    INSERT INTO private_auth.patient_sessions(patient_id) VALUES(p_id) RETURNING token INTO v_token;
  ELSE RAISE EXCEPTION 'Invalid session kind'; END IF;
  RETURN v_token::text;
END $$;

CREATE OR REPLACE FUNCTION public.secure_auth_validate(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('kind','staff','id',u.id,'role',u.role,'doctor_id',u.doctor_id,
      'location_id',u.location_id,'username',u.username,'allowed_tabs',u.allowed_tabs)
  INTO v_result FROM public.staff_auth_sessions s JOIN public.users u ON u.id=s.user_id
  WHERE s.session_token::text=p_token AND s.revoked_at IS NULL AND s.expires_at>now();
  IF v_result IS NOT NULL THEN RETURN v_result; END IF;
  SELECT jsonb_build_object('kind','patient','id',s.patient_id,'role','patient') INTO v_result
  FROM private_auth.patient_sessions s WHERE s.token::text=p_token
    AND s.revoked_at IS NULL AND s.expires_at>now();
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.secure_auth_code(p_email text,p_purpose text,p_digest text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private_auth.email_codes SET used_at=now() WHERE email=p_email AND purpose=p_purpose AND used_at IS NULL;
  INSERT INTO private_auth.email_codes(email,purpose,digest,expires_at)
  VALUES(p_email,p_purpose,p_digest,now()+interval '20 minutes');
END $$;

CREATE OR REPLACE FUNCTION public.secure_auth_complete(p_email text,p_purpose text,p_digest text,p_hash text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_patient uuid;
BEGIN
  SELECT id INTO v_id FROM private_auth.email_codes WHERE email=p_email AND purpose=p_purpose
    AND digest=p_digest AND used_at IS NULL AND expires_at>now() ORDER BY expires_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT patient_id INTO v_patient FROM public.patient_auth WHERE email=p_email FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_purpose='signup' THEN
    UPDATE public.patient_auth SET is_verified=true WHERE email=p_email;
  ELSIF p_purpose='reset' AND p_hash LIKE '$argon2id$%' THEN
    UPDATE public.patient_auth SET password=p_hash,password_scheme='argon2id-exact-v1',is_verified=true WHERE email=p_email;
    UPDATE private_auth.patient_sessions SET revoked_at=now() WHERE patient_id=v_patient;
  ELSE RETURN false; END IF;
  UPDATE private_auth.email_codes SET used_at=now() WHERE id=v_id;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.secure_auth_revoke(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private_auth.patient_sessions SET revoked_at=now() WHERE token::text=p_token;
  UPDATE public.staff_auth_sessions SET revoked_at=now() WHERE session_token::text=p_token;
END $$;

CREATE OR REPLACE FUNCTION private_auth.revoke_changed_credentials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Migration preserves existing sessions; normal changes revoke them.
  IF NEW.password IS DISTINCT FROM OLD.password AND
    current_setting('private_auth.migration',true) IS DISTINCT FROM 'on' THEN
    IF TG_TABLE_NAME='users' THEN
      UPDATE public.staff_auth_sessions SET revoked_at=now() WHERE user_id=NEW.id;
    ELSIF TG_TABLE_NAME='patient_auth' THEN
      UPDATE private_auth.patient_sessions SET revoked_at=now() WHERE patient_id=NEW.patient_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS secure_password_session_revoke ON public.users;
CREATE TRIGGER secure_password_session_revoke AFTER UPDATE OF password ON public.users
FOR EACH ROW EXECUTE FUNCTION private_auth.revoke_changed_credentials();
DROP TRIGGER IF EXISTS secure_password_session_revoke ON public.patient_auth;
CREATE TRIGGER secure_password_session_revoke AFTER UPDATE OF password ON public.patient_auth
FOR EACH ROW EXECUTE FUNCTION private_auth.revoke_changed_credentials();

DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS identity FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'secure_auth_%'
  LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.identity);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.identity);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;