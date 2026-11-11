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

Both OPT types are excluded from the updated Auto ONP RPC and legacy service fallback, including the final PATCH predicate. Unchanged patient types are omitted from profile edits to avoid reverting a conversion when saving unrelated details.

The migration independently guards OPT -> ONP on every patient update, even when the new setting is off. This closes stale fallback races. It also blocks an explicit manual OPT -> ONP write because it is indistinguishable from that fallback. Other patient fields in that write are preserved.

## Permissions and concurrency

Functions use SECURITY INVOKER, fixed search paths and no new public RPC or data grants. Existing clinical RPCs use invoker rights; complete_database_setup.sql installs permissive anon/authenticated RLS on these tables under custom application authentication. Trigger functions have PUBLIC execution revoked and are not callable RPCs. No RLS policy is weakened. Tests reproduce that architecture, not a stricter deployment's policy set. Callers need existing settings/history SELECT and patient UPDATE access; stricter grants can reject the encompassing clinical transaction, and hidden history can suppress conversion.

The trigger locks only the relevant patient FOR NO KEY UPDATE, compatible with FK KEY SHARE locks from concurrent visit inserts. Concurrent conversion and stale Auto ONP updates recheck the locked current type; conversion is idempotent. Ordinary PostgreSQL serialization/deadlock errors require whole-transaction retry.

Direct appointment completion and treatment recording have opposite lock ordering. The client retries PostgreSQL `40P01` (whole transaction rolled back) at most twice on those paths. Network/timeout failures are never retried because their commit outcome is unknown. Exhausted retries are surfaced to staff. The concurrency regression tests inserts, not the full clinical RPC dependency graph; staging must exercise simultaneous completion/treatment. Do not use SKIP LOCKED: it could silently lose conversion.

## Production rollout (not executed)

1. Take and verify a restorable backup; record patient/appointment/treatment counts and type distribution.
2. Rehearse this single migration against a restored staging copy, including actual RLS and clinical RPCs. Do not run full database setup/reset scripts.
3. Schedule a low-traffic window. The migration is transactional with a 5-second lock timeout and 120-second statement timeout; index creation may lock writes. Failure rolls back the migration; investigate rather than removing timeouts.
4. Apply only this migration, deploy the client, confirm clinical timezone, and leave the setting off until staging checks pass. Enabling changes only the singleton preference, not patient rows.
5. Verify one ONP and one RNP return visit, same-day repeat, booking/cancellation and Auto ONP coexistence. Monitor errors and compare counts. To stop conversions, disable the setting; existing conversions are intentionally retained. Never bulk-revert classifications without a reviewed patient-specific recovery plan.

## Local regression execution

Windows PostgreSQL 15 installed locally:

```powershell
& 'D:\DentalCloud My Dentist Version\dentalcloud\test\run-auto-opt-postgres.ps1'
```

Override `-PgBin` with an absolute PostgreSQL binary directory if needed. Runner creates a random temporary cluster, binds loopback port 55439, runs tests, stops and removes it in finally. It accepts no external connection string and never uses an existing server. Port collision fails rather than selecting a different database. Do not run the SQL fixture against an existing database.

Tests use minimal schema columns from the real tables and the actual old Auto ONP RPC. They cover disabled/missing settings, enable-without-backfill, both conversions, no appointment treatments, unrelated types, same-day/registration distinction, excluded status/date events, historical edits, session timezone, RPC/fallback reset protection, preservation of balance, transaction rollback, anon/authenticated RLS access, reapplication and concurrent treatment/appointment inserts. They do not load the full financial/clinical RPC dependency graph. Concurrent workers have bounded SQL execution; their overlap is best-effort, not a deterministic scheduling proof.
