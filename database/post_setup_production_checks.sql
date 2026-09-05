-- ============================================================================
-- POST SETUP PRODUCTION CHECKS
-- Purpose:
-- Run after complete_database_setup.sql and every migration under
-- supabase/migrations before opening the app.
--
-- This file is read-only. It does not modify schema or data.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Core table existence
-- ----------------------------------------------------------------------------
SELECT
  'core_tables' AS check_group,
  table_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = t.table_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('locations'),
    ('app_settings'),
    ('branch_receipt_settings'),
    ('users'),
    ('patients'),
    ('patient_types'),
    ('patient_auth'),
    ('appointment_types'),
    ('doctors'),
    ('doctor_schedules'),
    ('treatment_types'),
    ('treatments'),
    ('payments'),
    ('payment_allocations'),
    ('appointments'),
    ('medicines'),
    ('medicine_sales'),
    ('expenses'),
    ('scheduled_tasks')
) AS t(table_name)
ORDER BY table_name;

-- ----------------------------------------------------------------------------
-- 2. Required payment-related columns
-- ----------------------------------------------------------------------------
SELECT
  'payments_columns' AS check_group,
  c.column_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payments'
      AND column_name = c.column_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('amount'),
    ('original_amount'),
    ('cleared_amount'),
    ('balance_before'),
    ('remaining_balance'),
    ('payment_method'),
    ('payment_status'),
    ('receipt_number'),
    ('receipt_snapshot'),
    ('created_by_user_id'),
    ('created_by_user_name')
) AS c(column_name)
ORDER BY c.column_name;

-- Exact loyalty snapshots are required for safe treatment undo.
SELECT
  'clinical_undo_columns' AS check_group,
  c.table_name || '.' || c.column_name AS item,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = c.table_name
      AND column_name = c.column_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('treatments', 'loyalty_points_earned'),
    ('medicine_sales', 'loyalty_points_earned')
) AS c(table_name, column_name)
ORDER BY c.table_name, c.column_name;

-- ----------------------------------------------------------------------------
-- 3. Required app_settings columns
-- ----------------------------------------------------------------------------
SELECT
  'app_settings_columns' AS check_group,
  c.column_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'app_settings'
      AND column_name = c.column_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('clinical_fee_enabled'),
    ('clinical_fee_amount'),
    ('clinical_fee_new_patient_amount'),
    ('clinical_fee_returning_patient_amount'),
    ('receipt_email'),
    ('receipt_phone'),
    ('receipt_header_title'),
    ('currency_unit'),
    ('receipt_size'),
    ('hover_theme')
) AS c(column_name)
ORDER BY c.column_name;

-- ----------------------------------------------------------------------------
-- 4. Key RPC functions
-- ----------------------------------------------------------------------------
SELECT
  'rpc_functions' AS check_group,
  f.function_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = f.function_name
      AND pg_get_function_identity_arguments(p.oid) = f.identity_args
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('process_patient_payment', 'p_patient_id uuid, p_amount numeric, p_payment_method text, p_treatment_ids uuid[], p_payment_date date, p_receipt_snapshot jsonb, p_submission_key text, p_created_by_user_id uuid, p_created_by_user_name text'),
    ('process_patient_split_payment', 'p_patient_id uuid, p_amount numeric, p_allocations jsonb, p_treatment_ids uuid[], p_payment_date date, p_receipt_snapshot jsonb, p_submission_key text, p_created_by_user_id uuid, p_created_by_user_name text'),
    ('complete_appointment_with_clinical_fee', 'p_appointment_id uuid, p_skip_clinical_fee boolean'),
    ('sell_medicine_atomic', 'p_location_id uuid, p_patient_id uuid, p_medicine_id uuid, p_quantity numeric, p_treatment_id uuid, p_sale_date date, p_final_total numeric'),
    ('record_treatment_atomic', 'p_location_id uuid, p_patient_id uuid, p_doctor_id uuid, p_treatment_type_id uuid, p_teeth integer[], p_description text, p_cost numeric, p_standard_cost numeric, p_discount_amount numeric, p_pricing_note text, p_medications jsonb, p_treatment_date date'),
    ('undo_treatment_atomic', 'p_treatment_id uuid'),
    ('undo_medicine_sale_atomic', 'p_medicine_sale_id uuid'),
    ('delete_patient_atomic', 'p_patient_id uuid'),
    ('get_branch_receipt_identity', 'p_location_id uuid'),
    ('get_branch_receipt_identity_for_admin', 'p_location_id uuid, p_session_token text'),
    ('save_branch_receipt_identity', 'p_location_id uuid, p_receipt_header_title text, p_receipt_email text, p_session_token text, p_expected_updated_at timestamp with time zone')
) AS f(function_name, identity_args);

-- Split tender integrity: invalid_payment_count must be zero.
SELECT
  'payment_allocation_integrity' AS check_group,
  COUNT(*) FILTER (
    WHERE allocation_count = 0
       OR allocated_total <> cleared_amount
       OR (allocation_count = 1 AND only_method <> payment_method)
       OR (allocation_count > 1 AND payment_method <> 'MIXED')
  ) AS invalid_payment_count
FROM (
  SELECT p.id, p.cleared_amount, p.payment_method,
    COUNT(a.id) AS allocation_count,
    COALESCE(SUM(a.amount), 0) AS allocated_total,
    MIN(a.payment_method) AS only_method
  FROM public.payments p
  LEFT JOIN public.payment_allocations a ON a.payment_id = p.id
  GROUP BY p.id, p.cleared_amount, p.payment_method
) allocation_check;

-- ----------------------------------------------------------------------------
-- 5. Check for unwanted overloaded process_patient_payment function
-- ----------------------------------------------------------------------------
SELECT
  'rpc_overload_check' AS check_group,
  'process_patient_payment_service_fee_overload' AS item,
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'process_patient_payment'
      AND pg_get_function_identity_arguments(p.oid) =
        'p_patient_id uuid, p_amount numeric, p_payment_method text, p_treatment_ids uuid[], p_payment_date date, p_receipt_snapshot jsonb, p_service_fee_amount numeric, p_service_fee_category text, p_created_by_user_id uuid, p_created_by_user_name text'
  ) THEN 'UNEXPECTED_PRESENT' ELSE 'OK' END AS status;

-- ----------------------------------------------------------------------------
-- 6. Storage buckets
-- ----------------------------------------------------------------------------
SELECT
  'storage_buckets' AS check_group,
  b.bucket_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = b.bucket_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('app_logos'),
    ('patient_files')
) AS b(bucket_name);

-- ----------------------------------------------------------------------------
-- 7. Public table sequences
-- ----------------------------------------------------------------------------
SELECT
  'sequences' AS check_group,
  s.sequence_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND sequence_name = s.sequence_name
  ) THEN 'OK' ELSE 'MISSING' END AS status
FROM (
  VALUES
    ('patient_id_seq'),
    ('payment_receipt_seq')
) AS s(sequence_name);

-- ----------------------------------------------------------------------------
-- 8. Admin bootstrap account
-- ----------------------------------------------------------------------------
SELECT
  'admin_bootstrap' AS check_group,
  'admin_user' AS item,
  CASE WHEN EXISTS (
    SELECT 1
    FROM public.users
    WHERE username = 'admin'
      AND role = 'admin'
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ----------------------------------------------------------------------------
-- 9. App settings singleton row
-- ----------------------------------------------------------------------------
SELECT
  'singleton_rows' AS check_group,
  'app_settings_id_1' AS item,
  CASE WHEN EXISTS (
    SELECT 1
    FROM public.app_settings
    WHERE id = 1
  ) THEN 'OK' ELSE 'MISSING' END AS status;

-- ----------------------------------------------------------------------------
-- 10. RLS enabled on important tables
-- ----------------------------------------------------------------------------
SELECT
  'rls_enabled' AS check_group,
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'OK' ELSE 'DISABLED' END AS status
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'locations',
    'app_settings',
    'branch_receipt_settings',
    'users',
    'patients',
    'payments',
    'appointments',
    'treatments',
    'medicines',
    'medicine_sales'
  )
ORDER BY c.relname;

-- Branch receipt identity must be RPC-only: no direct client table privileges.
SELECT
  'branch_receipt_security' AS check_group,
  role_name AS item,
  CASE WHEN has_table_privilege(role_name, 'public.branch_receipt_settings',
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    THEN 'UNEXPECTED_PRIVILEGE' ELSE 'OK' END AS status
FROM (VALUES ('anon'), ('authenticated')) AS roles(role_name)
UNION ALL
SELECT
  'branch_receipt_security',
  'PUBLIC',
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace,
    LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
    WHERE n.nspname = 'public' AND c.relname = 'branch_receipt_settings'
      AND acl.grantee = 0
      AND acl.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
  ) THEN 'UNEXPECTED_PRIVILEGE' ELSE 'OK' END;

-- Exact branch receipt RPC signatures, definer/search-path safety, and execute ACLs.
WITH expected(signature, anon_execute, authenticated_execute) AS (
  VALUES
    ('public.require_branch_receipt_admin(uuid,text)'::TEXT, FALSE, FALSE),
    ('public.get_branch_receipt_identity(uuid)'::TEXT, TRUE, TRUE),
    ('public.get_branch_receipt_identity_for_admin(uuid,text)'::TEXT, TRUE, TRUE),
    ('public.save_branch_receipt_identity(uuid,text,text,text,timestamp with time zone)'::TEXT, TRUE, TRUE)
), inspected AS (
  SELECT expected.*, to_regprocedure(expected.signature) AS procedure_oid
  FROM expected
)
SELECT
  'branch_receipt_rpc_security' AS check_group,
  signature AS item,
  CASE
    WHEN procedure_oid IS NULL THEN 'MISSING'
    WHEN NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = procedure_oid) THEN 'INSECURE_SECURITY_MODE'
    WHEN NOT (SELECT COALESCE(array_to_string(p.proconfig, ','), '') LIKE '%search_path=public, pg_temp%'
              FROM pg_proc p WHERE p.oid = procedure_oid) THEN 'INSECURE_SEARCH_PATH'
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p,
      LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
      WHERE p.oid = procedure_oid AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN 'PUBLIC_EXECUTE_NOT_REVOKED'
    WHEN has_function_privilege('anon', procedure_oid, 'EXECUTE') IS DISTINCT FROM anon_execute THEN 'ANON_EXECUTE_MISMATCH'
    WHEN has_function_privilege('authenticated', procedure_oid, 'EXECUTE') IS DISTINCT FROM authenticated_execute THEN 'AUTHENTICATED_EXECUTE_MISMATCH'
    ELSE 'OK'
  END AS status
FROM inspected
ORDER BY item;

-- No stale or accidental overloads may remain exposed under these RPC names.
SELECT
  'branch_receipt_rpc_overloads' AS check_group,
  p.oid::regprocedure::TEXT AS item,
  'UNEXPECTED_SIGNATURE' AS status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_branch_receipt_identity',
    'get_branch_receipt_identity_for_admin',
    'save_branch_receipt_identity'
  )
  AND p.oid NOT IN (
    to_regprocedure('public.get_branch_receipt_identity(uuid)'),
    to_regprocedure('public.get_branch_receipt_identity_for_admin(uuid,text)'),
    to_regprocedure('public.save_branch_receipt_identity(uuid,text,text,text,timestamp with time zone)')
  )
ORDER BY p.oid::regprocedure::TEXT;

-- ----------------------------------------------------------------------------
-- 11. Summary counts
-- ----------------------------------------------------------------------------
SELECT 'summary_counts' AS check_group, 'locations' AS item, COUNT(*)::TEXT AS value FROM public.locations
UNION ALL
SELECT 'summary_counts', 'users', COUNT(*)::TEXT FROM public.users
UNION ALL
SELECT 'summary_counts', 'patients', COUNT(*)::TEXT FROM public.patients
UNION ALL
SELECT 'summary_counts', 'doctors', COUNT(*)::TEXT FROM public.doctors
UNION ALL
SELECT 'summary_counts', 'treatment_types', COUNT(*)::TEXT FROM public.treatment_types
UNION ALL
SELECT 'summary_counts', 'medicines', COUNT(*)::TEXT FROM public.medicines
UNION ALL
SELECT 'summary_counts', 'payments', COUNT(*)::TEXT FROM public.payments
UNION ALL
SELECT 'summary_counts', 'appointments', COUNT(*)::TEXT FROM public.appointments;

-- Doctor login integrity: both counts must be zero after the doctor login
-- repair migration. No credential values are returned.
SELECT
  'doctor_login_integrity' AS check_group,
  COUNT(*) FILTER (WHERE u.id IS NULL)::TEXT AS login_doctors_without_linked_user,
  COUNT(*) FILTER (
    WHERE u.id IS NOT NULL
      AND lower(btrim(u.username)) <> lower(btrim(d.email))
  )::TEXT AS linked_username_mismatches
FROM public.doctors d
LEFT JOIN public.users u ON u.doctor_id = d.id
WHERE NULLIF(btrim(d.email), '') IS NOT NULL
  AND NULLIF(btrim(d.password), '') IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 12. Human-readable completion marker
-- ----------------------------------------------------------------------------
SELECT 'post_setup_production_checks_complete' AS status;
