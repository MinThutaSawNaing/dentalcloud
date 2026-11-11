-- PREPARATION ONLY: run with psql autocommit, never inside BEGIN or a migration
-- runner that wraps the whole file in a transaction. Build one index at a time.
-- Even concurrent builds consume I/O/disk: rehearse and schedule off peak.
SET lock_timeout = '5s';
SET statement_timeout = '15min';
SET maintenance_work_mem = '32MB';
SET max_parallel_maintenance_workers = 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_auto_opt_visit
  ON public.appointments (patient_id, date) WHERE status = 'Completed';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_treatments_auto_opt_visit
  ON public.treatments (patient_id, date);

-- Failed concurrent builds can leave invalid indexes. The main migration
-- refuses installation if either index is missing/invalid or has wrong keys.
-- Do not blindly retry IF NOT EXISTS: inspect any invalid index first.
SELECT indexrelid::regclass AS index_name, indisvalid, indisready,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index
WHERE indexrelid IN (to_regclass('public.idx_appointments_auto_opt_visit'),
                     to_regclass('public.idx_treatments_auto_opt_visit'));

RESET lock_timeout;
RESET statement_timeout;
RESET maintenance_work_mem;
RESET max_parallel_maintenance_workers;