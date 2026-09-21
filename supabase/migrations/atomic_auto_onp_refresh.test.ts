import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  fileURLToPath(new URL('./20260921000000_atomic_auto_onp_refresh.sql', import.meta.url)),
  'utf8'
);

describe('atomic automatic ONP refresh migration', () => {
  it('uses one invoker-rights update guarded against concurrent branch refreshes', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.apply_auto_onp_patient_type');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('pg_try_advisory_xact_lock');
    expect(migration).toContain("patient.patient_type IS DISTINCT FROM 'ONP'");
    expect(migration).toContain('p_location_id IS NULL OR patient.location_id = p_location_id');
  });

  it('does not expose elevated execution rights', () => {
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.apply_auto_onp_patient_type(UUID) FROM PUBLIC;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.apply_auto_onp_patient_type(UUID) TO anon, authenticated;');
  });
});