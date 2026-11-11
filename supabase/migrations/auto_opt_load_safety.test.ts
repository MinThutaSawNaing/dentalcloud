import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('./20261111000000_auto_opt_patient_type.sql', import.meta.url), 'utf8');
const indexes = readFileSync(new URL('../../database/auto_opt_patient_type_indexes.sql', import.meta.url), 'utf8');

describe('Auto OPT load-safety deployment contract', () => {
  it('requires prepared valid indexes instead of building indexes inside the installation transaction', () => {
    expect(migration).not.toMatch(/^CREATE INDEX/im);
    expect(migration).toContain('i.indisvalid AND i.indisready');
    expect(migration).toContain('pg_get_indexdef(i.indexrelid, 1, TRUE)');
    expect(migration).toContain('RAISE EXCEPTION');
    expect(indexes.match(/^CREATE INDEX CONCURRENTLY/gm)).toHaveLength(2);
    expect(indexes).toContain("SET maintenance_work_mem = '32MB'");
    expect(indexes).toContain('SET max_parallel_maintenance_workers = 0');
    expect(indexes).not.toMatch(/^BEGIN\s*;/m);
  });

  it('caps older ONP maintenance writes rather than issuing one unbounded patient update', () => {
    const rpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.apply_auto_onp_patient_type'));
    expect(rpc).toContain('LIMIT 200');
    expect(rpc).toContain('FOR NO KEY UPDATE SKIP LOCKED');
    expect(rpc).toContain('WHERE patient.id = eligible.id');
  });
});