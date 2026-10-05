import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMaterialCostPaymentRows } from '../utils/materialCostPaymentRows';

const mock = vi.hoisted(() => {
  const state = { active: 0, peak: 0, calls: [] as any[], failId: '', throwFailure: false, outOfOrder: false };
  const records = Array.from({ length: 300 }, (_, index) => ({
    id: `treatment-${index}`, patient_id: `patient-${index}`, location_id: 'branch-1',
    date: '2026-10-05', cost: 100, doctor_id: 'doctor-1', doctor_earnings: 10,
    description: 'Cleaning', teeth: [], patients: { name: `Patient ${index}`, balance: 0 },
    doctors: { name: 'Doctor One', commission_type: 'percentage', commission_percentage: 10 }
  }));
  const payments = records.map((record, index) => ({
    id: `payment-${index}`, patient_id: record.patient_id, location_id: 'branch-1',
    amount: 100, cleared_amount: 100, payment_date: record.date, treatment_ids: [record.id],
    created_at: '2026-10-05T08:00:00Z', patients: record.patients
  }));
  const entries = records.map((record, index) => ({
    id: `entry-${index}`, treatment_id: record.id, payment_id: payments[index].id,
    doctor_id: 'doctor-1', payment_date: record.date, treatment_date: record.date,
    calculation_mode: 'percentage', allocated_payment: 100, commission_rate: 10, earnings: 10
  }));
  const from = vi.fn((table: string) => {
    const call = { table, filters: [] as any[], range: [0, 999] };
    state.calls.push(call);
    const query: any = {
      select: () => query,
      order: () => query,
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      eq: (column: string, value: string) => { call.filters.push(['eq', column, value]); return query; },
      in: (column: string, value: string[]) => { call.filters.push(['in', column, value]); return query; },
      then: (resolve: any, reject: any) => {
        const load = async () => {
          let rows: any[] = table === 'treatments' ? records : table === 'payments' ? payments : entries;
          for (const [operator, column, value] of call.filters) {
            rows = rows.filter((row: any) => operator === 'eq' ? row[column] === value : value.includes(row[column]));
          }
          if (table === 'doctor_commission_entries') {
            state.active++;
            state.peak = Math.max(state.peak, state.active);
            const firstId = call.filters[0][2][0];
            const delay = state.outOfOrder && firstId.endsWith('-0') ? 300 : 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
            state.active--;
            if (call.filters.some(([, , ids]) => ids.includes(state.failId))) {
              if (state.throwFailure) throw new TypeError('fetch failed');
              return { data: null, error: { message: 'Ledger unavailable' } };
            }
          }
          return { data: rows.slice(call.range[0], call.range[1] + 1), error: null, count: rows.length };
        };
        return load().then(resolve, reject);
      }
    };
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({ supabase: { from: mock.from, rpc: vi.fn() }, supabaseUrl: '', supabaseAnonKey: '' }));
import { api } from './api';

const readMls = (concurrency: number) => Promise.all([
  api.treatments.getAllRecords('branch-1', {
    limit: null, throwOnError: true, commissionRequestConcurrency: concurrency
  }),
  api.finance.getPayments('branch-1', {
    commissionRequestConcurrency: concurrency
  })
]);

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(mock.state, { active: 0, peak: 0, calls: [], failId: '', throwFailure: false, outOfOrder: false });
  vi.spyOn(api.materialCosts, 'getTotalsByPaymentIds').mockResolvedValue({});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('MLS bounded commission loading', () => {
  it('reduces simulated network waiting from 600ms to 200ms with identical financial rows', async () => {
    const start = Date.now();
    const baselineRequest = readMls(1);
    await vi.runAllTimersAsync();
    const baseline = await baselineRequest;
    expect(Date.now() - start).toBe(600);
    expect(mock.state.peak).toBe(2);

    Object.assign(mock.state, { active: 0, peak: 0, calls: [] });
    const optimizedStart = Date.now();
    const optimizedRequest = readMls(3);
    await vi.runAllTimersAsync();
    const optimized = await optimizedRequest;
    expect(Date.now() - optimizedStart).toBe(200);
    expect(mock.state.peak).toBe(6); // Three requests per independent lookup.
    expect(optimized).toEqual(baseline);
    const financialRows = buildMaterialCostPaymentRows(...optimized);
    expect(financialRows).toEqual(buildMaterialCostPaymentRows(...baseline));
    expect(financialRows).toHaveLength(300);
    expect(financialRows.reduce((sum, row) => sum + row.doctorEarnings, 0)).toBe(3000);
    expect(optimized[1][0].doctorEarningEntries).toEqual([
      expect.objectContaining({ id: 'entry-0', paymentId: 'payment-0', treatmentId: 'treatment-0', earnings: 10 })
    ]);
    expect(optimized[0]).toHaveLength(300);
    expect(optimized[1]).toHaveLength(300);
    const ledgerCalls = mock.state.calls.filter((call) => call.table === 'doctor_commission_entries');
    expect(ledgerCalls).toHaveLength(12);
    expect(ledgerCalls.every((call) => call.filters[0][2].length <= 50)).toBe(true);
    for (const table of ['treatments', 'payments']) {
      expect(mock.state.calls.filter((call) => call.table === table).every((call) =>
        call.filters.some(([op, column, value]: any[]) => op === 'eq' && column === 'location_id' && value === 'branch-1')
      )).toBe(true);
    }
  });

  it.each([false, true])('preserves optional ledger fallbacks when a batch fails (throws=%s)', async (throwFailure) => {
    mock.state.outOfOrder = true;
    mock.state.failId = 'treatment-50';
    mock.state.throwFailure = throwFailure;
    const treatmentRequest = api.treatments.getAllRecords('branch-1', {
      limit: null, throwOnError: true, commissionRequestConcurrency: 3
    });
    await vi.runAllTimersAsync();
    const records = await treatmentRequest;
    expect(records).toHaveLength(300);
    expect(records.every((record) => record.doctorEarningEntries?.[0]?.paymentId === `legacy-${record.id}`)).toBe(true);

    mock.state.failId = 'payment-50';
    const paymentRequest = api.finance.getPayments('branch-1', {
      commissionRequestConcurrency: 3
    });
    await vi.runAllTimersAsync();
    const payments = await paymentRequest;
    expect(payments).toHaveLength(300);
    expect(payments.slice(0, 50).every((payment) => payment.doctorEarningEntries?.length === 1)).toBe(true);
    expect(payments.slice(50).every((payment) => payment.doctorEarningEntries?.length === 0)).toBe(true);
  });

  it.each([undefined, 1, 3, 99, NaN])('stops new lookups after failure and caps concurrency (%s)', async (concurrency) => {
    mock.state.failId = 'payment-0';
    const request = api.finance.getPayments('branch-1', { commissionRequestConcurrency: concurrency });
    await vi.runAllTimersAsync();
    const payments = await request;
    const expectedPeak = concurrency === 3 || concurrency === 99 ? 3 : 1;
    expect(mock.state.peak).toBe(expectedPeak);
    expect(mock.state.calls.filter((call) => call.table === 'doctor_commission_entries')).toHaveLength(expectedPeak);
    expect(payments).toHaveLength(300);
    expect(payments.every((payment) => payment.doctorEarningEntries?.length === 0)).toBe(true);
  });
});