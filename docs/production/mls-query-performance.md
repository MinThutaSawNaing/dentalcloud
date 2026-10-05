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