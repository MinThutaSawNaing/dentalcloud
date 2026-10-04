# MLS automatic sync

Completed MLS treatment/payment data is retained in memory for the current branch and session. Switching tabs reuses it without another full sync; an in-flight MLS download continues across navigation and is deduplicated when returning. Refresh and financial writes (including new payments, treatments and undo) invalidate it. Startup/branch reload and logout clear readiness and records. Returning to the browser or reconnecting retries failed MLS reads but does not invalidate successful data. This is session memory, not persistent/offline storage or changed-row synchronization.

MLS automatically fetches branch treatments and payments when opened. Its filters remain available while downloads run. The shared progress bar uses first-page counts and page completions; unknown counts show “Preparing MLS sync…”. Percentage stays below 100 until both reads and their enrichment finish. This is download progress, not a Supabase Realtime subscription or elapsed-time estimate.

Financial rows and editing are hidden during sync or errors. Separate MLS datasets prevent Patients background sync from overwriting financial records. Refresh and saved MLS costs trigger fresh reads. Branch/session changes discard stale responses. Failed downloads offer Retry, after both requests settle. Refreshing the first patient page no longer invalidates completed Patients history. No schema migration is required.

# Lean staff startup rollout

## What changed

- Staff/admin start on Patients when permitted, otherwise Appointments when permitted.
- Initial branch reads: first 100 patients, local today/tomorrow appointments, doctors, treatment types, loyalty rules, plus existing branch/type settings.
- Remaining patient rows still load in the background. This deliberately preserves existing directory pagination, QR scanning, and appointment patient selectors. This is not yet full server-side directory pagination.
- Clinical/financial history, expenses and medicine sales no longer load automatically at staff startup.
- Patient directory history sync starts automatically in the background after the Patients screen is ready. History-dependent values show sync placeholders, and history filters stay disabled until both datasets finish successfully. Failed syncs offer **Retry**.
- The live percentage uses downloaded rows against first-page exact totals, with equal weight for treatments and appointments. It is indeterminate while totals are unknown and capped at 99% until both reads finish. This is download progress, not a time estimate or Supabase Realtime subscription.
- Appointment screen already queries the selected day/filter/page from Supabase. Older dates remain accessible; failures show Retry.
- Opening a patient loads that patient's details, treatment history, appointments, payments and medicine sales. Payment opening/submission is blocked while these prerequisites are loading or failed. Receipt matching uses patient-scoped records.
- Reports/overview/AI/material-cost/expense screens load their complete required datasets when opened. These screens can still be slow: no incomplete totals are substituted to make them look fast.
- Doctor startup/ownership visibility remains on the legacy path.
- Patient reports cannot open/export while required patient reads are loading or failed. Treatment history is paginated, and later-page failures are not treated as complete histories.
- Session reset clears the selected patient and draft; stale appointment chart lookups cannot replace a newer selection. Patient-scoped payments retain branch/patient-scoped legacy receipt records.
- No database migration, new package, persistent patient cache, or automatic deployment.

## Refresh and multiple devices

Screen entry, manual refresh, and foreground/reconnect actions re-query supported operational reads. Opening a chart refreshes its patient details. This does NOT provide instant cross-device synchronization, offline writes, or new backend conflict guarantees. Existing atomic payment RPC remains unchanged.

## Before production deployment

Test in a preview/staging environment with synthetic records. Do not use real patient payments as a test.

1. Staff/admin login opens Patients; first rows and Doctors appear without downloading clinic-wide financial history. Confirm with browser Network tools.
2. Search an old patient not in the first 100. Open an appointment for such a patient before background patient loading completes; chart/profile must still open.
3. Today/tomorrow appointment filters work. Custom dates, all dates, search, doctor filters and later pages remain available.
4. Directory automatically syncs history without blocking patient search. Verify progress, Last Visit, upcoming appointment, treatment previews and historical filters against the old version.
5. Disconnect during a fetch. Check Retry, and ensure failure is not shown as no records/zero totals. Reconnect and retry.
6. On device B, add/edit a synthetic appointment. On device A, Refresh/reopen/return to the appointment screen; confirm the change appears. Repeat patient search/details and doctors.
7. Switch branches quickly during slow reads. Previous branch results must not appear in the new branch.
8. In staging, record treatment and medicine sale, pay, verify balance, receipt medicine lines and service-fee category. Repeat service-fee-only and repeat-payment prevention checks. Never submit a test payment in the live clinic.
9. Doctor account: patient visibility and home data must match previous behavior. Patient portal login remains unaffected.
10. Open Overview, Expenses, Material & Lab, audit log, inventory and AI. Compare totals and records with the old version; test Refresh/error handling.
11. Leave the app open through a permission poll. Operational forms should not remount when permissions have not changed.

## Rollback

Set the build environment variable `VITE_LEAN_STAFF_STARTUP=false`, rebuild, and deploy that build to restore the legacy startup download path. Vite embeds this setting at build time; changing it on an already-built deployment is insufficient. Keep the previous production build available for a complete rollback.

## Automated checks

### Consistent navigation caching

Staff tab navigation now shares in-flight reads and retains complete bundles for the current session for Patients, Doctors, Inventory, Expenses, Dashboard, AI Assistant and Users. Appointment pages are keyed by branch, permissions, resolved date, filters, page and refresh revision; Records retains complete range bundles. Storage configuration uses session-scoped memory, not persistent browser storage. Live messaging, presence, monitoring and settings subscriptions remain active; these are not bulk-history downloads.

Switching tabs and returning to the browser do not invalidate successful reads. Manual refresh, local successful mutations, branch/session changes and permission changes invalidate or isolate cached bundles. Patient charts still fetch patient-specific financial details on entry. Failed reads remain retryable and partial bundles are never cached. This is navigation caching, not incremental row synchronization: another device's changes require explicit Refresh. Reloading the page clears memory.

- `npx tsc --noEmit`
- `npm test -- --maxWorkers=2`
- `npm run build`

Tests use mocked backend reads and server-rendered components. Source guard tests do not replace browser/two-device testing. No Myanmar-to-Europe timing or live production query has been measured.