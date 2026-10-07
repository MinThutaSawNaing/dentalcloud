# MLS commission lookup optimization

## Scope

The lean staff MLS loader now requests up to three commission-ledger batches
concurrently for each of its treatment and payment reads. Previously each lookup
waited for every 50-ID request before starting the next. Both lookups may run at
once (up to six commission requests); the existing material-cost reader retains
its separate three-request bound. Other API consumers default to sequential
commission reads. No migration or new dependency is required.

Each GET remains limited to 50 IDs to preserve the existing custom gateway URL
limit workaround. This changes request scheduling, not the selected fields,
filters, pagination, accounting, permission checks, or writes. Successful results
are merged in input order. Treatment enrichment still falls back to stored
earnings on any ledger failure; payment enrichment still retains only the
successful input-order prefix. After a failure, no further unusable batches are
sent; already-started requests are allowed to settle.

All history is still downloaded. The existing session-memory cache, explicit
refresh/write invalidation, and branch/session stale-response guards are unchanged.
This is not persistent caching or changed-row synchronization.

## Evidence and limitations

`services/api.mlsQueryPerformance.test.ts` invokes both production read methods
with 300 synthetic treatments/payments and six commission batches per lookup.
With simulated 100 ms request latency, commission waiting drops from 600 ms to
200 ms. It compares mapped datasets and MLS financial rows, tests out-of-order
completion, returned/thrown failures, default concurrency, and the upper bound.
`App.syncNavigation.test.ts` verifies that MLS opts into three-request batching
and retains its navigation/session lifecycle behavior.

These are mocked-network results, not a prediction that the complete tab will
load three times faster. Live download time, database count/sort time, material
cost queries, and browser processing have not been measured.

## Preview validation before deploying

1. Use synthetic data in preview/staging. Compare initial MLS readiness time
   against the previous build under the same branch, dataset and network conditions.
2. Compare payment rows, material/lab/special-doctor totals, doctor earnings and
   net profit for Today, All and a historical custom range.
3. Confirm ledger URLs contain no more than 50 IDs and each lookup overlaps no
   more than three requests. Watch for rate limits or gateway errors.
4. Navigate away during sync, return, switch branches, and log out during sync.
   Verify no duplicated load and no old-branch/session data publication.
5. Test Retry after a simulated failed read, Refresh, and a synthetic MLS cost edit.

Rollback: remove the two `commissionRequestConcurrency: 3` options from the MLS
loader and rebuild, or deploy the prior build. No database rollback is needed.

## Follow-up: loading deadline, lighter reads and allocation processing

The lean MLS loader now uses planned (estimated) first-page counts for progress,
instead of asking PostgreSQL to count every matching row exactly. Estimates do
not control pagination or financial calculations: every page is still downloaded
until the last short page. Progress remains capped below 100 until enrichment
finishes. Other callers keep exact-count behavior by default.

MLS opts out of the payment correction history/editor join. Current payment
values, allocations, receipt snapshots, commission entries and MLS totals remain
included. Records/receipts keep their existing full query by default. Optional
relation fallback queries respect both MLS options.

The complete MLS read/enrichment flight has a 60-second deadline. A stalled read
now produces a retryable error rather than remaining on Preparing indefinitely.
No partial financial rows are published. The timer is cleared on completion;
late responses/progress after timeout, retry, logout or a branch/session change
cannot publish. The deadline releases the UI flight, not the underlying network
requests; already-started requests may continue until the transport settles.

Payment allocation now maintains a running allocated amount by payment ID
instead of filtering all earlier allocation rows for each selected treatment.
Rounding, FIFO behavior, historical allocation inputs and duplicate-ID handling
are preserved. For 1,000 independent synthetic payments, the old implementation
scanned 499,500 earlier allocation rows; the new implementation scans none at
that seam. One local 8,000-payment timing run dropped from 695 ms to 36 ms with
identical row count and total. This is a CPU microbenchmark, not live-tab latency.

Completed MLS datasets and pending-flight deduplication remain branch/session
scoped. Tab switches reuse them; refresh and financial mutations invalidate them.
No persistent patient-data cache or new dependency was added.

### Database deployment procedure

Apply `supabase/migrations/20261007000000_optimize_mls_payment_reads.sql` through
the normal migration process. It adds an idempotent branch/payment index matching
`location_id = ... ORDER BY created_at DESC, id ASC` and refreshes payment and
treatment planner statistics. It does not modify accounting records or policies.
This index is missing from the repository definitions; inspect live `pg_indexes`
for an equivalent index before deployment. Schedule an off-peak maintenance
window: normal index creation can block writes while it runs. The five-second
lock timeout bounds lock acquisition, not index build duration. For a large/busy
table, a DBA can build the same index with `CREATE INDEX CONCURRENTLY` outside a
transaction before applying this migration.

Validate in staging using `EXPLAIN (ANALYZE, BUFFERS)` under the application's
database role, for the actual branch-filtered payments query and representative
page offsets. Also compare cold/warm MLS readiness, Retry after a stalled read,
All/custom-date totals, and refresh after edits. Local mocked tests cannot verify
production query plans, network latency or the reported production session.

Rollback: redeploy the previous application build. The additional read index can
remain installed; it does not alter data semantics.

### MyDentist production result — 2026-10-07

- Connected to the authorized MyDentist host using existing SSH key authentication;
  no supplied password was stored or needed.
- Confirmed PostgREST targets the `postgres` database in `supabase-db`. The composite
  payment index was absent before deployment; the treatment ordering indexes exist.
- Validated the scheduled 2026-10-07 backup with `gzip -t`, then took a fresh
  custom-format database backup and verified its `pg_restore --list` manifest.
  Backup and deployment artifacts remain on the server at
  `/root/mls-performance-20261007T032450Z/` (not copied into Git).
- The first index attempt as `postgres` failed without changes because production
  tables are owned by `supabase_admin`. Retried as the confirmed table owner.
- Built `idx_payments_location_created_at_id` with `CREATE INDEX CONCURRENTLY`
  outside a transaction, using a five-second lock timeout and two-minute statement
  timeout. Then applied the repository migration: existing index was skipped and
  payment/treatment statistics were refreshed successfully.
- Postflight confirmed `indisvalid = true`, `indisready = true`, the expected
  `(location_id, created_at DESC, id)` definition, and a 168 kB index. The deployed
  migration SHA-256 matches the local file:
  `0a34d3012a68fbe900f12abfce5edf23d706bd3cfa6f5bb4a7d617fe0ef43722`.
- The production database has no `supabase_migrations.schema_migrations` table.
  No artificial migration history was created; the exact SQL, hash and results
  are retained in the deployment artifact directory. Reapplying this migration
  is idempotent.
- Read-only `EXPLAIN (ANALYZE, BUFFERS)` checks ran under `anon`, matching the
  application's API role, for the first payment page and a later offset. With
  about 2,543 payments, PostgreSQL still prefers a sequential scan and sort for
  the 1,000-row page. The narrow first-page check measured 5.068 ms before and
  3.827 ms after, but this is not a controlled benchmark or evidence that the
  new index improves current whole-tab latency. No planner settings or policies
  were changed to force index usage.
- Supabase service containers remained running and healthy where health checks
  are configured. The public HTTPS REST gateway returned the expected 401 for an
  unauthenticated request.
- Release checks: all 812 tests in 129 files passed, TypeScript passed, and Vite
  production build passed with large-chunk warnings. No authenticated browser
  MLS smoke test, financial test write, or frontend hosting deployment was made
  as part of this database verification. Source is ready for the requested Git
  push; live browser readiness remains a post-frontend-deployment check.