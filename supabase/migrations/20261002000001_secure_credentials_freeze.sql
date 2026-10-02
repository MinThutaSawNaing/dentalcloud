-- Mandatory short credential maintenance window before password conversion.
-- Clinical data and valid session tokens remain intact. Old login fails closed.
BEGIN;
SET LOCAL lock_timeout='3s';
UPDATE private_auth.rollout_state SET frozen=true WHERE id=true;
REVOKE SELECT,INSERT,UPDATE,DELETE ON public.users,public.doctors,public.patient_auth,public.otp_codes FROM anon,authenticated;
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
NOTIFY pgrst,'reload schema';
COMMIT;