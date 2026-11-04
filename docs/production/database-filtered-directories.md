# Database-filtered MLS and audit directories

## Status: pending feature, disabled by default

Database-filtered MLS and audit directories are **not Patient-equivalent** and are
not enabled for production by this change. With the flag unset (or anything other
than the exact string `true`), MLS uses the date-scoped existing-API loader
described below, and audit retains the original range loader. No directory
migrations are required to deploy that default-disabled frontend.

## Default MLS date-scoped loading (no migrations)

- Initial selection is the local Today payment date. Tomorrow and Custom fetch
  only their selected payment dates; clearing a date input does not request All.
- All explicitly requests all branch payments. A loading indicator remains until
  both payments and financial context finish; partial financial rows are hidden.
- Supporting treatment and payment histories are restricted to patients in the
  selected date range, requested in batches of at most 40 patient IDs. Histories
  are not date-limited: today's payment can settle an older treatment. Historical
  payments skip MLS/commission enrichment and are used only for allocation.
- Search and 100-row pagination remain local to the selected range. This does not
  provide server-side per-page selection; a busy date range still loads all its
  payment rows and represented patients' histories before showing totals.
- Date selections are debounced; date changes cancel superseded requests. Tab
  navigation keeps the current request alive and reuses a completed range in the
  current branch/session. Refresh and MLS saves invalidate these bundles.
- Browser-local legacy payments remain branch/date filtered and deduplicated
  against persisted receipts. Stale branch/session results cannot publish.

Before production rollout, verify Today/Tomorrow/Custom/All network requests,
cross-date balance allocations, costs/commissions, empty dates, failed requests,
cost-save refresh, rapid range switches, and branch/logout transitions on staging
with the actual schema/RLS. No new database migration is needed for these checks.

## Opt-in deployment

Only set `VITE_DATABASE_FILTERED_DIRECTORIES=true` at build time after staging
verification and migration review. Vite embeds this flag in the build; changing
it requires rebuilding/redeploying. To disable, remove it or set it to `false`
and rebuild. There is no automatic fallback to legacy on an enabled-path error.

Apply these migrations to the Supabase database **before** enabling the flag:

1. `supabase/migrations/20261103000001_mls_directory.sql`
2. `supabase/migrations/20261103000002_audit_directory.sql`

These add security-invoker read functions and supporting indexes. They do not
change clinical or payment records. Existing row-level security remains active.
Do not run against production without the normal migration review and backup
process. No database migration is automatically applied by the frontend build.

## Behavior

- MLS filters by payment date, patient identity, doctor, and treatment on the
  server, then loads 100 matching payments per page. Financial enrichment is
  restricted to patients represented on the selected page. Their historical
  payments are still necessary for correct legacy FIFO treatment allocation;
  those context payments are not displayed as additional results.
- Audit filters, grouped treatment visits, result counts, and pagination are
  evaluated before hydration. Related context records are used for financial
  display without adding unrelated rows to the selected page.
- Returning to a cached MLS query reuses its page within the session. Explicit
  refresh and successful MLS changes invalidate the relevant directory cache.
- Selecting See More explicitly requests the complete filtered result. Audit
  export similarly reads every filtered page rather than exporting only the
  current page. Ordinary search does not trigger a branch-wide history download.
- These directories represent persisted database records. Browser-local legacy
  payment entries are not injected into database counts/pages. Before rollout,
  reconcile any browser-only historical payments with the authoritative payment
  ledger. Their existing patient-history fallback is unchanged.

## Verification

Run TypeScript checking, the Vitest suite, and the production build. On staging,
apply the migrations and compare representative filters and financial values
against the previous view, including balance payments with no explicit treatment
IDs, cross-date payments, mixed payment methods, doctor accounts, visits with
multiple treatments, exports spanning multiple pages, and branch switching.

SQL source guards and mocked service tests are not a substitute for executing
the migrations against the actual PostgreSQL schema and permissions on staging.

A disposable PostgreSQL 15 smoke test is checked in at
`test/directory-postgres-smoke.sql`. Run it with `psql -v ON_ERROR_STOP=1 -f`
against an **empty local test database only**; it creates fixture tables and
roles. It covers function execution, branch isolation, payment-method search,
cross-date audit context, malformed legacy receipts, and allocation ordering.
This fixture is not a production migration and does not replace staging/RLS tests.