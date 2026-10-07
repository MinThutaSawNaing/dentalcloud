import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20261007000000_optimize_mls_payment_reads.sql', import.meta.url
)), 'utf8');

describe('MLS payment read index migration', () => {
  it('matches branch filtering and the API newest-first stable sort', () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS idx_payments_location_created_at_id');
    expect(migration).toContain('ON public.payments (location_id, created_at DESC, id)');
    expect(migration).toContain("SET lock_timeout = '5s'");
    expect(migration).toContain('RESET lock_timeout');
  });

  it('refreshes statistics without changing financial records or permissions', () => {
    expect(migration).toContain('ANALYZE public.payments');
    expect(migration).toContain('ANALYZE public.treatments');
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|INSERT|GRANT|CREATE POLICY)\b/i);
  });
});