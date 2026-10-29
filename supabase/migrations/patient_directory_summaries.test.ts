import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL(
  './20261029000000_patient_directory_summaries.sql',
  import.meta.url
)), 'utf8');

describe('patient directory summary migration', () => {
  it('is a bounded, invoker-rights, branch-scoped read function', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.patient_directory_summaries');
    expect(migration).toContain('LANGUAGE sql');
    expect(migration).toContain('STABLE');
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain('patient.location_id = p_location_id');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.patient_directory_summaries(UUID, UUID[]) FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.patient_directory_summaries(UUID, UUID[]) TO anon, authenticated');
  });

  it('returns only four preview treatments while retaining exact aggregate summaries', () => {
    expect(migration).toContain('MAX(appointment.date)');
    expect(migration).toContain("appointment.status = 'Scheduled'");
    expect(migration).toContain('LIMIT 4');
    expect(migration).toContain('array_agg(DISTINCT doctor.name');
    expect(migration).toContain("SET LOCAL lock_timeout = '5s'");
  });
});
