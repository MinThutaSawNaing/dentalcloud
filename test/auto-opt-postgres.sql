\set ON_ERROR_STOP on
-- ONLY for an empty disposable cluster (see run-auto-opt-postgres.ps1).
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.app_settings (id smallint PRIMARY KEY CHECK (id = 1), auto_onp_patient_type_enabled boolean DEFAULT false);
CREATE TABLE public.patients (id uuid PRIMARY KEY, location_id uuid, patient_type varchar(100), created_at timestamptz DEFAULT now(), balance numeric DEFAULT 0);
CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), date date NOT NULL, status varchar(20) DEFAULT 'Scheduled', cancellation_outcome text, notes text);
CREATE TABLE public.treatments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), date date DEFAULT CURRENT_DATE, description text);
\ir ../supabase/migrations/20260921000000_atomic_auto_onp_refresh.sql
\ir ../supabase/migrations/20261111000000_auto_opt_patient_type.sql
-- Reapplication must be safe.
\ir ../supabase/migrations/20261111000000_auto_opt_patient_type.sql
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['patients','appointments','treatments','app_settings'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY custom_auth ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
 END LOOP;
END $$;
CREATE FUNCTION public.assert_type(n integer, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text; BEGIN
 SELECT patient_type INTO actual FROM patients WHERE id = lpad(n::text,32,'0')::uuid;
 IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'patient % expected %, got %', n, expected, actual; END IF;
END $$;
SET ROLE anon;
INSERT INTO patients(id, patient_type, created_at)
SELECT lpad(n::text,32,'0')::uuid, CASE WHEN n = 2 THEN 'RNP' WHEN n = 9 THEN 'Walk-in' ELSE 'ONP' END,
 now() - interval '2 months' FROM generate_series(1,12) n;
INSERT INTO treatments(patient_id, date) SELECT id, CURRENT_DATE - 2 FROM patients;
-- Missing singleton, then default disabled are both inert.
INSERT INTO appointments(patient_id,date,status) VALUES (lpad('1',32,'0')::uuid,CURRENT_DATE,'Completed');
SELECT assert_type(1,'ONP');
INSERT INTO app_settings(id) VALUES (1);
INSERT INTO treatments(patient_id) VALUES (lpad('2',32,'0')::uuid);
SELECT assert_type(2,'RNP');
UPDATE app_settings SET auto_opt_patient_type_enabled = true;
SELECT assert_type(1,'ONP'); -- no backfill on enabling
-- Booking, cancel, no-show, guest, future and backdated completion are inert.
INSERT INTO appointments(patient_id,date,status,cancellation_outcome) VALUES
(lpad('1',32,'0')::uuid,CURRENT_DATE,'Scheduled',NULL),
(lpad('1',32,'0')::uuid,CURRENT_DATE,'Cancelled','NO_SHOW'),
(lpad('1',32,'0')::uuid,CURRENT_DATE,'No-show',NULL),
(lpad('1',32,'0')::uuid,CURRENT_DATE+1,'Completed',NULL),
(lpad('1',32,'0')::uuid,CURRENT_DATE-1,'Completed',NULL),
(NULL,CURRENT_DATE,'Completed',NULL);
INSERT INTO treatments(patient_id,date) VALUES
(lpad('1',32,'0')::uuid,CURRENT_DATE+1),(lpad('1',32,'0')::uuid,CURRENT_DATE-1);
UPDATE appointments SET notes = 'history correction' WHERE status = 'Completed';
UPDATE appointments SET date = CURRENT_DATE WHERE date = CURRENT_DATE-1;
SELECT assert_type(1,'ONP');
UPDATE appointments SET status = 'Completed' WHERE patient_id = lpad('1',32,'0')::uuid AND status = 'Scheduled';
SELECT assert_type(1,'OPT(ONP)');
-- Walk-in treatment without appointments and unrelated type preservation.
INSERT INTO treatments(patient_id) VALUES (lpad('2',32,'0')::uuid),(lpad('9',32,'0')::uuid);
SELECT assert_type(2,'OPT(RNP)');
SELECT assert_type(9,'Walk-in');
-- Registration age is NOT visit age. Same-day repeats preserve the type.
DELETE FROM treatments WHERE patient_id IN (lpad('3',32,'0')::uuid,lpad('4',32,'0')::uuid);
INSERT INTO treatments(patient_id) VALUES (lpad('3',32,'0')::uuid),(lpad('3',32,'0')::uuid);
INSERT INTO appointments(patient_id,date,status) VALUES (lpad('3',32,'0')::uuid,CURRENT_DATE,'Completed');
SELECT assert_type(3,'ONP');
-- Appointment-only history counts; scheduled history does not.
INSERT INTO appointments(patient_id,date,status) VALUES
(lpad('4',32,'0')::uuid,CURRENT_DATE-1,'Scheduled'),
(lpad('4',32,'0')::uuid,CURRENT_DATE,'Completed');
SELECT assert_type(4,'ONP');
INSERT INTO appointments(patient_id,date,status) VALUES (lpad('4',32,'0')::uuid,CURRENT_DATE-1,'Completed');
UPDATE appointments SET status = 'Completed' WHERE patient_id = lpad('4',32,'0')::uuid AND status = 'Completed';
SELECT assert_type(4,'ONP');
INSERT INTO appointments(patient_id,date,status) VALUES (lpad('4',32,'0')::uuid,CURRENT_DATE,'Completed');
SELECT assert_type(4,'OPT(ONP)');


SET TIME ZONE 'Pacific/Kiritimati';
INSERT INTO treatments(patient_id,date) VALUES (lpad('5',32,'0')::uuid,CURRENT_DATE-1);
INSERT INTO treatments(patient_id,date) VALUES (lpad('5',32,'0')::uuid,CURRENT_DATE);
SELECT assert_type(5,'OPT(ONP)');
SET TIME ZONE 'UTC';
UPDATE app_settings SET auto_onp_patient_type_enabled = true, auto_opt_patient_type_enabled = false;
SELECT apply_auto_onp_patient_type(NULL);
SELECT assert_type(1,'OPT(ONP)');
SELECT assert_type(2,'OPT(RNP)');
-- Legacy fallback PATCH must preserve other fields too.
UPDATE patients SET patient_type = 'ONP', balance = 123 WHERE id IN (lpad('1',32,'0')::uuid,lpad('2',32,'0')::uuid);
SELECT assert_type(1,'OPT(ONP)');
SELECT assert_type(2,'OPT(RNP)');
DO $$ BEGIN IF EXISTS (SELECT FROM patients WHERE id IN (lpad('1',32,'0')::uuid,lpad('2',32,'0')::uuid) AND balance <> 123) THEN RAISE EXCEPTION 'balance update lost'; END IF; END $$;
UPDATE app_settings SET auto_opt_patient_type_enabled = true;
BEGIN;
INSERT INTO treatments(patient_id) VALUES (lpad('6',32,'0')::uuid);
SELECT assert_type(6,'OPT(ONP)');
ROLLBACK;
SELECT assert_type(6,'ONP');
SET ROLE authenticated;
INSERT INTO treatments(patient_id) VALUES (lpad('6',32,'0')::uuid);
SELECT assert_type(6,'OPT(ONP)');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_proc WHERE proname IN ('auto_opt_patient_type_on_visit','preserve_opt_patient_type') AND prosecdef) THEN RAISE EXCEPTION 'definer rights'; END IF;
END $$;
