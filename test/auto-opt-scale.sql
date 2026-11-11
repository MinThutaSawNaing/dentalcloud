\set ON_ERROR_STOP on
\timing on
-- Disposable PG15 only. Runner supplies absolute paths to the real deployment SQL.
SET TIME ZONE 'Asia/Yangon';
SET work_mem = '4MB';
SET statement_timeout = '120s';
SET auto_explain.log_min_duration = -1;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE TABLE public.app_settings (id smallint PRIMARY KEY CHECK (id = 1), auto_onp_patient_type_enabled boolean DEFAULT false);
CREATE TABLE public.patients (id uuid PRIMARY KEY, location_id uuid, patient_type varchar(100), created_at timestamptz DEFAULT now(), balance numeric DEFAULT 0);
CREATE TABLE public.appointments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), date date NOT NULL, status varchar(20) DEFAULT 'Scheduled', cancellation_outcome text, notes text);
CREATE TABLE public.treatments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid REFERENCES patients(id), date date DEFAULT CURRENT_DATE, description text);
CREATE FUNCTION public.scale_id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT lpad(n::text,32,'0')::uuid $$;
INSERT INTO patients(id,patient_type,created_at)
SELECT scale_id(n), CASE WHEN n BETWEEN 100 AND 1099 THEN 'RNP' ELSE 'ONP' END, now()-interval '2 months' FROM generate_series(1,100000) n;
-- Exactly one million rows EACH. Patient 100000 has no earlier visit.
INSERT INTO appointments(patient_id,date,status)
SELECT scale_id(1+(n%99999)), CURRENT_DATE-2,
 CASE WHEN 1+(n%99999)=99998 THEN 'Scheduled' ELSE 'Completed' END
FROM generate_series(1,1000000) n;
INSERT INTO treatments(patient_id,date)
SELECT scale_id(1+(n%99999)), CURRENT_DATE-2 FROM generate_series(1,1000000) n;

-- Audit all UPDATE touches (not only changed values). Reject a full-table/no-op
-- UPDATE immediately, including one executed by migration or feature enable.
CREATE TABLE public.scale_patient_audit(id uuid, old_type text, new_type text);
CREATE FUNCTION public.scale_audit_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint; allowed text := current_setting('scale.allowed_patient',true);
BEGIN
 SELECT count(*) INTO n FROM new_rows;
 IF (allowed = 'maintenance' AND n > 200) OR
    (allowed IS DISTINCT FROM 'maintenance' AND (n > 1 OR EXISTS (SELECT FROM new_rows WHERE id::text IS DISTINCT FROM nullif(allowed,'')))) THEN
   RAISE EXCEPTION 'unsafe patient UPDATE: % touches, allowed %',n,allowed;
 END IF;
 INSERT INTO scale_patient_audit SELECT n.id,o.patient_type,n.patient_type FROM new_rows n JOIN old_rows o USING(id);
 RETURN NULL;
END $$;
CREATE TRIGGER scale_audit AFTER UPDATE ON patients REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION scale_audit_update();
\i :preflight
\i :onp_migration
\i :opt_migration
GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO anon,authenticated;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['patients','appointments','treatments','app_settings'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY custom_auth ON public.%I FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
VACUUM ANALYZE patients;
VACUUM ANALYZE appointments;
VACUUM ANALYZE treatments;
ANALYZE app_settings;
SET auto_explain.log_min_duration = 0;
CREATE TABLE public.scale_plans(label text, plan jsonb);
GRANT SELECT,INSERT ON scale_plans TO anon;
CREATE FUNCTION public.scale_plan(label text, query text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p jsonb; node jsonb; indexed boolean := false;
BEGIN
 EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' || query INTO p;
 FOR node IN SELECT value FROM jsonb_path_query(p,'$.** ? (exists (@."Relation Name"))') AS nodes(value) LOOP
   IF node->>'Relation Name' IN ('appointments','treatments') THEN
     IF node->>'Node Type' = 'Seq Scan' THEN RAISE EXCEPTION 'large visit seqscan: %',p; END IF;
     IF node->>'Index Name' IN ('idx_appointments_auto_opt_visit','idx_treatments_auto_opt_visit')
       AND node->>'Index Cond' LIKE '%patient_id%' THEN indexed := true; END IF;
   END IF;
 END LOOP;
 IF NOT indexed THEN RAISE EXCEPTION 'patient-bound visit index missing: %',p; END IF;
 INSERT INTO scale_plans VALUES(label,p);
 RAISE NOTICE '%: %',label,p;
END $$;
SET ROLE anon;
DO $$ BEGIN
 IF current_user <> 'anon' OR NOT row_security_active('patients') OR NOT row_security_active('appointments') OR NOT row_security_active('treatments') THEN RAISE EXCEPTION 'anon RLS not active'; END IF;
END $$;
SELECT scale_plan('appointment-hit', $$SELECT 1 FROM appointments WHERE patient_id=scale_id(1) AND status='Completed' AND date<CURRENT_DATE LIMIT 1$$);
SELECT scale_plan('appointment-miss', $$SELECT 1 FROM appointments WHERE patient_id=scale_id(100000) AND status='Completed' AND date<CURRENT_DATE LIMIT 1$$);
SELECT scale_plan('treatment-hit', $$SELECT 1 FROM treatments WHERE patient_id=scale_id(1) AND date<CURRENT_DATE LIMIT 1$$);
SELECT scale_plan('treatment-miss', $$SELECT 1 FROM treatments WHERE patient_id=scale_id(100000) AND date<CURRENT_DATE LIMIT 1$$);
INSERT INTO app_settings(id) VALUES(1);
EXPLAIN (ANALYZE, BUFFERS) UPDATE app_settings SET auto_opt_patient_type_enabled=true WHERE id=1;
DO $$ BEGIN IF EXISTS(SELECT FROM scale_patient_audit) THEN RAISE EXCEPTION 'migration/enable touched patients'; END IF; END $$;
SELECT set_config('scale.allowed_patient',scale_id(1)::text,false);
SET application_name='scale-qualifying';
EXPLAIN (ANALYZE, BUFFERS) INSERT INTO treatments(patient_id,date) VALUES(scale_id(1),CURRENT_DATE);
DO $$ BEGIN
 IF (SELECT count(*) FROM scale_patient_audit)<>1 OR (SELECT patient_type FROM patients WHERE id=scale_id(1))<>'OPT(ONP)' THEN RAISE EXCEPTION 'qualifying visit must convert exactly one'; END IF;
END $$;
SET application_name='scale-already-converted';
EXPLAIN (ANALYZE, BUFFERS) INSERT INTO treatments(patient_id,date) VALUES(scale_id(1),CURRENT_DATE);
DO $$ BEGIN IF (SELECT count(*) FROM scale_patient_audit)<>1 THEN RAISE EXCEPTION 'repeat touched patient'; END IF; END $$;
SET application_name='scale-history-miss';
EXPLAIN (ANALYZE, BUFFERS) INSERT INTO treatments(patient_id,date) VALUES(scale_id(100000),CURRENT_DATE);
DO $$ BEGIN IF (SELECT count(*) FROM scale_patient_audit)<>1 THEN RAISE EXCEPTION 'miss touched patient'; END IF; END $$;
SET application_name='scale-treatment-fallback';
SELECT set_config('scale.allowed_patient',scale_id(99998)::text,false);
EXPLAIN (ANALYZE, BUFFERS) INSERT INTO treatments(patient_id,date) VALUES(scale_id(99998),CURRENT_DATE);
DO $$ BEGIN IF (SELECT count(*) FROM scale_patient_audit)<>2 THEN RAISE EXCEPTION 'fallback must touch one'; END IF; END $$;
-- Bounded legacy maintenance: 1,000 eligible RNP patients, exactly 200 touched.
-- Roll back so the audit and fixture remain suitable for the concurrency phase.
BEGIN;
SELECT set_config('scale.allowed_patient','maintenance',true);
UPDATE app_settings SET auto_onp_patient_type_enabled=true WHERE id=1;
SET application_name='scale-bounded-onp';
DO $$ DECLARE n integer; BEGIN
 n := apply_auto_onp_patient_type(NULL);
 IF n <> 200 OR (SELECT count(*) FROM scale_patient_audit) <> 202 THEN RAISE EXCEPTION 'maintenance not bounded to 200: %',n; END IF;
 RAISE NOTICE 'bounded maintenance: exactly % patient updates',n;
END $$;
ROLLBACK;
RESET ROLE;
SELECT 'fixture counts' AS label,(SELECT count(*) FROM patients) patients,(SELECT count(*) FROM appointments) appointments,(SELECT count(*) FROM treatments) treatments;
SELECT label,plan->0->>'Execution Time' execution_ms,plan->0->'Plan'->>'Shared Hit Blocks' shared_hits,plan->0->'Plan'->>'Shared Read Blocks' shared_reads FROM scale_plans;