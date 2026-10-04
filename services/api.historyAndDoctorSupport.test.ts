import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  const state = {
    rows: {} as Record<string, any[]>,
    calls: [] as any[],
    historyError: null as any,
    failFrom: 1000,
    optionalOnly: false,
    probeError: null as any,
    probeRejection: null as any
  };
  const from = vi.fn((table: string) => {
    const call = { table, columns: '', filters: [] as any[], orders: [] as any[], range: [0, 999] };
    state.calls.push(call);
    const query: any = {
      select: vi.fn((columns: string) => { call.columns = columns; return query; }),
      eq: vi.fn((column: string, value: unknown) => { call.filters.push([column, value]); return query; }),
      in: vi.fn((column: string, values: unknown[]) => { call.filters.push([column, values]); return query; }),
      order: vi.fn((column: string, options?: unknown) => { call.orders.push([column, options]); return query; }),
      range: vi.fn((start: number, end: number) => { call.range = [start, end]; return query; }),
      limit: vi.fn(() => query),
      then: (resolve: any, reject: any) => {
        if (table === 'doctor_locations' && state.probeRejection) {
          return Promise.reject(state.probeRejection).then(resolve, reject);
        }
        const error = table === 'doctor_locations' ? state.probeError
          : table === 'treatments' && call.range[0] >= state.failFrom
            && (!state.optionalOnly || call.columns.includes('doctors(')) ? state.historyError : null;
        let rows = state.rows[table] || [];
        for (const [column, value] of call.filters) {
          rows = rows.filter((row) => Array.isArray(value) ? value.includes(row[column]) : row[column] === value);
        }
        return Promise.resolve({ data: error ? null : rows.slice(call.range[0], call.range[1] + 1), error }).then(resolve, reject);
      }
    };
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({
  supabase: { from: mock.from, rpc: vi.fn() }, supabaseUrl: '', supabaseAnonKey: ''
}));

let api: typeof import('./api')['api'];
beforeEach(async () => {
  // Reset cached doctor_locations support so each probe scenario is independent.
  vi.resetModules();
  mock.state.rows = {};
  mock.state.calls = [];
  mock.state.historyError = null;
  mock.state.failFrom = 1000;
  mock.state.optionalOnly = false;
  mock.state.probeError = null;
  mock.state.probeRejection = null;
  mock.from.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  api = (await import('./api')).api;
});
afterEach(() => vi.restoreAllMocks());

const historyRows = () => Array.from({ length: 1001 }, (_, index) => ({
  id: `treatment-${String(index).padStart(4, '0')}`, patient_id: 'patient-1',
  date: '2026-09-01', cost: 100, doctor_id: 'doctor-1', doctor_earnings: 10,
  standard_cost: 120, discount_amount: 20, pricing_note: 'Discount',
  doctors: { name: 'Doctor One', specialization: 'General', commission_type: 'percentage', commission_percentage: 10 }
}));
const expectHistoryScope = (calls: any[]) => {
  for (const call of calls) {
    expect(call.filters).toEqual([['patient_id', 'patient-1']]);
    expect(call.orders).toEqual([['date', { ascending: false }], ['id', { ascending: true }]]);
  }
};

describe('paginated treatment history', () => {
  it('loads more than 1000 records with stable ordering and unchanged default enrichment', async () => {
    mock.state.rows.treatments = historyRows();
    mock.state.rows.doctor_commission_entries = [{
      id: 'entry-1', treatment_id: 'treatment-1000', payment_id: 'payment-1', doctor_id: 'doctor-1',
      payment_date: '2026-09-02', treatment_date: '2026-09-01', calculation_mode: 'percentage',
      allocated_payment: '100', commission_rate: '15', earnings: '15'
    }];
    const result = await api.treatments.getHistory('patient-1');
    expect(result).toHaveLength(1001);
    expect(new Set(result.map((row) => row.id)).size).toBe(1001);
    expect(result[1000]).toMatchObject({
      id: 'treatment-1000', standardCost: 120, discountAmount: 20, pricingNote: 'Discount',
      doctor_name: 'Doctor One', doctorEarnings: 10,
      doctorEarningEntries: [{ id: 'entry-1', paymentId: 'payment-1', earnings: 15, commissionRate: 15 }]
    });
    expect(result[0].doctorEarningEntries).toEqual([expect.objectContaining({ paymentId: 'legacy-treatment-0000', earnings: 10 })]);
    const calls = mock.state.calls.filter((call) => call.table === 'treatments');
    expect(calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expectHistoryScope(calls);
    const ledgerCalls = mock.state.calls.filter((call) => call.table === 'doctor_commission_entries');
    expect(ledgerCalls).toHaveLength(21);
    expect(ledgerCalls.flatMap((call) => call.filters[0][1])).toEqual(result.map((row) => row.id));
  });
});


describe('history failures and optional doctors fallback', () => {
  it('rejects later-page failure without returning partial history or enriching it', async () => {
    mock.state.rows.treatments = historyRows();
    mock.state.historyError = { code: 'XX000', message: 'Second history page unavailable' };
    await expect(api.treatments.getHistory('patient-1')).rejects.toThrow('Second history page unavailable');
    expect(mock.state.calls.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(mock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });

  it.each([0, 1000])('preserves patient and ordering on every fallback page after relation failure at %s', async (failFrom) => {
    mock.state.rows.treatments = [...historyRows(), { id: 'other', patient_id: 'patient-2' }];
    mock.state.failFrom = failFrom;
    mock.state.optionalOnly = true;
    mock.state.historyError = { code: '42501', message: 'permission denied for table doctors' };
    const result = await api.treatments.getHistory('patient-1', { includeCommissionEntries: false });
    expect(result).toHaveLength(1001);
    expect(result.every((row) => row.patient_id === 'patient-1')).toBe(true);
    expect(new Set(result.map((row) => row.id)).size).toBe(1001);
    expectHistoryScope(mock.state.calls);
    const fallback = mock.state.calls.filter((call) => call.columns === '*');
    expect(fallback.map((call) => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(mock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });
});

describe('doctor branch support probes', () => {
  it.each(['error', 'rejection'])('propagates unexpected probe %s in strict mode before reading doctors', async (kind) => {
    const error = kind === 'error' ? { code: 'XX000', message: 'Support probe unavailable' } : new TypeError('fetch failed');
    if (kind === 'error') mock.state.probeError = error;
    else mock.state.probeRejection = error;
    await expect(api.doctors.getAll('branch-1', { throwOnError: true })).rejects.toBe(error);
    expect(mock.from.mock.calls).toEqual([['doctor_locations']]);
  });

  it.each([undefined, false])('keeps primary-location fallback on unexpected probe failure with strict=%s', async (strict) => {
    mock.state.probeError = { code: 'XX000', message: 'Support probe unavailable' };
    mock.state.rows.doctors = [{ id: 'doctor-1', name: 'Doctor One', location_id: 'branch-1' }];
    const result = await api.doctors.getAll('branch-1', strict === undefined ? undefined : { throwOnError: strict });
    expect(result).toHaveLength(1);
    const call = mock.state.calls.find((call) => call.table === 'doctors');
    expect(call.columns).not.toContain('doctor_locations(');
    expect(call.filters).toEqual([['location_id', 'branch-1']]);
  });

  it.each(['42P01', 'PGRST205'])('allows legitimate missing doctor_locations (%s) in strict mode', async (code) => {
    mock.state.probeError = { code, message: 'Could not find the table public.doctor_locations in the schema cache' };
    mock.state.rows.doctors = [{ id: 'doctor-1', name: 'Doctor One', location_id: 'branch-1' }];
    const result = await api.doctors.getAll('branch-1', { throwOnError: true });
    expect(result).toEqual([expect.objectContaining({ id: 'doctor-1', location_ids: ['branch-1'] })]);
    const call = mock.state.calls.find((call) => call.table === 'doctors');
    expect(call.columns).toBe('*, doctor_schedules(*)');
    expect(call.filters).toEqual([['location_id', 'branch-1']]);
  });
});
