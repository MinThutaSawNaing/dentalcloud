import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, any[]>,
    errors: {} as Record<string, unknown>,
    rejections: {} as Record<string, unknown>,
    failAfterFirstPage: false,
    rpc: vi.fn().mockResolvedValue({ error: null })
  };
  const from = vi.fn((table: string) => {
    let offset = 0;
    let end = 999;
    const query: any = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      limit: vi.fn(() => query),
      range: vi.fn((start: number, to: number) => {
        offset = start;
        end = to;
        return query;
      }),
      then: (resolve: any, reject: any) => {
        if (state.rejections[table]) return Promise.reject(state.rejections[table]).then(resolve, reject);
        const error = state.failAfterFirstPage && offset === 0 ? null : state.errors[table] || null;
        return Promise.resolve({ data: error ? null : (state.rows[table] || []).slice(offset, end + 1), error }).then(resolve, reject);
      }
    };
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({
  supabase: { from: mock.from, rpc: mock.state.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const reads = [
  { table: 'patients', read: api.patients.getAll },
  { table: 'doctors', read: api.doctors.getAll },
  { table: 'treatment_types', read: api.treatments.getTypes },
  { table: 'medicines', read: api.medicines.getAll },
  { table: 'expenses', read: api.expenses.getAll },
  { table: 'loyalty_rules', read: api.loyalty.getRules }
];

beforeEach(() => {
  mock.state.rows = {};
  mock.state.errors = {};
  mock.state.rejections = {};
  mock.state.failAfterFirstPage = false;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(reads)('$table optional strict reads', ({ table, read }) => {
  it.each([undefined, {}, { throwOnError: false }])('preserves empty fallback with options %j', async (options) => {
    mock.state.errors[table] = { message: 'Read unavailable', code: 'XX000' };
    expect(await read('branch-1', options)).toEqual([]);
  });

  it('rethrows the original query error in strict mode', async () => {
    const error = { message: 'Read unavailable', code: 'XX000' };
    mock.state.errors[table] = error;
    await expect(read('branch-1', { throwOnError: true })).rejects.toBe(error);
  });

  it('rethrows rejected requests in strict mode', async () => {
    const error = new Error('Network unavailable');
    mock.state.rejections[table] = error;
    await expect(read(undefined, { throwOnError: true })).rejects.toBe(error);
  });

  it('still returns genuinely empty results in strict mode', async () => {
    expect(await read('branch-1', { throwOnError: true })).toEqual([]);
  });

  it('preserves successful result mapping in strict mode', async () => {
    mock.state.rows[table] = [{ id: 'record-1', name: 'Record', location_id: 'branch-1', date: '2026-08-05' }];
    const normal = await read('branch-1');
    expect(normal).toHaveLength(1);
    expect(await read('branch-1', { throwOnError: true })).toEqual(normal);
  });
});

describe('strict expenses enrichment', () => {
  it.each([false, true])('propagates enrichment failure only when strict=%s', async (strict) => {
    const stored = { id: 'expense-1', date: '2026-08-05', amount: 100 };
    const error = { message: 'Material costs unavailable', code: 'XX000' };
    mock.state.rows.expenses = [stored];
    mock.state.errors.patient_material_costs = error;
    const result = api.expenses.getAll('branch-1', { throwOnError: strict });
    if (strict) await expect(result).rejects.toBe(error);
    else expect(await result).toEqual([stored]);
  });
});

describe.each(reads.filter(({ table }) => ['patients', 'expenses'].includes(table)))('$table later-page failure', ({ table, read }) => {
  it('rejects rather than returning incomplete or empty records', async () => {
    const error = { message: 'Second page unavailable', code: 'XX000' };
    mock.state.rows[table] = Array.from({ length: 1000 }, (_, id) => ({ id: String(id) }));
    mock.state.errors[table] = error;
    mock.state.failAfterFirstPage = true;
    await expect(read('branch-1', { throwOnError: true })).rejects.toBe(error);
  });
});
