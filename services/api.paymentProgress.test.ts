import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const state = {
    rows: [] as any[], calls: [] as any[], count: 1001 as number | null | undefined,
    failFrom: null as number | null, relation: '', relationFrom: 0,
    fallbackCount: 1001, storageMissing: false
  };
  const from = vi.fn((table: string) => {
    const call = { table, columns: '', selectArgs: [] as any[], filters: [] as any[], orders: [] as any[], range: [0, 999] };
    state.calls.push(call);
    const query: any = {
      select: (...args: any[]) => { call.selectArgs = args; call.columns = args[0]; return query; },
      order: (...args: any[]) => { call.orders.push(args); return query; },
      range: (start: number, end: number) => { call.range = [start, end]; return query; },
      then: (resolve: any, reject: any) => {
        const isPayment = table === 'payments';
        const relationError = isPayment && state.relation && call.columns.includes(state.relation)
          && call.range[0] >= state.relationFrom;
        const error = isPayment && state.storageMissing
          ? { code: '42P01', message: 'relation "payments" does not exist' }
          : isPayment && state.failFrom !== null && call.range[0] >= state.failFrom
            ? { code: 'XX000', message: 'Later page unavailable' }
            : relationError ? { code: '42501', message: `permission denied for table ${state.relation}` } : null;
        let rows = isPayment ? state.rows : [];
        for (const [operator, column, value] of call.filters) {
          rows = rows.filter((row) => operator === 'eq' ? row[column] === value
            : operator === 'gte' ? row[column] >= value
            : operator === 'lte' ? row[column] <= value : value.includes(row[column]));
        }
        const fallback = state.relation && !call.columns.includes(state.relation);
        return Promise.resolve({
          data: error ? null : rows.slice(call.range[0], call.range[1] + 1), error,
          count: call.range[0] === 0 ? (fallback ? state.fallbackCount : state.count) : 9999
        }).then(resolve, reject);
      }
    };
    for (const operator of ['eq', 'gte', 'lte', 'in']) {
      query[operator] = (column: string, value: any) => { call.filters.push([operator, column, value]); return query; };
    }
    return query;
  });
  return { state, from };
});
vi.mock('./supabase', () => ({
  supabase: { from: mock.from, rpc: vi.fn() }, supabaseUrl: '', supabaseAnonKey: ''
}));
import { api } from './api';

const scope = { dateFrom: '2026-08-01', dateTo: '2026-08-31', patientId: 'patient-1' };
const rows = (length = 1001) => Array.from({ length }, (_, index) => ({
  id: `payment-${index}`, location_id: 'branch-1', patient_id: 'patient-1',
  amount: 100, payment_date: '2026-08-05', created_at: '2026-08-05T00:00:00Z',
  patients: { name: 'Patient One', balance: 10, patient_type: 'Default' }
}));
const paymentCalls = () => mock.state.calls.filter((call) => call.table === 'payments');
const fetchPayments = (options = {}) => api.finance.getPayments('branch-1', { ...scope, ...options });

beforeEach(() => {
  Object.assign(mock.state, {
    rows: rows(), calls: [], count: 1001, failFrom: null, relation: '', relationFrom: 0,
    fallbackCount: 1001, storageMissing: false
  });
  mock.from.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(api.materialCosts, 'getTotalsByPaymentIds').mockResolvedValue({
    'payment-0': { materialTotal: 7, labTotal: 3, specialDoctorTotal: 0, totalAmount: 10,
      auditLogId: null, materialItemCount: 1, labItemCount: 1, specialDoctorItemCount: 0, itemCount: 2 }
  });
});
afterEach(() => vi.restoreAllMocks());

const assertQueries = (progress: boolean) => {
  for (const call of paymentCalls()) {
    expect(call.selectArgs).toHaveLength(progress && call.range[0] === 0 ? 2 : 1);
    if (progress && call.range[0] === 0) expect(call.selectArgs[1]).toEqual({ count: 'exact' });
    expect(call.filters).toEqual([
      ['eq', 'location_id', 'branch-1'], ['gte', 'payment_date', scope.dateFrom],
      ['lte', 'payment_date', scope.dateTo], ['eq', 'patient_id', scope.patientId]
    ]);
    expect(call.orders).toEqual([['created_at', { ascending: false }], ['id']]);
  }
};

describe('finance payment pagination progress', () => {
  it('reports cumulative rows beyond 1000 with only the first count and no enrichment completion event', async () => {
    const onProgress = vi.fn();
    const result = await fetchPayments({ onProgress });
    expect(result).toHaveLength(1001);
    expect(new Set(result.map((payment) => payment.id)).size).toBe(1001);
    expect(result[0]).toMatchObject({ id: 'payment-0', amount: 100, materialTotal: 7, labTotal: 3, mlsTotal: 10 });
    expect(onProgress.mock.calls).toEqual([[1000, 1001], [1001, 1001]]);
    expect(paymentCalls().map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(mock.from).toHaveBeenCalledWith('doctor_commission_entries');
    expect(api.materialCosts.getTotalsByPaymentIds).toHaveBeenCalledWith(result.map((payment) => payment.id), { idBatchSize: 50 });
    assertQueries(true);
  });

  it('preserves nonprogress calls without count query overhead', async () => {
    await expect(fetchPayments()).resolves.toHaveLength(1001);
    assertQueries(false);
    mock.state.calls = [];
    await expect(api.finance.getPayments()).resolves.toHaveLength(1001);
    expect(paymentCalls().every((call) => call.selectArgs.length === 1 && call.filters.length === 0)).toBe(true);
  });

  it('throws on a later error without reporting failed rows or enriching partial data', async () => {
    mock.state.failFrom = 1000;
    const onProgress = vi.fn();
    await expect(fetchPayments({ onProgress })).rejects.toThrow('Later page unavailable');
    expect(onProgress.mock.calls).toEqual([[1000, 1001]]);
    expect(mock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
    expect(api.materialCosts.getTotalsByPaymentIds).not.toHaveBeenCalled();
    assertQueries(true);
  });
});


describe('payment fallback progress', () => {
  it.each(['payment_allocations', 'payment_corrections', 'patients', 'users'])('preserves filters and first-page-only counts for %s fallback', async (relation) => {
    mock.state.relation = relation;
    const onProgress = vi.fn();
    await expect(fetchPayments({ onProgress })).resolves.toHaveLength(1001);
    expect(onProgress.mock.calls).toEqual([[1000, 1001], [1001, 1001]]);
    expect(paymentCalls().map((call) => call.range)).toEqual([[0, 999], [0, 999], [1000, 1999]]);
    assertQueries(true);
  });

  it('naturally resets cumulative rows and total when a later relation error retries from page one', async () => {
    mock.state.rows = rows(2001);
    mock.state.count = 3000;
    mock.state.fallbackCount = 2001;
    mock.state.relation = 'payment_allocations';
    mock.state.relationFrom = 2000;
    const onProgress = vi.fn();
    const result = await fetchPayments({ onProgress });
    expect(result).toHaveLength(2001);
    expect(onProgress.mock.calls).toEqual([
      [1000, 3000], [2000, 3000], [1000, 2001], [2000, 2001], [2001, 2001]
    ]);
    assertQueries(true);
  });

  it('does not request counts in fallback without progress', async () => {
    mock.state.relation = 'patients';
    await expect(fetchPayments()).resolves.toHaveLength(1001);
    assertQueries(false);
  });

  it.each([null, undefined])('uses null for unavailable first count (%s), ignoring later counts', async (count) => {
    mock.state.count = count;
    const onProgress = vi.fn();
    await fetchPayments({ onProgress });
    expect(onProgress.mock.calls).toEqual([[1000, null], [1001, null]]);
  });

  it.each([0, 50])('preserves an exact count of %s', async (count) => {
    mock.state.count = count;
    mock.state.rows = rows(count);
    const onProgress = vi.fn();
    await fetchPayments({ onProgress });
    expect(onProgress.mock.calls).toEqual([[count, count]]);
  });

  it('signals downloaded rows before waiting for delayed MLS enrichment', async () => {
    let finish!: (value: {}) => void;
    const pending = new Promise<{}>((resolve) => { finish = resolve; });
    vi.mocked(api.materialCosts.getTotalsByPaymentIds).mockReturnValueOnce(pending);
    const onRowsDownloaded = vi.fn();
    let completed = false;
    const request = fetchPayments({ onRowsDownloaded }).then((rows) => { completed = true; return rows; });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(onRowsDownloaded).toHaveBeenCalledTimes(1);
    expect(completed).toBe(false);
    finish({});
    expect(await request).toHaveLength(1001);
    expect(completed).toBe(true);
  });

  it('does not signal downloaded rows when a later page fails', async () => {
    mock.state.failFrom = 1000;
    const onRowsDownloaded = vi.fn();
    await expect(fetchPayments({ onRowsDownloaded })).rejects.toThrow('Later page unavailable');
    expect(onRowsDownloaded).not.toHaveBeenCalled();
  });

  it('preserves missing payment storage behavior without a completion event', async () => {
    mock.state.storageMissing = true;
    const onProgress = vi.fn();
    await expect(fetchPayments({ onProgress })).resolves.toEqual([]);
    expect(onProgress).not.toHaveBeenCalled();
    expect(api.materialCosts.getTotalsByPaymentIds).not.toHaveBeenCalled();
  });
});
