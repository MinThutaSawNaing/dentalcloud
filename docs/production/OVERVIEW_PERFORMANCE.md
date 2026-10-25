# Overview loading improvements

## Root cause

The default staff Overview waited for all historical patients, appointments,
treatments, expenses and payments, including account maintenance and unrelated
commission/payment cost enrichment, before rendering a report for just today.
Patient portal startup also loaded the branch directory and appointment history
and then performed independent reads sequentially. Doctor startup downloaded
other doctors' appointment/treatment history plus unrelated reporting data.

## Changes

- Staff/admin Overview requests the complete selected date range at the API,
  without truncating to a recent-record limit. Cache keys include the range,
  authorized scope, session, permissions and invalidation revision.
- Commission reporting unions treatment-date records with older treatments paid
  in-range. Batched treatment lookups use at most 50 IDs and retain authoritative
  payment-date ledger entries without double-counting legacy fallback entries.
- Overview payments retain tender allocations but skip unused correction,
  commission and material-cost enrichment. Other callers keep existing defaults.
- Expense synthesis bounds related reads to range candidates, preserves audit
  branch precedence and null-date fallback, and checks existing cost links across
  dates before synthesizing an expense.
- Recalls & Cancels loads its complete appointment/directory history only when
  selected. It has separate loading, error and retry states; saving an outcome
  invalidates and refreshes the owning loaders.
- Overview controls remain available during loading. Old financial totals are
  hidden during refresh/failure, rather than displayed under a new date range.
- Patient portal uses a single branch-scoped profile and patient-filtered,
  paginated appointments. Independent clinical/configuration reads run together.
  Files and receipt settings preserve their existing failure isolation.
- Doctor startup filters appointments/treatments by doctor at the API, bounds
  commission batch concurrency, and skips unused payments, reschedule logs and
  deferred expenses/sales. Doctor history remains complete for custom ranges.

## Validation and limitations

Run `npm test -- --maxWorkers=2`, `npm run build`, and
`node_modules/.bin/tsc --noEmit --pretty false` from the repository root.
Regression coverage includes >1,000-row pagination, payment-date commissions,
expense deduplication and branch fallback, cache/range races, patient-scoped
queries and error states.

No schema migration or production data write is required. These changes remove
unnecessary downloads; they do not promise a measured real-user load time.
Authenticated browser smoke tests and large-range performance measurements are
still needed with authorized clinic accounts. Large selected ranges and the
complete doctor/recall histories necessarily require more data than today's
staff Overview.