-- Run only against a disposable local PostgreSQL database. No production data.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE patients (id uuid PRIMARY KEY, location_id uuid, name text, patient_unique_id text);
CREATE TABLE doctors (id uuid PRIMARY KEY, name text);
CREATE TABLE treatments (id uuid PRIMARY KEY, location_id uuid, patient_id uuid, doctor_id uuid, date date, cost numeric, description text, teeth integer[]);
CREATE TABLE payments (id uuid PRIMARY KEY, location_id uuid, patient_id uuid, payment_date date, created_at timestamptz, amount numeric, cleared_amount numeric, treatment_ids uuid[], receipt_snapshot jsonb, created_by_user_name text, payment_method text, receipt_number text);
CREATE TABLE appointments (id uuid PRIMARY KEY, location_id uuid, patient_id uuid, doctor_id uuid, date date, time time, created_at timestamptz, guest_name text, created_by_user_name text, type text, status text);
CREATE TABLE payment_allocations (payment_id uuid, payment_method text);
CREATE TABLE appointment_reschedule_logs (id uuid PRIMARY KEY, location_id uuid, created_at timestamptz, patient_name text, doctor_name text, admin_name text, reason text, original_date date, new_date date);
\ir ../supabase/migrations/20261103000001_mls_directory.sql
\ir ../supabase/migrations/20261103000002_audit_directory.sql

INSERT INTO patients VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Smoke Patient', 'SMOKE-1');
INSERT INTO doctors VALUES ('00000000-0000-0000-0000-000000000003', 'Smoke Doctor');
INSERT INTO treatments VALUES ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '2026-11-01', 100, 'Smoke Crown', ARRAY[11]);
INSERT INTO payments VALUES ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2026-11-02', '2026-11-02T01:00:00Z', 100, 100, ARRAY['00000000-0000-0000-0000-000000000004'::uuid], NULL, 'Cashier', 'DEBIT_CARD', 'SMOKE-RECEIPT');

DO $$
DECLARE result jsonb;
BEGIN
  result := public.mls_directory_page('00000000-0000-0000-0000-000000000002', NULL, NULL, 'Smoke', 'Smoke Doctor', 'Crown');
  IF (result->>'total')::int <> 1 OR jsonb_array_length(result->'payment_ids') <> 1 THEN
    RAISE EXCEPTION 'MLS filter smoke test failed: %', result;
  END IF;
  result := public.audit_directory('00000000-0000-0000-0000-000000000002', '2026-11-01', '2026-11-03', 'payments', 'Debit Card');
  IF (result->>'total')::int <> 1 THEN RAISE EXCEPTION 'Audit payment-label smoke test failed: %', result; END IF;
  result := public.audit_directory('00000000-0000-0000-0000-000000000002', '2026-11-01', '2026-11-01', 'treatments');
  IF NOT (result->'context' @> '[{"kind":"payment","ids":["00000000-0000-0000-0000-000000000005"]}]'::jsonb) THEN
    RAISE EXCEPTION 'Audit cross-date context smoke test failed: %', result;
  END IF;
  result := public.mls_directory_page('00000000-0000-0000-0000-000000000099');
  IF (result->>'total')::int <> 0 THEN RAISE EXCEPTION 'Branch isolation failed'; END IF;
END;
$$;

-- Exercise normalization through the RPC and verify its effect on later FIFO debt.
-- Each case starts with the same patient history; all changes are rolled back.
BEGIN;
DO $$
DECLARE
  base jsonb := '{"receiptNumber":" R-1 ","receiptDate":"2026-11-02","currency":"USD","payment":{"status":"FULL"}}';
  candidate jsonb; result jsonb; ids uuid[];
  loc uuid := '00000000-0000-0000-0000-000000000002';
  patient uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO payments (id, location_id, patient_id, payment_date, created_at, amount)
    VALUES ('00000000-0000-0000-0000-000000000006', loc, patient, '2026-11-03', '2026-11-03', 100);
  FOR candidate IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    -- Partial snapshots must be ignored even when they contain parseable totals.
    '{"treatments":null,"medicines":null,"payment":{"serviceFeeAmount":"bad"}}'::jsonb,
    base - 'receiptNumber' || '{"payment":{"status":"FULL","serviceFeeAmount":100}}',
    base - 'receiptDate' || '{"treatments":{"id":"bad"}}',
    base || '{"receiptNumber":123,"payment":{"status":"FULL","serviceFeeAmount":100}}',
    base || '{"receiptDate":"  ","medicines":true}',
    base || '{"currency":"EUR","payment":{"status":"FULL","serviceFeeAmount":100}}',
    base || '{"payment":{"status":"PENDING","serviceFeeAmount":100}}',
    base || '{"treatments":null,"medicines":null,"payment":{"status":"PARTIAL","serviceFeeAmount":"not-money"}}',
    base || '{"treatments":{},"medicines":"bad","payment":{"status":"FULL","serviceFeeAmount":"Infinity"}}',
    base || '{"treatments":false,"medicines":42,"payment":{"status":"FULL","serviceFeeAmount":"1e999999"}}',
    -- Invalid lines must not contribute IDs or totals; valid malformed numbers are zero.
    base || '{"treatments":[null,42,{"id":"00000000-0000-0000-0000-000000000099","finalCost":100},{"id":" ","date":"x","description":"x","finalCost":100},{"id":"00000000-0000-0000-0000-000000000004","date":"x","description":"x","finalCost":"NaN"}],"medicines":[{}, {"id":"m","date":"x","medicineName":"M","totalPrice":"bad"}],"payment":{"status":"FULL","serviceFeeAmount":{}}}',
    base || '{"treatments":[],"medicines":[{"id":"m","date":"x","medicineName":"","medicine_name":"ignored","totalPrice":100},{"id":42,"date":"x","medicineName":"M","totalPrice":100}],"payment":{"status":"FULL","serviceFeeAmount":"NaN"}}'
  )) LOOP
    UPDATE payments SET treatment_ids = NULL, receipt_snapshot = candidate
      WHERE id = '00000000-0000-0000-0000-000000000005';
    result := public.mls_directory_page(loc, NULL, NULL, '', 'Smoke Doctor', 'Crown');
    IF (result->>'total')::int <> 1 OR result->'payment_ids' <> '["00000000-0000-0000-0000-000000000005"]'::jsonb THEN
      RAISE EXCEPTION 'Snapshot normalization/FIFO failed: snapshot %, result %', candidate, result;
    END IF;
  END LOOP;

  -- JS number coercion, whitespace trimming and binary floating-point rounding.
  UPDATE payments SET receipt_snapshot = base || '{"treatments":[{"id":"\t00000000-0000-0000-0000-000000000004\n","date":"x","description":"Crown","finalCost":[100]}],"medicines":[{"id":"m","date":"x","medicineName":"M","totalPrice":"1.005"}],"payment":{"status":"FULL","serviceFeeAmount":"0x14"}}', amount = 121, cleared_amount = 121
    WHERE id = '00000000-0000-0000-0000-000000000005';
  SELECT treatment_ids INTO ids FROM public.mls_patient_payment_links(loc, patient)
    WHERE payment_id = '00000000-0000-0000-0000-000000000006';
  IF ids IS DISTINCT FROM '{}'::uuid[] THEN RAISE EXCEPTION 'JS coercion/rounding left unexpected debt: %', ids; END IF;
  UPDATE payments SET amount = 100, cleared_amount = 100 WHERE id = '00000000-0000-0000-0000-000000000005';

  -- Aliases and trimmed IDs affect the remaining debt.
  UPDATE payments SET receipt_snapshot = base || '{"treatments":[{"id":" 00000000-0000-0000-0000-000000000004 ","date":"x","description":"Crown","finalCost":null,"final_cost":"60"}],"medicines":[{"id":"m","date":"x","medicine_name":"M","total_price":"20"}],"payment":{"status":"FULL","serviceFeeAmount":"20"}}'
    WHERE id = '00000000-0000-0000-0000-000000000005';
  result := public.mls_directory_page(loc, NULL, NULL, '', '', 'Crown');
  IF (result->>'total')::int <> 2 THEN RAISE EXCEPTION 'Normalized totals did not preserve remaining debt: %', result; END IF;

  -- Null treatment_ids must retain snapshot insertion order for residual cents.
  UPDATE treatments SET cost = 0.01;
  INSERT INTO treatments VALUES ('00000000-0000-0000-0000-000000000007', loc, patient, '00000000-0000-0000-0000-000000000003', '2026-11-01', 0.01, 'Second', ARRAY[12]);
  UPDATE payments SET amount = 0.01, cleared_amount = 0.01, receipt_snapshot = base || '{"treatments":[{"id":"00000000-0000-0000-0000-000000000007","date":"x","description":"Second","finalCost":0.01},{"id":"00000000-0000-0000-0000-000000000004","date":"x","description":"Crown","finalCost":0.01}]}'
    WHERE id = '00000000-0000-0000-0000-000000000005';
  SELECT treatment_ids INTO ids FROM public.mls_patient_payment_links(loc, patient)
    WHERE payment_id = '00000000-0000-0000-0000-000000000006';
  IF ids IS DISTINCT FROM ARRAY['00000000-0000-0000-0000-000000000004'::uuid] THEN
    RAISE EXCEPTION 'Nullable treatment_ids lost snapshot residual-cent ordering: %', ids;
  END IF;
END $$;
ROLLBACK;
\echo 'Directory PostgreSQL smoke assertions passed.'
