# Database-filtered MLS and audit directories

## Status: pending feature, disabled by default

Database-filtered MLS and audit directories are **not Patient-equivalent** and are
not enabled for production by this change. With the flag unset (or anything other
than the exact string `true`), the frontend retains the original `ae49495` MLS
loader, cost-save refresh, and audit range loader. No directory migrations are
required to deploy that default-disabled frontend.

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