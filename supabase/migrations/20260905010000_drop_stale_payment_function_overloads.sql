-- Drop stale, never-dropped overloads of the payment functions.
-- Verified via pg_proc inspection on 2026-09-05: the application only ever calls
-- the current signatures (process_patient_payment with p_receipt_snapshot and
-- p_submission_key; correct_payment_record with p_edited_by_user_id), so these
-- obsolete variants are unreachable dead code with SECURITY DEFINER privileges.
--   * process_patient_payment(uuid,numeric,text,uuid[],date,uuid,text)
--       Pre-receipt-snapshot era; would insert payments without a snapshot.
--   * correct_payment_record(uuid,numeric,text,text)
--       Pre-audit era; no p_edited_by_user_id.
-- Additive-safe: no data changes. Run once in the Supabase SQL editor.
BEGIN;

DROP FUNCTION IF EXISTS public.process_patient_payment(
  UUID, NUMERIC, TEXT, UUID[], DATE, UUID, TEXT
);

DROP FUNCTION IF EXISTS public.correct_payment_record(
  UUID, NUMERIC, TEXT, TEXT
);

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Post-deploy verification: must return exactly 4 rows, all has_new_codes = true.
SELECT p.oid::regprocedure AS signature,
       (pg_get_functiondef(p.oid) LIKE '%CB_BANKING%') AS has_new_codes
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'process_patient_payment',
    'process_patient_split_payment',
    'correct_payment_record',
    'correct_split_payment_record'
  )
ORDER BY p.proname;
