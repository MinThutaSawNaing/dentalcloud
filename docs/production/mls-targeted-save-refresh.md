# Targeted refresh after MLS cost saves

## Root cause

The lean MLS save callback called `invalidateMaterialCostCaches`, which cleared
`mlsScope` through `invalidateMlsMemory`. The MLS lifecycle interpreted the cleared
scope as incomplete data and downloaded all clinic treatments and payments again.
The callback also launched a complete dashboard refresh after every cost save.

## Change

Successful cost saves against a ready lean MLS dataset preserve that dataset.
Only the saved patient's complete treatments and payments are re-read using the
existing branch-scoped APIs. Both reads finish before publication; old rows for
that patient are replaced and unrelated patients remain in memory. This includes
all of the patient's payments because cost saves recalculate their commission
ledger, not just the selected payment's costs.

Navigation/report/expense/audit caches are invalidated without clearing MLS
readiness. The eager dashboard download is removed; revisiting reporting screens
loads their invalidated bundles. Explicit Refresh, startup/branch changes, and
other financial mutations retain their existing full-sync behavior.

Publication checks session identity, branch, startup generation, MLS generation,
and request sequence. A failed scoped refresh does not publish partial results or
automatically start a full download loop: it raises a visible MLS error and leaves
full retry to the user. The legacy non-lean path retains its patient refresh.

## Validation

Regression tests execute the real cache invalidation and save-handler code with
synthetic/deferred API responses. They cover patient-only reads, repeated saves,
unrelated-row preservation, failed reads, and stale branch/session/generation
results. No production writes or deployment are needed for these checks.

Before deployment, use preview data to save material/lab/special-doctor costs on
successive payments; confirm patient-scoped Network requests, correct totals and
commissions, navigation cache invalidation, and explicit full Refresh behavior.