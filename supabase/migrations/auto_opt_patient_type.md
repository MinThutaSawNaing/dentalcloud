# Opt-in next-visit patient type conversion

Owned migration: `20261111000000_auto_opt_patient_type.sql`. No production execution or backfill is part of this change.

## Semantics

- `app_settings.auto_opt_patient_type_enabled` defaults to false. A missing singleton also disables conversion. Enabling only affects subsequent qualifying events, not existing rows.
- Attendance evidence is a newly inserted Completed appointment, a transition from another status to Completed, or a newly inserted treatment (including one without an appointment).
- Only an event dated today in the configured clinical timezone qualifies. Historical/future inserts, edits to completed appointments, treatment edits, booking, cancellation, NO_SHOW outcomes, and guest appointments do not convert.
- Current patient type must be exactly ONP or RNP. At least one Completed appointment or treatment for this patient must have a strictly earlier DATE. Same-day repeats alone do not count. Prior history can be from any branch visible to the caller.
- Result is OPT(ONP) or OPT(RNP). Only that patient's current type changes; no appointment, treatment, fee or historical snapshot is rewritten. Transaction rollback also rolls back conversion.
- `app_settings.auto_opt_clinical_timezone` defaults to `Asia/Yangon`, explicitly independent of connection timezone. Confirm this clinic-timezone assumption before enabling; other regions must change this preference to a PostgreSQL timezone name. Clients must enter clinical dates in that timezone. Late entry of a past visit intentionally does not convert.
- Auto ONP uses registration `created_at` and a one-month cutoff. That is not evidence of an actual first visit. An old registration with no earlier visit will retain ONP on its first recorded visit. The conversion uses the type present when the patient lock is acquired; if old Auto ONP has already changed RNP to ONP, provenance cannot be recovered.

## Parent integration contract

Both OPT types are excluded from the updated Auto ONP RPC. That older maintenance RPC now changes at most **200 patients per invocation**, skipping locked patients; catching up may require later refreshes. Its eligibility search can still scan patients (the cap bounds writes, not rows examined). The browser's missing-RPC bulk fallback has been removed: it never downloads all eligible IDs or fans out PATCH batches. If the RPC is missing, maintenance is skipped with a warning, while patient reads continue. Unchanged patient types are omitted from profile edits to avoid reverting a conversion when saving unrelated details.

## Request and memory budget

- Enabling/disabling performs one settings upsert, with **zero patient updates**. No backfill, background patient sweep or per-patient HTTP loop is launched by Auto OPT.
- A qualifying visit uses the existing clinical transaction: one singleton settings lookup, one patient-by-primary-key lock/read, up to two indexed EXISTS checks that stop at the first match, and at most one patient update. No patient/history arrays are returned to the browser by the conversion. Bulk imports still invoke one trigger per row; do not interpret this as permission to run unbounded imports.
- Treatment submission adds one patient-by-ID refresh after the sequential treatment batch, not a directory/history refetch. Deadlock retries remain bounded to two retries of a rolled-back request.
- ONP and OPT flags share one singleton polling read; no extra steady-state polling request versus the pre-feature client. Hidden tabs skip shared-settings polling and in-flight refreshes cannot overlap within a tab. Existing other settings polls and one realtime subscription per tab remain; this is not cross-device rate limiting.
- Preparing indexes is the only required whole-visit-table scanning step. It is explicit, separate from enabling, sequential and concurrent, with 32MB maintenance_work_mem and parallel maintenance workers disabled. That setting is not a total-server/RSS memory cap: concurrent workloads, cache, disk/temp space and deployed RAM must still be checked.

The migration independently guards OPT -> ONP on every patient update, even when the new setting is off. This closes stale fallback races. It also blocks an explicit manual OPT -> ONP write because it is indistinguishable from that fallback. Other patient fields in that write are preserved.

## Permissions and concurrency

Functions use SECURITY INVOKER, fixed search paths and no new public RPC or data grants. Existing clinical RPCs use invoker rights; complete_database_setup.sql installs permissive anon/authenticated RLS on these tables under custom application authentication. Trigger functions have PUBLIC execution revoked and are not callable RPCs. No RLS policy is weakened. Tests reproduce that architecture, not a stricter deployment's policy set. Callers need existing settings/history SELECT and patient UPDATE access; stricter grants can reject the encompassing clinical transaction, and hidden history can suppress conversion.

The trigger locks only the relevant patient FOR NO KEY UPDATE, compatible with FK KEY SHARE locks from concurrent visit inserts. Concurrent conversion and stale Auto ONP updates recheck the locked current type; conversion is idempotent. Older Auto ONP maintenance now uses one non-waiting global advisory lock across branch scopes: simultaneous workers skip instead of queueing duplicate maintenance. This is not a persistent cross-device cooldown: staggered calls can each process a bounded batch. Ordinary PostgreSQL serialization/deadlock errors require whole-transaction retry.

Direct appointment completion and treatment recording have opposite lock ordering. The client retries PostgreSQL `40P01` (whole transaction rolled back) at most twice on those paths. Network/timeout failures are never retried because their commit outcome is unknown. Exhausted retries are surfaced to staff. The concurrency regression tests inserts, not the full clinical RPC dependency graph; staging must exercise simultaneous completion/treatment. Do not use SKIP LOCKED: it could silently lose conversion.

## Production rollout (not executed)

1. Take and verify a restorable backup; record patient/appointment/treatment counts and type distribution.
2. Rehearse the two explicit scripts against a restored staging copy, including actual RLS and clinical RPCs. Do not run full database setup/reset scripts.
3. Schedule a low-traffic window. Run `database/auto_opt_patient_type_indexes.sql` with psql autocommit (never inside BEGIN). It builds the two indexes sequentially with CREATE INDEX CONCURRENTLY, a 5-second lock timeout and 15-minute statement timeout. This still uses disk/I/O and scans tables; monitor resources. Failed concurrent builds may leave invalid indexes: inspect validity and definitions, do not blindly retry IF NOT EXISTS or remove timeouts.
4. Only after both indexes are valid, apply `20261111000000_auto_opt_patient_type.sql`. It now refuses missing, invalid or unexpected indexes instead of creating them under schema locks. The short transactional installation still needs table locks (5-second lock timeout/120-second statement timeout); failure rolls back the installation, not the separately built indexes. Deploy the client, confirm clinical timezone, and leave the setting off until staging checks pass. Enabling changes only the singleton preference, not patient rows.
5. Verify one ONP and one RNP return visit, same-day repeat, booking/cancellation and Auto ONP coexistence. Monitor errors and compare counts. To stop conversions, disable the setting; existing conversions are intentionally retained. Never bulk-revert classifications without a reviewed patient-specific recovery plan.

## Local regression execution

Windows PostgreSQL 15 installed locally:

```powershell
& 'D:\DentalCloud My Dentist Version\dentalcloud\test\run-auto-opt-postgres.ps1'
```

Override `-PgBin` with an absolute PostgreSQL binary directory if needed. Runner creates a random temporary cluster, binds loopback port 55439, runs tests, stops and removes it in finally. It accepts no external connection string and never uses an existing server. Port collision fails rather than selecting a different database. Do not run the SQL fixture against an existing database.

Tests use minimal schema columns from the real tables and the actual old Auto ONP RPC. They cover disabled/missing settings, enable-without-backfill, both conversions, no appointment treatments, unrelated types, same-day/registration distinction, excluded status/date events, historical edits, session timezone, RPC/fallback reset protection, preservation of balance, transaction rollback, anon/authenticated RLS access, reapplication and concurrent treatment/appointment inserts. They do not load the full financial/clinical RPC dependency graph. Concurrent workers have bounded SQL execution; their overlap is best-effort, not a deterministic scheduling proof.

## Large synthetic verification — November 11, 2026

Run `D:\DentalCloud My Dentist Version\dentalcloud\test\run-auto-opt-scale.ps1` to create a disposable loopback PostgreSQL 15 cluster (port 55440). It seeds **100,000 patients, 1,000,000 appointments and 1,000,000 treatments**, applies the actual concurrent-index preparation and migration, and checks plans under anon RLS. The runner records logs outside the repository, stops PostgreSQL and removes the temporary database. It never accepts a production URL.

Observed locally:

| Check | Result |
| --- | --- |
| Migration and enabling | Zero patient UPDATE touches (statement-level audit) |
| Qualifying treatment | Exactly one patient updated; 5.796ms insert including trigger and test audit |
| Already converted repeat | Zero patient updates and no nested history lookup; 0.472ms |
| No prior history | Zero patient updates; 0.867ms |
| Treatment-only prior history | One patient update; 1.299ms |
| Real trigger history plans | Patient-bound index-only scans; 4–7 shared buffers, no large-table sequential scans in the tested cases |
| Older Auto ONP maintenance | Exactly 200 of 1,000 eligible patients updated; 13.124ms; test transaction rolled back |
| Concurrent same-patient pair | Exactly one conversion; 3.204s including deliberate 2-second lock hold and PowerShell job startup |

History hit/miss standalone EXPLAIN ANALYZE executions were 0.130–0.192ms. Concurrent index builds took 2.279s and 1.508s locally. Timings are synthetic measurements with warm/cache-dependent runs, **not production latency, throughput or memory guarantees**. The fixture does not reproduce all clinical RPCs, deployed RLS, real row widths, production hardware, endpoint/proxy limits or all-client traffic. Work_mem/maintenance_work_mem settings are not whole-process RAM caps. Production still requires the restored-staging and resource-monitoring rollout above; do not enable based solely on these numbers.
