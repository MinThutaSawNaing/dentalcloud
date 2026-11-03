# Database-filtered MLS and audit directories

## Deployment

Apply these migrations to the Supabase database **before** deploying the frontend:

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