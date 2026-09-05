import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '20260905010000_drop_stale_payment_function_overloads.sql'),
  'utf8'
).replace(/\r\n/g, '\n');

describe('drop_stale_payment_function_overloads migration', () => {
  it('drops only the two stale signatures with IF EXISTS guards', () => {
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.process_patient_payment(\n  UUID, NUMERIC, TEXT, UUID[], DATE, UUID, TEXT\n);');
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.correct_payment_record(\n  UUID, NUMERIC, TEXT, TEXT\n);');
    expect(migration).not.toMatch(/DROP FUNCTION(?!\s+IF\s+EXISTS)/i);
  });

  it('never drops the current signatures', () => {
    expect(migration).not.toContain('DATE, JSONB, TEXT, UUID, TEXT');
    expect(migration).not.toMatch(/correct_payment_record\(\s*UUID, NUMERIC, TEXT, TEXT, UUID\s*\)/);
  });

  it('is transactional, reloads PostgREST, and verifies the surviving functions', () => {
    expect(migration).toContain('\nBEGIN;\n');
    expect(migration).toContain('COMMIT;');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration).toContain('has_new_codes');
    expect(migration).not.toMatch(/\bDELETE FROM\b|\bUPDATE \w+ SET\b|\bDROP TABLE\b/i);
  });
});
