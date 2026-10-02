# Password security audit — 2026-10-02

## Completed

- Connected to the authorized server using the existing SSH key and strict
  known-host verification. The password supplied in chat was not used.
- Executed password_security_preflight.sql in a read-only transaction, ending
  with ROLLBACK. PostgreSQL 15.8; pgcrypto 1.3 installed in extensions schema.
- Credential records: 44 users, 27 doctors, 132 patient_auth rows.
- No null/empty passwords, SQL-trim-affected values, or passwords over 72 bytes
  in the aggregate checks. This does not establish all Unicode compatibility.
- No duplicate normalized staff identifiers, patient emails/usernames, or patient
  auth links in the checked groupings. No doctor/staff credential or identifier
  discrepancies; all checked doctors have linked staff accounts.
- All 132 patient_auth rows verified. 48 valid staff session rows.
- Confirmed anon can read doctors/password and patient_auth/password, and insert
  and update users, doctors, and patient_auth. Policies allow all operations for
  anon/authenticated on these tables and otp_codes. This remains a critical risk.
- Found a same-day backup with mode 600 and valid gzip compression. Compression
  validation is NOT a successful restore test.
- Took a fresh custom-format dump on the server in a root-only directory:
  /root/password-security-rehearsal-20261002 (dump and role inventory mode 600).
  Role inventory excludes role passwords. No credential dump was downloaded.

## Rehearsal status: FAILED — do not migrate

A separate dental-password-rehearsal container was created using the installed
PostgreSQL image, with network=none, no published ports, 768 MiB memory limit,
one CPU, and temporary database storage. Only this container was restarted or
recreated. Production containers were not restarted.

Full restore is blocked by a Supabase GraphQL function dependency:
function graphql_public.graphql(text, text, jsonb, jsonb) does not exist.
Earlier rehearsal-only issues included role privilege restoration and pg_net
preload configuration. Fix the isolated restore procedure and verify table data,
function dependencies, permissions, and ownership before proceeding. Restore used
--no-owner: it is not yet an authorization-equivalent production clone.

Restricted restore diagnostics remain in the root-only rehearsal directory.
Do not publish full restore logs: they can contain data. Do not expose the
rehearsal container to any network. Retain the fresh dump for recovery work;
clean up the isolated container when no longer needed. Its tmpfs data disappears
when stopped, so restore is required again before continuing.

## Production state

No credential conversion, schema migration, grants/policy changes, session
revocations, authentication deployment, or application push was performed.
Plaintext storage and permissive access are NOT fixed yet.

Next: finish isolated restore, implement server credential/recovery paths, run
real credential compatibility checks without printing secrets, and only then
perform the reviewed production cutover. Rotate the password shared in chat.