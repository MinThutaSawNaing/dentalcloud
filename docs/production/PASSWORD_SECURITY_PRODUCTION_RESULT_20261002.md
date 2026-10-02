# Password security production result — 2026-10-02

## Applied and verified

- Production prepare, freeze, conversion, and cutover completed.
- Converted **204** credential records: **44 users**, **27 doctors**,
  **133 patient_auth** rows. All 204 stored hashes verified against original
  credentials in memory; no password values emitted in command output.
- Zero non-null credentials without a hash scheme. Three validated database
  constraints enforce bounded Argon2id encoded hashes for future writes.
- All **48** pre-existing valid staff tokens preserved. A live existing token
  validated through the new production endpoint.
- Anonymous password reads, direct account writes, legacy equality-login RPCs,
  and OTP table access revoked. Financial RPC plaintext re-entry removed.
- Only credential-auth and its password module deployed to production function
  mounts. Synthetic test endpoints and migration worker were not publicly deployed.
- Production synthetic staff create/login/wrong-password/session/logout smoke
  tests passed. Synthetic account removed afterwards.
- Live Netlify frontend asset changed and contains secure authentication transport
  and patient token handling. Verified HTTPS application/backend responses.
- Code pushed normally (no force) to origin/main and fork/main at d72ba4a.

## Tests

- 509 Vitest tests passed in 109 files.
- TypeScript no-emit check and production Vite build passed (existing bundle-size
  and mixed import warnings remain).
- Four Deno hash tests passed. Actual production Edge Runtime image executed
  Argon2id/WASM successfully in isolated rehearsal.
- Rehearsal login checks passed for all 176 accounts in snapshot, including staff
  username case/legacy space semantics and 48 existing tokens. One newer production
  patient account was not in that snapshot but included in the final fresh conversion.
- Isolated signup/resend/verification, reset/mail adapter, token single-use,
  privilege-denial, account-write, exact-new-password, and logout checks passed.
- Final review fixes include freeze-before-conversion, migration state gating,
  null credentials, duplicate staff handling, session-revocation triggers, and
  logging suppression with supabase_admin (including pgaudit/auto_explain).

## User-visible behavior and remaining scope

- Current users retain their passwords. Legacy staff trimming remains versioned;
  new passwords are exact strings. Valid staff tokens were not revoked by conversion.
- Old patient/tokenless sessions require one sign-in. Stale open clients must
  refresh; old plaintext login no longer works. Cutover included a short login pause.
- Shared patient phone/name identifiers were found. Matching multiple accounts
  with the same password now fails safely rather than returning the wrong patient;
  users can use email, username, or unique patient number. This intentional safety
  change may affect users relying on ambiguous phone-only login.
- Credential write authorization is enforced in the new backend. This is NOT a
  full clinical/financial-data RLS overhaul: unrelated legacy permissive policies
  still require a separate security project.
- Email generation was verified through an isolated fake delivery adapter, not
  by sending production patient emails. Production uses the existing Resend secrets.
- Pre-cutover backups contain historical plaintext. They remain restricted to
  root (mode 600) and were not downloaded. Apply retention/encryption requirements;
  never expose a restored old database before repeating secure conversion.
- Root password shared in chat was not used; rotate it separately.

## Recovery and cleanup

Fresh production checkpoint: /root/password-security-rehearsal-20261002/pre-secure-auth-production.dump
(mode 600). Do not reopen anonymous password access or legacy equality-login
after hashes exist: this would create pass-the-hash takeover.

Isolated test containers are removed after validation. Rehearsal artifacts remain
in the root-only directory for restricted recovery/audit work. Production
containers were not restarted for deployment; functions were mounted in place.