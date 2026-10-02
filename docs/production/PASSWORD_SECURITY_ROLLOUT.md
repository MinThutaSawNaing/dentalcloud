# Password security rollout — blocked pending production preflight

## Status

This is preparation only. No authentication change or password conversion is
implemented by this document. Do not deploy a credential migration yet.

The repository currently uses plaintext custom authentication. This audit does
not fix that vulnerability. Production permissions and backend capabilities must
be verified before choosing and implementing the conversion.

## First step: read-only audit

1. Confirm the MyDentist dashboard/project/host. Do not use the ACT project.
2. Confirm a recent encrypted, access-restricted backup and an isolated restore.
3. Run the ENTIRE file:
   `D:\DentalCloud My Dentist Version\dentalcloud\docs\production\password_security_preflight.sql`.
4. Return metadata and aggregate results securely. No credential values are
   requested. Do not send password exports, reset codes, tokens, or database keys.
5. If any statement fails, stop. The explicit read-only transaction makes no
   data changes; use ROLLBACK to close an aborted transaction before continuing.
   Do not add columns or run the destructive complete_database_setup.sql script.

The SQL has not yet been executed against a PostgreSQL instance. Repository
tests can check its read-only structure but cannot establish schema compatibility.

## Required decisions and release gates

- Confirm whether this self-hosted Supabase runs Edge Functions and can run a
  maintained Argon2id implementation. Do not use bcrypt without addressing its
  72-byte limit. Do not invent a hashing implementation.
- Obtain an isolated database with the actual schema and representative,
  protected legacy credentials. Validate conversion without exporting secrets.
- Review duplicate identifiers and conflicting doctor credentials. Preserve
  account IDs and current successful login behavior; never choose a conflicting
  credential arbitrarily.
- Cover both SQL btrim and JavaScript trim behavior, Unicode, long passwords,
  phone normalization, email case, username spacing, duplicate patient records,
  verified/null/unverified status, and legacy doctor fallback in regression tests.
- Establish server authorization for account writes and recovery. Hashing alone
  does not prevent account takeover with permissive anonymous writes.
- Remove browser-side password comparisons and password-dependent signup resend.
- Ensure password writes and batch conversion cannot overwrite each other.
- Test rollback to a secure compatible release. Never restore plaintext access
  as a compatibility workaround.

## Session policy

Password conversion must not revoke valid staff tokens or change account IDs.
Upgrade a server-validated staff token silently when possible. Patient localStorage
and tokenless doctor sessions are not proof of authentication: never mint a trusted
session from a client-provided ID or role. Require one sign-in for these sessions
when backend enforcement becomes mandatory. No password change is needed solely
because of hashing. Incident evidence may require separate resets/notifications.

## Implementation and deployment order after gates pass

1. Implement a tested trusted credential/authentication module and recovery flows.
2. Add private hash storage and explicit migration state; restrict client access.
3. Test every account creation/update/login/reset route on the isolated database.
4. Deploy compatible backend paths and frontend before final credential cutover.
5. Perform resumable, locked/version-checked conversion in bounded batches.
   Verify each hash before atomically clearing its plaintext. Log IDs/counts only.
6. During final cutover, pause incompatible writes, refresh stale clients, remove
   plaintext fallback, and enforce server-authorized credentials and sessions.
7. Verify zero unexpected plaintext, successful role-specific logins, protected
   credential access, single-use reset tokens, and valid existing staff tokens.
8. Resume normal operation only after checks pass. Restrict historical backups
   and ensure any old-backup restore is remediated before reopening access.

No production deployment, push, or migration execution is authorized by merely
running the read-only audit. Use a reviewed deployment procedure after rehearsal.