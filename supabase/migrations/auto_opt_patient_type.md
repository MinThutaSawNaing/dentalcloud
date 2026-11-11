# Opt-in next-visit patient type conversion

Owned migration: `20261111000000_auto_opt_patient_type.sql`. No production execution or backfill is part of this change.

## Semantics

- `app_settings.auto_opt_patient_type_enabled` defaults to false. A missing singleton also disables conversion. Enabling only affects subsequent qualifying events, not existing rows.
- Attendance evidence is a newly inserted Completed appointment, a transition from another status to Completed, or a newly inserted treatment (including one without an appointment).
- Only an event with `date = CURRENT_DATE` qualifies. Historical/future inserts, edits to completed appointments, treatment edits, booking, cancellation, NO_SHOW outcomes, and guest appointments do not convert.
- Current patient type must be exactly ONP or RNP. At least one Completed appointment or treatment for this patient must have a strictly earlier DATE. Same-day repeats alone do not count. Prior history can be from any branch visible to the caller.
- Result is OPT(ONP) or OPT(RNP). Only that patient's current type changes; no appointment, treatment, fee or historical snapshot is rewritten. Transaction rollback also rolls back conversion.
- Dates are stored clinical DATE values; CURRENT_DATE follows the database session timezone and transaction date, matching clinical SQL defaults. No timestamp-to-date conversion, fixed Myanmar timezone, registration-date fallback, or rolling 24-hour window is introduced. App clients sometimes default dates using UTC ISO strings: align client/session dates before enabling near midnight. Late entry of a past visit intentionally does not convert.
- Auto ONP uses registration `created_at` and a one-month cutoff. That is not evidence of an actual first visit. An old registration with no earlier visit will retain ONP on its first recorded visit. The conversion uses the type present when the patient lock is acquired; if old Auto ONP has already changed RNP to ONP, provenance cannot be recovered.

## Parent integration contract

Exclude **both** OPT(ONP) and OPT(RNP) from the existing `apply_auto_onp_patient_type` RPC and legacy service fallback, including the fallback's final PATCH predicate (not merely its earlier SELECT). Those files remain parent-owned and are not modified here.

The migration independently guards OPT -> ONP on every patient update, even when the new setting is off. This closes stale fallback races. It also blocks an explicit manual OPT -> ONP write because it is indistinguishable from that fallback. Other patient fields in that write are preserved. Until the parent RPC filter is updated, its returned affected-row count can include guarded no-op type writes.

## Permissions and concurrency

Functions use SECURITY INVOKER, fixed search paths and no new public RPC or data grants. Existing clinical RPCs use invoker rights; complete_database_setup.sql installs permissive anon/authenticated RLS on these tables under custom application authentication. Trigger functions have PUBLIC execution revoked and are not callable RPCs. No RLS policy is weakened. Tests reproduce that architecture, not a stricter deployment's policy set. Callers need existing settings/history SELECT and patient UPDATE access; stricter grants can reject the encompassing clinical transaction, and hidden history can suppress conversion.

The trigger locks only the relevant patient FOR NO KEY UPDATE, compatible with FK KEY SHARE locks from concurrent visit inserts. Concurrent conversion and stale Auto ONP updates recheck the locked current type; conversion is idempotent. Ordinary PostgreSQL serialization/deadlock errors require whole-transaction retry.

**Known integration limit:** direct appointment UPDATE locks appointment then patient; record_treatment_atomic locks patient then appointment. Simultaneous completion/treatment of the same appointment can deadlock and PostgreSQL aborts one transaction without partial conversion. Parent must align that RPC's lock ordering (and audit its wider financial advisory-lock ordering) for deadlock-free operation. The new insert concurrency regression is not a proof against this existing workflow lock inversion. Do not use SKIP LOCKED here: that could silently lose the only qualifying visit event.

## Local regression execution

Windows PostgreSQL 15 installed locally:

```powershell
& 'D:\DentalCloud My Dentist Version\dentalcloud\test\run-auto-opt-postgres.ps1'
```

Override `-PgBin` with an absolute PostgreSQL binary directory if needed. Runner creates a random temporary cluster, binds loopback port 55439, runs tests, stops and removes it in finally. It accepts no external connection string and never uses an existing server. Port collision fails rather than selecting a different database. Do not run the SQL fixture against an existing database.

Tests use minimal schema columns from the real tables and the actual old Auto ONP RPC. They cover disabled/missing settings, enable-without-backfill, both conversions, no appointment treatments, unrelated types, same-day/registration distinction, excluded status/date events, historical edits, session timezone, RPC/fallback reset protection, preservation of balance, transaction rollback, anon/authenticated RLS access, reapplication and concurrent treatment/appointment inserts. They do not load the full financial/clinical RPC dependency graph. Concurrent workers have bounded SQL execution; their overlap is best-effort, not a deterministic scheduling proof.
