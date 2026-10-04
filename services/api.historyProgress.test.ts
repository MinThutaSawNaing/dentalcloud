import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, any[]>,
    calls: [] as any[],
    count: 1001 as number | null | undefined,
    relationFailure: false,
    failFrom: null as number | null
  };
  const from = vi.fn((table: string) => {
    const call = { table, columns: '', selectArgs: [] as any[], filters: [] as any[], orders: [] as any[], range: [0, 999] };
    state.calls.push(call);
    const query: any = {
      select: vi.fn((...args: any[]) => { call.selectArgs = args; call.columns = args[0]; return query; }),
      order: vi.fn((...args: any[]) => { call.orders.push(args); return query; }),
      range: vi.fn((start: number, end: number) => { call.range = [start, end]; return query; }),
      then: (resolve: any, reject: any) => {
        const error = state.failFrom !== null && call.range[0] >= state.failFrom
          ? { code: 'XX000', message: 'Later page unavailable' }
          : state.relationFailure && call.columns.includes('doctors(')
            ? { code: '42501', message: 'permission denied for table doctors' } : null;
        let rows = state.rows[table] || [];
        for (const [operator, column, value] of call.filters) {
          rows = rows.filter((row) => operator === 'eq' ? row[column] === value
            : operator === 'gte' ? row[column] >= value
            : operator === 'lte' ? row[column] <= value
            : operator === 'in' ? value.includes(row[column]) : row[column] !== null);
        }
        return Promise.resolve({
          data: error ? null : rows.slice(call.range[0], call.range[1] + 1), error,
          // Later-page counts must not replace the first successful page's total.
          count: call.range[0] === 0 ? state.count : 9999
        }).then(resolve, reject);
      }
    };
    for (const operator of ['eq', 'gte', 'lte', 'in', 'not']) {
      query[operator] = vi.fn((column: string, value: any) => {
        call.filters.push([operator, column, value]); return query;
      });
    }
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({
  supabase: { from: mock.from, rpc: vi.fn() }, supabaseUrl: '', supabaseAnonKey: ''
}));
import { api } from './api';

const scope = { dateFrom: '2026-08-01', dateTo: '2026-08-31', doctorId: 'doctor-1', patientId: 'patient-1' };
const rows = () => Array.from({ length: 1001 }, (_, index) => ({
  id: `row-${index}`, location_id: 'branch-1', patient_id: 'patient-1', doctor_id: 'doctor-1',
  date: '2026-08-05', status: 'Scheduled', cost: 100, standard_cost: 120, discount_amount: 20,
  patients: { name: 'Patient One', balance: 10 }, doctors: { name: 'Doctor One' }
}));
const fetchHistory = (table: string, options: any) => table === 'appointments'
  ? api.appointments.getAll('branch-1', { ...scope, ...options })
  : api.treatments.getAllRecords('branch-1', { ...scope, limit: null, includeCommissionEntries: false, ...options });

beforeEach(() => {
  mock.state.rows = { appointments: rows(), treatments: rows() };
  mock.state.calls = [];
  mock.state.count = 1001;
  mock.state.relationFailure = false;
  mock.state.failFrom = null;
  mock.from.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe.each(['appointments', 'treatments'])('%s history progress', (table) => {
  it('reports cumulative progress beyond 1000 using only the first count and preserves mapping', async () => {
    const onProgress = vi.fn();
    const result = await fetchHistory(table, { onProgress });
    expect(result).toHaveLength(1001);
    expect(onProgress.mock.calls).toEqual([[1000, 1001], [1001, 1001]]);
    expect(mock.state.calls.map((call) => call.selectArgs.length)).toEqual([2, 1]);
    expect(mock.state.calls[0].selectArgs[1]).toEqual({ count: 'exact' });
    expect(result[0]).toMatchObject({ patient_name: 'Patient One', doctor_name: 'Doctor One' });
    if (table === 'treatments') expect(result[0]).toMatchObject({ standardCost: 120, discountAmount: 20 });
  });

  it('keeps legacy selects free of count options', async () => {
    await fetchHistory(table, {});
    expect(mock.state.calls.map((call) => call.selectArgs.length)).toEqual([1, 1]);
  });

  it.each([true, false])('preserves fallback filters and first-page-only count requests with progress=%s', async (withProgress) => {
    mock.state.relationFailure = true;
    const onProgress = vi.fn();
    const result = await fetchHistory(table, withProgress ? { onProgress } : {});
    expect(result).toHaveLength(1001);
    expect(mock.state.calls.map((call) => call.range)).toEqual([[0, 999], [0, 999], [1000, 1999], [1000, 1999]]);
    expect(mock.state.calls.map((call) => call.selectArgs.length)).toEqual(withProgress ? [2, 2, 1, 1] : [1, 1, 1, 1]);
    for (const call of mock.state.calls) {
      expect(call.filters).toEqual([
        ['eq', 'location_id', 'branch-1'], ['gte', 'date', scope.dateFrom],
        ['lte', 'date', scope.dateTo], ['eq', 'doctor_id', 'doctor-1'], ['eq', 'patient_id', 'patient-1']
      ]);
      expect(call.orders).toEqual(table === 'appointments'
        ? [['date'], ['id']] : [['date', { ascending: false }], ['id']]);
      if (withProgress && call.range[0] === 0) expect(call.selectArgs[1]).toEqual({ count: 'exact' });
    }
    expect(onProgress.mock.calls).toEqual(withProgress ? [[1000, 1001], [1001, 1001]] : []);
  });

  it.each([true, false])('does not report a failed later page or return partial rows with strict=%s', async (throwOnError) => {
    mock.state.failFrom = 1000;
    const onProgress = vi.fn();
    const request = fetchHistory(table, { onProgress, throwOnError });
    if (throwOnError) await expect(request).rejects.toMatchObject({ message: 'Later page unavailable' });
    else await expect(request).resolves.toEqual([]);
    expect(onProgress.mock.calls).toEqual([[1000, 1001]]);
    expect(mock.state.calls).toHaveLength(2);
    expect(mock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });

  it.each([0, 50])('preserves an exact first count of %s', async (count) => {
    mock.state.count = count;
    mock.state.rows[table] = rows().slice(0, count);
    const onProgress = vi.fn();
    await fetchHistory(table, { onProgress });
    expect(onProgress.mock.calls).toEqual([[count, count]]);
  });

  it.each([null, undefined])('reports unknown first counts as null (%s)', async (count) => {
    mock.state.count = count;
    const onProgress = vi.fn();
    await fetchHistory(table, { onProgress });
    expect(onProgress.mock.calls).toEqual([[1000, null], [1001, null]]);
  });
});

describe('progress excludes enrichment completion', () => {
  it('does not emit extra progress for completed appointment doctor enrichment', async () => {
    mock.state.rows.appointments = [{ ...rows()[0], status: 'Completed' }];
    mock.state.rows.treatments = [];
    mock.state.count = 1;
    const onProgress = vi.fn();
    await fetchHistory('appointments', { onProgress });
    expect(mock.from).toHaveBeenCalledWith('treatments');
    expect(onProgress.mock.calls).toEqual([[1, 1]]);
    expect(mock.state.calls.find((call) => call.table === 'treatments').selectArgs).toHaveLength(1);
  });

  it('does not emit extra progress for default commission enrichment', async () => {
    mock.state.rows.treatments = [rows()[0]];
    mock.state.count = 1;
    const onProgress = vi.fn();
    await fetchHistory('treatments', { onProgress, includeCommissionEntries: true });
    expect(mock.from).toHaveBeenCalledWith('doctor_commission_entries');
    expect(onProgress.mock.calls).toEqual([[1, 1]]);
  });

  it('preserves the default treatment limit while reporting the full count', async () => {
    const onProgress = vi.fn();
    const result = await api.treatments.getAllRecords('branch-1', { onProgress, includeCommissionEntries: false });
    expect(result).toHaveLength(50);
    expect(mock.state.calls[0].range).toEqual([0, 49]);
    expect(onProgress.mock.calls).toEqual([[50, 1001]]);
  });
});
