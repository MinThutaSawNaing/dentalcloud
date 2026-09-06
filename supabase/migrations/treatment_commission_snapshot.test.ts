import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260906000000_snapshot_treatment_commission.sql'),
  'utf8'
);

describe('treatment commission snapshot migration', () => {
  it('stores the applicable commission on every new treatment', () => {
    expect(migration).toContain('commission_type_snapshot');
    expect(migration).toContain('commission_rate_snapshot');
    expect(migration).toContain('BEFORE INSERT OR UPDATE OF doctor_id, treatment_type_id');
    expect(migration).toContain('public.get_applicable_commission_rate(');
  });

  it('freezes existing treatments during migration', () => {
    expect(migration).toContain('UPDATE public.treatments AS treatment');
  });
});
