import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Evaluate filters before pagination, rather than returning every fixture for
// every query: these regressions concern which rows Supabase actually returns.
const mock = vi.hoisted(() => {
  const state: any = { rows: {}, queries: [], active: 0, maxActive: 0, errorFor: undefined };
  const from = vi.fn((table: string) => {
    const call: any = { table, columns: '', filters: [], orders: [], from: 0, to: 999 };
    state.queries.push(call);
    const matches = (row: any, expression: string): boolean => {
      if (expression.startsWith('and(')) {
        return expression.slice(4, -1).split(',').every(part => matches(row, part));
      }
      const [column, operator, ...parts] = expression.split('.');
      const value = parts.join('.');
      if (operator === 'is') return value === 'null' && row[column] == null;
      if (row[column] == null) return false;
      return operator === 'gte' ? row[column] >= value : row[column] <= value;
    };
    const query: any = {
      select: vi.fn((columns: string) => { call.columns = columns; return query; }),
      order: vi.fn((column: string, options?: any) => {
        call.orders.push([column, options?.ascending !== false]);
        return query;
      }),
      range: vi.fn((start: number, end: number) => { call.from = start; call.to = end; return query; }),
      then: (resolve: any, reject: any) => {
        state.active++;
        state.maxActive = Math.max(state.maxActive, state.active);
        return Promise.resolve().then(() => {
          const error = state.errorFor?.(call) || null;
          let rows = (state.rows[table] || []).filter((row: any) => call.filters.every(([op, col, value]: any[]) => {
            if (op === 'or') {
              const expressions = String(col).match(/and\([^)]*\)|[^,]+/g) || [];
              return expressions.some(expression => matches(row, expression));
            }
            if (op === 'is') return value === null && row[col] == null;
            if (row[col] == null) return false;
            if (op === 'eq') return row[col] === value;
            if (op === 'in') return value.includes(row[col]);
            return op === 'gte' ? row[col] >= value : row[col] <= value;
          }));
          rows = [...rows].sort((a, b) => {
            for (const [column, ascending] of call.orders) {
              const comparison = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
              if (comparison) return ascending ? comparison : -comparison;
            }
            return 0;
          });
          state.active--;
          return { data: error ? null : rows.slice(call.from, call.to + 1), error };
        }).then(resolve, reject);
      }
    };
    for (const method of ['eq', 'in', 'gte', 'lte', 'is', 'or']) {
      query[method] = vi.fn((...args: any[]) => { call.filters.push([method, ...args]); return query; });
    }
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({
  supabase: { from: mock.from, rpc: vi.fn() }, supabaseUrl: '', supabaseAnonKey: ''
}));

import { api } from './api';

const day = '2026-08-05';
const range = { dateFrom: day, dateTo: day, throwOnError: true };
const addCost = (id: string, treatment: any = {}, audit: any = {}, cost: any = {}) => {
  mock.state.rows.treatments.push({
    id: `t-${id}`, location_id: 'branch-1', date: day, description: 'Filling', patients: { name: 'Patient' }, ...treatment
  });
  mock.state.rows.audit_logs.push({ id: `a-${id}`, source_type: 'treatment', source_id: `t-${id}`, location_id: 'branch-1', ...audit });
  mock.state.rows.patient_material_costs.push({
    id: `c-${id}`, audit_log_id: `a-${id}`, cost_type: 'material', material_name: 'Composite', total_amount: 10,
    created_at: `${day}T10:00:00Z`, ...cost
  });
};
const queries = (table: string) => mock.state.queries.filter((query: any) => query.table === table);

beforeEach(() => {
  mock.state.rows = { treatments: [], audit_logs: [], patient_material_costs: [], expenses: [] };
  mock.state.queries = [];
  mock.state.active = 0;
  mock.state.maxActive = 0;
  mock.state.errorFor = undefined;
  mock.from.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('overview expense range correctness', () => {
  it('resolves the audit branch before treatment branch, including null branch fallback', async () => {
    addCost('audit-wins', { location_id: 'branch-2' });
    addCost('audit-excludes', {}, { location_id: 'branch-2' });
    addCost('fallback', {}, { location_id: null });
    const result = await api.expenses.getAll('branch-1', range);
    expect(result.map(row => row.source_id).sort()).toEqual(['a-audit-wins', 'a-fallback']);
    expect(queries('treatments').every((query: any) => !query.filters.some((filter: any[]) => filter[1] === 'location_id'))).toBe(true);
    const fetchedAuditIds = queries('patient_material_costs').flatMap((query: any) => query.filters.find((filter: any[]) => filter[1] === 'audit_log_id')?.[2] || []);
    expect(fetchedAuditIds).not.toContain('a-audit-excludes');
  });

  it.each([range, { dateFrom: day, throwOnError: true }, { dateTo: day, throwOnError: true }])(
    'includes null treatment dates and finally filters their creation-date fallback: %j', async options => {
      addCost('null-in', { date: null });
      addCost('null-before', { date: null }, {}, { created_at: '2026-08-04T23:59:59Z' });
      addCost('null-after', { date: null }, {}, { created_at: '2026-08-06T00:00:00Z' });
      addCost('no-date', { date: null }, {}, { created_at: null });
      addCost('dated-in', {}, {}, { created_at: '2020-01-01T00:00:00Z' });
      addCost('dated-before', { date: '2026-08-04' });
      addCost('dated-after', { date: '2026-08-06' });
      const result = await api.expenses.getAll('branch-1', options);
      const expected = ['a-null-in', 'a-dated-in'];
      if (!options.dateFrom) expected.push('a-null-before', 'a-dated-before');
      if (!options.dateTo) expected.push('a-null-after', 'a-dated-after');
      expect(result.map(row => row.source_id).sort()).toEqual(expected.sort());
      expect(result.every(row => row.date && (!options.dateFrom || row.date >= options.dateFrom) && (!options.dateTo || row.date <= options.dateTo))).toBe(true);
    }
  );

  it.each(['material', 'lab', 'special_doctor'])('deduplicates persisted %s links across dates without returning out-of-range stored rows', async costType => {
    addCost('linked', {}, {}, { cost_type: costType });
    addCost('unlinked', {}, {}, { cost_type: costType });
    const sourceType = `${costType}_cost`;
    mock.state.rows.expenses = [{
      id: 'persisted', source_id: 'a-linked', source_type: sourceType, location_id: 'branch-1',
      date: '2026-08-06', amount: 10, description: 'Persisted', category: 'Cost'
    }, {
      id: 'unrelated-type', source_id: 'a-unlinked', source_type: 'other', location_id: 'branch-1', date: '2026-08-06'
    }];
    expect((await api.expenses.getAll('branch-1', range)).map(row => row.source_id)).toEqual(['a-unlinked']);
    const nextDay = await api.expenses.getAll('branch-1', { ...range, dateFrom: '2026-08-06', dateTo: '2026-08-06' });
    expect(nextDay.map(row => row.id).sort()).toEqual(['persisted', 'unrelated-type']);
    const linkQueries = queries('expenses').filter((query: any) => query.columns === 'source_id, source_type');
    expect(linkQueries.length).toBeGreaterThan(0);
    expect(linkQueries.every((query: any) => query.filters.some((filter: any[]) => filter[0] === 'in' && filter[1] === 'source_id') &&
      !query.filters.some((filter: any[]) => filter[1] === 'date'))).toBe(true);
  });

  it('preserves stored manual expenses, legacy prefix deduplication, and descending date ordering', async () => {
    addCost('legacy');
    addCost('synthetic', { date: '2026-08-06' });
    mock.state.rows.expenses = [
      { id: 'legacy', location_id: 'branch-1', date: day, category: 'Material Cost', description: 'Material cost - Patient - Filling (Composite)', amount: 10 },
      { id: 'manual', location_id: 'branch-1', date: '2026-08-04', category: 'Rent', description: 'Rent', amount: 100 }
    ];
    const result = await api.expenses.getAll('branch-1', { ...range, dateFrom: '2026-08-04', dateTo: '2026-08-06' });
    expect(result.map(row => row.id)).toEqual(['material-cost-a-synthetic', 'legacy', 'manual']);
  });

  it('checks persisted links by both audit and cost type, even when their branch differs', async () => {
    addCost('mixed');
    mock.state.rows.patient_material_costs.push({
      ...mock.state.rows.patient_material_costs[0], id: 'lab', cost_type: 'lab', total_amount: 25
    });
    mock.state.rows.expenses.push({
      id: 'persisted-material', source_id: 'a-mixed', source_type: 'material_cost',
      location_id: 'branch-2', date: '2026-08-06', amount: 10
    });
    expect((await api.expenses.getAll('branch-1', range)).map(row => [row.source_type, row.amount])).toEqual([['lab_cost', 25]]);
  });

  it('paginates date-filtered stored expenses without adding out-of-range rows', async () => {
    mock.state.rows.expenses = Array.from({ length: 1001 }, (_, index) => ({
      id: `stored-${String(index).padStart(4, '0')}`, location_id: 'branch-1', date: day,
      category: 'Supplies', description: 'Manual', amount: 1
    }));
    mock.state.rows.expenses.push({ id: 'outside', location_id: 'branch-1', date: '2026-08-06' });
    const result = await api.expenses.getAll('branch-1', range);
    expect(result).toHaveLength(1001);
    expect(new Set(result.map(row => row.id)).size).toBe(1001);
    expect(queries('expenses').map((query: any) => [query.from, query.to])).toEqual([[0, 999], [1000, 1999]]);
    expect(queries('expenses').every((query: any) => query.filters.some((filter: any[]) => filter[0] === 'gte' && filter[1] === 'date') &&
      query.filters.some((filter: any[]) => filter[0] === 'lte' && filter[1] === 'date'))).toBe(true);
  });

  it('paginates candidates and costs with bounded ID batches and concurrency', async () => {
    for (let index = 0; index < 1001; index++) addCost(String(index).padStart(4, '0'));
    for (let index = 0; index < 1000; index++) {
      mock.state.rows.patient_material_costs.push({ ...mock.state.rows.patient_material_costs[0], id: `extra-${index}` });
    }
    const result = await api.expenses.getAll('branch-1', range);
    expect(result).toHaveLength(1001);
    expect(result.find(row => row.source_id === 'a-0000')?.amount).toBe(10010);
    expect(queries('treatments').map((query: any) => query.from)).toEqual([0, 1000]);
    expect(queries('patient_material_costs').some((query: any) => query.from === 1000)).toBe(true);
    for (const query of mock.state.queries) {
      expect(query.to - query.from).toBe(999);
      for (const [op, , ids] of query.filters) {
        if (op === 'in') expect(ids.length).toBeLessThanOrEqual(20);
      }
    }
    expect(mock.state.maxActive).toBeLessThanOrEqual(3);
    expect(queries('patient_material_costs').every((query: any) => query.filters.some((filter: any[]) => filter[1] === 'audit_log_id'))).toBe(true);
  });

  it('does not query costs or persisted links when there are no candidate treatments', async () => {
    expect(await api.expenses.getAll('branch-1', range)).toEqual([]);
    expect(queries('patient_material_costs')).toHaveLength(0);
    expect(queries('expenses')).toHaveLength(1);
  });

  it('retains optional patient join and legacy cost_type fallbacks', async () => {
    addCost('legacy-schema', { date: null });
    mock.state.errorFor = (query: any) => {
      if (query.table === 'treatments' && query.columns.includes('patients(name)')) return { code: 'PGRST200', message: 'Could not find a relationship with patients' };
      if (query.table === 'patient_material_costs' && query.columns.includes('cost_type')) return { code: '42703', message: 'column cost_type does not exist' };
    };
    expect((await api.expenses.getAll('branch-1', range)).map(row => row.source_id)).toEqual(['a-legacy-schema']);
  });

  it('does not silently synthesize duplicates when cross-date link lookup fails', async () => {
    addCost('linked');
    const stored = { id: 'manual', location_id: 'branch-1', date: day, description: 'Rent', amount: 100 };
    mock.state.rows.expenses.push(stored);
    const error = { code: 'XX000', message: 'Link lookup unavailable' };
    mock.state.errorFor = (query: any) => query.table === 'expenses' && query.columns === 'source_id, source_type' ? error : null;
    await expect(api.expenses.getAll('branch-1', range)).rejects.toBe(error);
    expect(await api.expenses.getAll('branch-1', { ...range, throwOnError: false })).toEqual([stored]);
  });
});