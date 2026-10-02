import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('./password_security_preflight.sql', import.meta.url), 'utf8');
const statements = sql.replace(/--[^\r\n]*/g, '').trim();

describe('password security preflight safety', () => {
  it('runs inside an explicitly read-only transaction and rolls back', () => {
    expect(statements).toMatch(/^BEGIN TRANSACTION READ ONLY;/);
    expect(statements).toMatch(/ROLLBACK;$/);
    expect(statements).not.toMatch(/\b(COMMIT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i);
  });

  it('bounds execution time and inspects all legacy credential sources', () => {
    expect(statements).toContain("SET LOCAL statement_timeout = '30s';");
    expect(statements).toContain("SET LOCAL lock_timeout = '3s';");
    for (const table of ['users', 'doctors', 'patient_auth', 'staff_auth_sessions']) {
      expect(statements).toContain(`public.${table}`);
    }
  });

  it('does not select raw credentials or function definitions', () => {
    expect(statements).not.toMatch(/SELECT\s+(?:\w+\.)?(?:password|session_token|code)\b/i);
    expect(statements).not.toMatch(/SELECT\s+\*/i);
    expect(statements).not.toContain('pg_get_functiondef');
    expect(statements).toContain('bcrypt_length_risk');
    expect(statements).toContain('different_doctor_and_staff_credentials');
    expect(statements).toContain('duplicate_staff_identifier_groups');
  });
});