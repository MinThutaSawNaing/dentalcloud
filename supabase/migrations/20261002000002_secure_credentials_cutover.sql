-- Run only after all credentials are converted and new clients/backend tested.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $$ DECLARE tbl text; invalid bigint; BEGIN
  FOREACH tbl IN ARRAY ARRAY['users','doctors','patient_auth'] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE password IS NOT NULL AND
      (password_scheme NOT IN (''argon2id-exact-v1'',''argon2id-trim-v1'') OR password_scheme IS NULL
       OR password NOT LIKE ''$argon2id$%%'')',tbl) INTO invalid;
    IF invalid>0 THEN RAISE EXCEPTION 'Unconverted credentials in %',tbl; END IF;
  END LOOP;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['users','doctors','patient_auth'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT secure_password_format CHECK
      (password IS NULL OR (password_scheme IS NOT NULL AND password_scheme IN (''argon2id-exact-v1'',''argon2id-trim-v1'')
       AND password ~ ''^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$''))',tbl);
  END LOOP;
END $$;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.users,public.doctors,public.patient_auth,public.otp_codes FROM anon,authenticated;
-- Remove column grants too: table-level revocation does not remove them.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name IN ('users','doctors','patient_auth','otp_codes')
  LOOP EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I) ON public.%I FROM anon,authenticated',
    r.column_name,r.column_name,r.column_name,r.table_name); END LOOP;
END $$;
GRANT SELECT(id,location_id,username,role,allowed_tabs,doctor_id,created_at,updated_at) ON public.users TO anon,authenticated;
GRANT SELECT(id,location_id,name,email,phone,specialization,commission_percentage,commission_per_visit,commission_type,created_at) ON public.doctors TO anon,authenticated;
GRANT SELECT(id,patient_id,location_id,username,email,phone,is_verified,created_at,updated_at,supabase_user_id) ON public.patient_auth TO anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.authenticate_staff_user(text,text),public.authenticate_staff_user_session(text,text) FROM PUBLIC,anon,authenticated;

-- Remove password re-entry from financial RPCs; retain existing valid tokens.
-- Replace only the exact legacy expression and fail if unexpected code is seen.
DO $$ DECLARE r record; body text; BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('replace_treatment_costs','acknowledge_commission_recalculation')
  LOOP
    body:=pg_get_functiondef(r.oid);
    IF body ~ 'u\.password\s*=\s*p_admin_password\s+OR\s+btrim\(u\.password\)\s*=\s*btrim\(p_admin_password\)' THEN
      body:=regexp_replace(body,'u\.password\s*=\s*p_admin_password\s+OR\s+btrim\(u\.password\)\s*=\s*btrim\(p_admin_password\)','false','g');
      IF body LIKE '%u.password%' THEN RAISE EXCEPTION 'Unremoved financial credential check'; END IF;
      EXECUTE body;
    ELSIF body LIKE '%u.password%' THEN RAISE EXCEPTION 'Unexpected legacy financial credential check'; END IF;
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;