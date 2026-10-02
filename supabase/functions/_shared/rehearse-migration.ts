// REHEARSAL ONLY: hard-coded isolated container. Never targets production DB.
// Requires local Deno and existing verified SSH key. No password arguments.
import { hashPassword, verifyPassword } from './passwords.ts';

const target = 'dental-password-rehearsal';

async function query(sql: string): Promise<string> {
  const child = new Deno.Command('ssh', {
    args: ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ConnectTimeout=10', 'root@13.140.149.162', 'docker', 'exec', '-i',
      target, 'psql', '-X', '-q', '-A', '-t', '-h', '/tmp', '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
    stdin: 'piped', stdout: 'piped', stderr: 'piped',
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(sql + '\n'));
  await writer.close();
  const result = await child.output();
  // Do not forward database diagnostics: they can contain credentials or SQL.
  if (!result.success) throw new Error('Isolated database query failed; output suppressed');
  return new TextDecoder().decode(result.stdout).trim();
}

function literal(value: string): string {
  if (value.includes('\0')) throw new Error('Invalid database string');
  return "'" + value.replaceAll("'", "''") + "'";
}

type Credential = { source: 'users' | 'doctors' | 'patient_auth'; id: string; password: string };

// Set log suppression inside each session before handling credential values.
// The isolated container has no external logging integrations or network.
const credentials: Credential[] = JSON.parse(await query(`
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SELECT coalesce(json_agg(row_to_json(c)), '[]'::json) FROM (
  SELECT 'users' AS source, id, password FROM public.users WHERE password IS NOT NULL
  UNION ALL SELECT 'doctors', id, password FROM public.doctors WHERE password IS NOT NULL
  UNION ALL SELECT 'patient_auth', id, password FROM public.patient_auth WHERE password IS NOT NULL
) c;
ROLLBACK;`));

await query(`
BEGIN;
CREATE SCHEMA IF NOT EXISTS password_rehearsal;
REVOKE ALL ON SCHEMA password_rehearsal FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS password_rehearsal.credentials (
  source text NOT NULL CHECK (source IN ('users', 'doctors', 'patient_auth')),
  source_id uuid NOT NULL,
  password_hash text NOT NULL,
  PRIMARY KEY (source, source_id)
);
REVOKE ALL ON TABLE password_rehearsal.credentials FROM PUBLIC, anon, authenticated;
COMMIT;`);

let verified = 0;
const writes: string[] = [];
const expectedHashes = new Map<string, string>();
for (const credential of credentials) {
  if (!['users', 'doctors', 'patient_auth'].includes(credential.source)) throw new Error('Invalid source');
  if (!/^[0-9a-f-]{36}$/.test(credential.id)) throw new Error('Invalid account ID');
  const hash = await hashPassword(credential.password);
  if (!await verifyPassword(credential.password, hash)) throw new Error('Hash self-verification failed');
  if (await verifyPassword(credential.password + '\u0001wrong', hash)) throw new Error('Wrong password accepted');
  // Compare-and-swap: never save a hash for a credential that changed meanwhile.
  writes.push(`
WITH locked AS (
  SELECT id FROM public.${credential.source}
  WHERE id = ${literal(credential.id)}::uuid AND password = ${literal(credential.password)}
  FOR UPDATE
), saved AS (
  INSERT INTO password_rehearsal.credentials(source, source_id, password_hash)
  SELECT ${literal(credential.source)}, id, ${literal(hash)} FROM locked
  ON CONFLICT (source, source_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
  RETURNING password_hash
)
SELECT password_hash FROM saved;
`);
  expectedHashes.set(`${credential.source}:${credential.id}`, hash);
}

await query(`BEGIN;
SET LOCAL log_statement = 'none';
SET LOCAL log_min_error_statement = 'panic';
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '3s';
${writes.join('\n')}
COMMIT;`);

const saved: { source: string; source_id: string; password_hash: string }[] = JSON.parse(
  await query(`SELECT coalesce(json_agg(row_to_json(c)), '[]'::json)
    FROM password_rehearsal.credentials c;`),
);
const storedByKey = new Map(saved.map(row => [`${row.source}:${row.source_id}`, row.password_hash]));
for (const credential of credentials) {
  const key = `${credential.source}:${credential.id}`;
  const stored = storedByKey.get(key);
  if (!stored || stored !== expectedHashes.get(key) || !await verifyPassword(credential.password, stored)) {
    throw new Error('Credential changed during rehearsal or stored hash verification failed');
  }
  verified++;
}

const access = await query(`
BEGIN TRANSACTION READ ONLY;
SELECT has_schema_privilege('anon', 'password_rehearsal', 'USAGE')
  OR has_table_privilege('anon', 'password_rehearsal.credentials', 'SELECT');
ROLLBACK;`);
if (access !== 'f') throw new Error('Anonymous role can access rehearsal hashes');

console.log(JSON.stringify({ target, verifiedCredentials: verified,
  wrongPasswordsRejected: verified, anonymousHashAccess: false,
  plaintextCleared: false, productionChanged: false }));