# Doctor specialty-category commission rollout

Apply `supabase/migrations/20260928000000_add_doctor_category_commissions.sql`
**before** deploying the application changes. Do not expose the new UI first:
it requires the new table and `doctor_treatment_commissions.is_enabled` column.

1. Take a production database backup and verify that `doctors`,
   `treatment_types`, `doctor_treatment_commissions`, and the existing
   `get_applicable_commission_rate(uuid,uuid)` function are present.
2. Review existing commission-table RLS/grants. This migration matches the
   application's existing custom-auth Data API access pattern, which grants
   broad access to `anon` and `authenticated`. This pattern needs a separate
   authorization hardening project; do not mistake this RLS policy for an
   admin-only permission boundary.
3. Apply the migration in a maintenance window for doctor-rate edits. Reload
   PostgREST schema (the migration emits `NOTIFY pgrst, 'reload schema'`).
4. Run these read-only checks before deploying the frontend:

   ```sql
   SELECT to_regclass('public.doctor_category_commissions') AS category_rules,
          count(*) FILTER (WHERE NOT is_enabled) AS disabled_treatment_rules
     FROM public.doctor_treatment_commissions;
   SELECT proname, pg_get_function_result(oid) AS return_type
     FROM pg_proc WHERE oid = 'public.get_applicable_commission_rate(uuid,uuid)'::regprocedure;
   SELECT relrowsecurity FROM pg_class
     WHERE oid = 'public.doctor_category_commissions'::regclass;
   ```

5. On September 28, 2026, the migration was applied to the self-hosted
   production database after a fresh custom-format backup at
   `/root/mydentist/pre_category_commission_20260928.dump`. SQL tests of both
   percentage and fixed rates confirmed default → category → enabled treatment
   precedence, disable and re-enable behavior; the test inserts were rolled
   back. The anon Data API successfully selected the new table and flag.
   Still verify a controlled treatment/payment and the doctor editor after
   deploying the frontend; no production treatment or payment was created.
6. Deploy the frontend. Existing recorded treatments retain their commission
   snapshots, even when paid later; do not backfill them during rollout.

Rollback: revert the frontend first. Leave the additive table and flag in
place while investigating, and do not rewrite historical snapshots or ledger
entries. Pause doctor-rate editing during rollback; older clients do not show
the disable flag and may overwrite rules if their save logic is changed later.