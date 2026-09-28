import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260928000000_add_doctor_category_commissions.sql'), 'utf8');

describe('doctor category commissions migration', () => {
  it('preserves historical snapshots and enables existing treatment rules by default', () => {
    expect(sql).toContain('is_enabled BOOLEAN NOT NULL DEFAULT TRUE');
    expect(sql).not.toMatch(/UPDATE public\.treatments/i);
  });

  it('resolves enabled treatment, category, then doctor default for both methods', () => {
    expect(sql).toContain('dtc.is_enabled = TRUE');
    expect(sql).toContain('lower(cat.category) = lower(btrim(tt.category))');
    expect(sql.indexOf('IF v_treatment_fixed IS NOT NULL')).toBeLessThan(sql.indexOf('IF v_category_fixed IS NOT NULL'));
    expect(sql.indexOf('IF v_treatment_rate IS NOT NULL')).toBeLessThan(sql.indexOf('IF v_category_rate IS NOT NULL'));
    expect(sql).toContain('RETURN COALESCE(v_default_percentage, 0)');
  });

  it('protects the category table with constraints, RLS and explicit grants', () => {
    expect(sql).toContain('doctor_category_commissions_rate_check');
    expect(sql).toContain('doctor_category_commissions_fixed_check');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE');
  });
});