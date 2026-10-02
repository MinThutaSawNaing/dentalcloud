-- MyDentist password security preflight: READ ONLY, no credential values.
-- Run the ENTIRE file with a database administrator in the correct project.
-- Save the results securely. Never export credential tables for this audit.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

-- Confirm the target in the dashboard as well: database names are not unique
-- between self-hosted Supabase installations.
SELECT current_database() AS database_name, version() AS postgres_version,
       current_user AS executing_role, now() AS checked_at;

SELECT table_schema, table_name, column_name, data_type, is_nullable,
       character_maximum_length
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'doctors', 'patient_auth', 'otp_codes', 'staff_auth_sessions')
ORDER BY table_name, ordinal_position;

-- Useful capability inventory; installing an extension is NOT part of preflight.
SELECT name, default_version, installed_version
FROM pg_available_extensions WHERE name = 'pgcrypto';

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'doctors', 'patient_auth', 'otp_codes', 'staff_auth_sessions')
ORDER BY tablename, policyname;

SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('users', 'doctors', 'patient_auth', 'otp_codes', 'staff_auth_sessions')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name IN ('users', 'doctors', 'patient_auth', 'otp_codes', 'staff_auth_sessions')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, column_name, privilege_type;

-- Metadata only: do not output function bodies, which may contain secrets.
SELECT n.nspname AS schema_name, p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer, p.proconfig AS configuration,
       has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname ILIKE '%auth%' OR p.proname ILIKE '%password%'
       OR p.proname IN ('replace_treatment_costs', 'acknowledge_commission_recalculation'))
ORDER BY p.proname, arguments;

-- The queries below intentionally fail if required columns are missing.
-- Such a failure is a STOP condition, not permission to modify the schema.
SELECT 'users' AS credential_source, count(*) AS total,
       count(*) FILTER (WHERE password IS NULL) AS null_passwords,
       count(*) FILTER (WHERE password = '') AS empty_passwords,
       count(*) FILTER (WHERE password <> btrim(password)) AS sql_trim_affected,
       count(*) FILTER (WHERE password ~ '^[[:space:]]|[[:space:]]$') AS whitespace_review,
       count(*) FILTER (WHERE octet_length(password) > 72) AS bcrypt_length_risk
FROM public.users
UNION ALL
SELECT 'doctors', count(*), count(*) FILTER (WHERE password IS NULL),
       count(*) FILTER (WHERE password = ''),
       count(*) FILTER (WHERE password <> btrim(password)),
       count(*) FILTER (WHERE password ~ '^[[:space:]]|[[:space:]]$'),
       count(*) FILTER (WHERE octet_length(password) > 72)
FROM public.doctors
UNION ALL
SELECT 'patient_auth', count(*), count(*) FILTER (WHERE password IS NULL),
       count(*) FILTER (WHERE password = ''),
       count(*) FILTER (WHERE password <> btrim(password)),
       count(*) FILTER (WHERE password ~ '^[[:space:]]|[[:space:]]$'),
       count(*) FILTER (WHERE octet_length(password) > 72)
FROM public.patient_auth;

-- Counts only; no names, email addresses, phone numbers, or passwords.
SELECT count(*) AS duplicate_staff_identifier_groups
FROM (SELECT lower(btrim(username)) FROM public.users
      GROUP BY lower(btrim(username)) HAVING count(*) > 1) duplicates;

SELECT count(*) AS duplicate_patient_email_groups
FROM (SELECT lower(btrim(email)) FROM public.patient_auth
      WHERE email IS NOT NULL AND btrim(email) <> ''
      GROUP BY lower(btrim(email)) HAVING count(*) > 1) duplicates;

SELECT count(*) AS duplicate_patient_username_groups
FROM (SELECT lower(regexp_replace(btrim(username), '\s+', ' ', 'g'))
      FROM public.patient_auth WHERE username IS NOT NULL AND btrim(username) <> ''
      GROUP BY lower(regexp_replace(btrim(username), '\s+', ' ', 'g'))
      HAVING count(*) > 1) duplicates;

SELECT count(*) AS duplicate_patient_auth_link_groups
FROM (SELECT patient_id FROM public.patient_auth
      GROUP BY patient_id HAVING count(*) > 1) duplicates;

SELECT count(*) FILTER (WHERE u.id IS NULL) AS doctors_without_staff_account,
       count(*) FILTER (WHERE u.id IS NOT NULL AND d.password IS DISTINCT FROM u.password)
         AS different_doctor_and_staff_credentials,
       count(*) FILTER (WHERE u.id IS NOT NULL
         AND lower(btrim(d.email)) IS DISTINCT FROM lower(btrim(u.username)))
         AS different_doctor_and_staff_identifiers
FROM public.doctors d LEFT JOIN public.users u ON u.doctor_id = d.id
WHERE d.password IS NOT NULL AND d.password <> '';

SELECT count(*) FILTER (WHERE is_verified = true) AS verified,
       count(*) FILTER (WHERE is_verified = false) AS unverified,
       count(*) FILTER (WHERE is_verified IS NULL) AS legacy_null_verification
FROM public.patient_auth;

SELECT count(*) AS stored_staff_sessions,
       count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now()) AS valid_staff_sessions
FROM public.staff_auth_sessions;

ROLLBACK;