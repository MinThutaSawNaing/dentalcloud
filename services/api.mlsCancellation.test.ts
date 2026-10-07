import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => {
  type Call = { table: string; columns: string; range: number[]; ids?: string[]; signal?: AbortSignal; abortCalls: number };
  const state = {
    calls: [] as Call[], rowCount: 151,
    read: undefined as undefined | ((call: Call, index: number) => any)
  };
  const from = vi.fn((table: string) => {
    const call: Call = { table, columns: '', range: [0, 999], abortCalls: 0 };
    state.calls.push(call);
    const query: any = {
      select: (columns: string) => { call.columns = columns; return query; },
      order: () => query,
      eq: () => query,
      gte: () => query,
      lte: () => query,
      in: (_column: string, ids: string[]) => { call.ids = ids; return query; },
      range: (from: number, to: number) => { call.range = [from, to]; return query; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; call.abortCalls++; return query; },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => {
        const override = state.read?.(call, state.calls.filter(item => item.table === table).indexOf(call));
        if (override !== undefined) return override;
        let rows: any[] = [];
        if (table === 'treatments' || table === 'payments') {
          rows = Array.from({ length: state.rowCount }, (_, index) => ({
            id: `row-${index}`, patient_id: 'patient-1', doctor_id: 'doctor-1',
            date: '2026-10-05', payment_date: '2026-10-05', cost: 100,
            amount: 100, doctor_earnings: 10
          })).slice(call.range[0], call.range[1] + 1);
        } else if (table === 'doctor_commission_entries') {
          rows = (call.ids || []).map(id => ({ treatment_id: id, payment_id: id, earnings: 10 }));
        } else if (table === 'audit_logs') {
          rows = (call.ids || []).map(id => ({ id: `audit-${id}`, source_id: id }));
        } else if (table === 'patient_material_costs') {
          rows = (call.ids || []).map(id => ({ audit_log_id: id, cost_type: 'material', total_amount: 5 }));
        }
        return { data: rows, error: null, count: state.rowCount };
      }).then(resolve, reject)
    };
    return query;
  });
  return { state, from };
});

vi.mock('./supabase', () => ({ supabase: { from: mock.from }, supabaseUrl: '', supabaseAnonKey: '' }));
import { api } from './api';

beforeEach(() => {
  mock.state.calls = [];
  mock.state.rowCount = 151;
  mock.state.read = undefined;
});

const read = (kind: 'treatments' | 'payments', signal?: AbortSignal, options: any = {}) => kind === 'treatments'
  ? api.treatments.getAllRecords('branch-1', { limit: null, signal, ...options })
  : api.finance.getPayments('branch-1', { signal, ...options });
const callsFor = (table: string) => mock.state.calls.filter(call => call.table === table);
const expectAborted = async (request: Promise<unknown>, signal: AbortSignal) => {
  const error = await request.then(() => { throw new Error('Expected read to reject'); }, error => error);
  expect(signal.aborted).toBe(true);
  expect(error).toBe(signal.reason);
};
const expectSignals = (signal: AbortSignal) => {
  expect(mock.state.calls.length).toBeGreaterThan(0);
  expect(mock.state.calls.every(call => call.signal === signal && call.abortCalls === 1)).toBe(true);
};

describe('MLS read cancellation', () => {
  it('does not attach abortSignal when omitted', async () => {
    await read('treatments');
    await read('payments');
    expect(mock.state.calls.every(call => call.abortCalls === 0)).toBe(true);
  });

  it('rejects pre-aborted reads, including empty cost requests, without scheduling queries', async () => {
    const controller = new AbortController();
    controller.abort(new Error('MLS timeout'));
    await expect(read('treatments', controller.signal)).rejects.toBe(controller.signal.reason);
    await expect(read('payments', controller.signal)).rejects.toBe(controller.signal.reason);
    await expect(api.materialCosts.getTotalsByPaymentIds([], { signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(mock.state.calls).toEqual([]);
  });

  it.each(['treatments', 'payments'] as const)('propagates to every %s page and enrichment read', async kind => {
    mock.state.rowCount = 1001;
    const controller = new AbortController();
    const rows = await read(kind, controller.signal, { commissionRequestConcurrency: 3 });
    expect(rows).toHaveLength(1001);
    expect(callsFor(kind).map(call => call.range)).toEqual([[0, 999], [1000, 1999]]);
    expect(callsFor('doctor_commission_entries')).toHaveLength(21);
    if (kind === 'payments') {
      expect(callsFor('audit_logs')).toHaveLength(21);
      expect(callsFor('patient_material_costs')).toHaveLength(21);
      expect(rows[0]).toMatchObject({ mlsTotal: 5, netRevenue: 95 });
    }
    expectSignals(controller.signal);
  });
});


describe('MLS cancellation boundaries and fallbacks', () => {
  it.each(['treatments', 'payments'] as const)('stops %s after a page completes and progress aborts', async kind => {
    mock.state.rowCount = 1001;
    const controller = new AbortController();
    await expectAborted(read(kind, controller.signal, {
      onProgress: () => controller.abort(new Error('watchdog timeout'))
    }), controller.signal);
    expect(callsFor(kind)).toHaveLength(1);
    expect(callsFor('doctor_commission_entries')).toHaveLength(0);
    expectSignals(controller.signal);
  });

  it.each(['treatments', 'payments'] as const)('rejects an abort after a %s read before relation fallback', async kind => {
    const controller = new AbortController();
    mock.state.read = call => {
      if (call.table === kind) {
        controller.abort(new Error('timeout during read'));
        return { data: null, error: { code: '42P01', message: 'patients does not exist' } };
      }
    };
    await expectAborted(read(kind, controller.signal), controller.signal);
    expect(mock.state.calls).toHaveLength(1);
    expectSignals(controller.signal);
  });

  it.each(['treatments', 'payments'] as const)('keeps non-abort %s fallbacks and propagates their signal', async kind => {
    const controller = new AbortController();
    mock.state.read = (call, index) => {
      if (call.table !== kind) return;
      const relation = kind === 'treatments' ? 'doctors'
        : ['payment_allocations', 'payment_corrections', 'patients'][index];
      if (index < (kind === 'treatments' ? 1 : 3)) {
        return { data: null, error: { code: '42P01', message: `${relation} does not exist` } };
      }
    };
    expect(await read(kind, controller.signal)).toHaveLength(151);
    expect(callsFor(kind)).toHaveLength(kind === 'treatments' ? 2 : 4);
    expect(callsFor(kind).at(-1)?.columns).toBe('*');
    expectSignals(controller.signal);
  });

  it.each(['treatments', 'payments'] as const)('rejects aborted %s fallback reads rather than empty data', async kind => {
    const controller = new AbortController();
    mock.state.read = (call, index) => {
      if (call.table !== kind) return;
      if (index === 0) return { data: null, error: { code: '42P01', message: 'patients does not exist' } };
      controller.abort();
      return { data: [], error: null };
    };
    await expectAborted(read(kind, controller.signal), controller.signal);
    expect(mock.state.calls).toHaveLength(2);
    expectSignals(controller.signal);
  });

  it.each(['treatments', 'payments'] as const)('does not publish partial/stored commissions for aborted %s ledger reads', async kind => {
    const controller = new AbortController();
    mock.state.read = (call, index) => {
      if (call.table === 'doctor_commission_entries' && index === 1) {
        controller.abort(new Error('ledger timeout'));
        return { data: null, error: { code: '42P01', message: 'doctor_commission_entries does not exist' } };
      }
    };
    await expectAborted(read(kind, controller.signal), controller.signal);
    expect(callsFor('doctor_commission_entries')).toHaveLength(2);
    expectSignals(controller.signal);
  });

  it.each(['treatments', 'payments'] as const)('stops concurrent %s commission batch scheduling after abort', async kind => {
    const controller = new AbortController();
    await expectAborted(read(kind, controller.signal, {
      commissionRequestConcurrency: 3,
      onEnrichmentProgress: (stage: string, completed: number) => {
        if (stage === 'commission' && completed === 1) controller.abort();
      }
    }), controller.signal);
    expect(callsFor('doctor_commission_entries')).toHaveLength(3);
    expectSignals(controller.signal);
  });

  it.each(['audit_logs', 'patient_material_costs'])('rejects aborted %s without partial cost success or more batches', async table => {
    const controller = new AbortController();
    mock.state.read = (call, index) => {
      if (call.table === table && index === 0) {
        controller.abort(new Error('cost timeout'));
        return { data: null, error: { code: '42P01', message: `${table} does not exist` } };
      }
    };
    await expectAborted(read('payments', controller.signal), controller.signal);
    expect(callsFor(table)).toHaveLength(3);
    if (table === 'audit_logs') expect(callsFor('patient_material_costs')).toHaveLength(0);
    expectSignals(controller.signal);
  });
});

describe('MLS abort error results and shared watchdog signal', () => {
  it.each([false, true])('rethrows commission AbortError rather than optional fallback (throws=%s)', async throws => {
    const error = { name: 'AbortError', message: 'AbortError: request aborted' };
    mock.state.read = call => {
      if (call.table !== 'doctor_commission_entries') return;
      if (throws) throw error;
      return { data: null, error };
    };
    await expect(read('treatments')).rejects.toBe(error);
    await expect(read('payments')).rejects.toBe(error);
  });

  it('recognizes PostgREST serialized abort errors before relation fallbacks', async () => {
    const error = { message: 'AbortError: patients relationship request aborted', code: '42P01' };
    mock.state.read = () => ({ data: null, error });
    await expect(read('treatments')).rejects.toBe(error);
    await expect(read('payments')).rejects.toBe(error);
    expect(mock.state.calls).toHaveLength(2);
  });

  it.each(['cost-audits', 'cost-items'])('stops direct cost batches after %s completion aborts', async stage => {
    const controller = new AbortController();
    const ids = Array.from({ length: 201 }, (_, index) => `row-${index}`);
    await expectAborted(api.materialCosts.getTotalsByPaymentIds(ids, {
      idBatchSize: 50, signal: controller.signal,
      onProgress: (currentStage, completed) => {
        if (currentStage === stage && completed === 1) controller.abort();
      }
    }), controller.signal);
    expect(callsFor(stage === 'cost-audits' ? 'audit_logs' : 'patient_material_costs')).toHaveLength(3);
    if (stage === 'cost-audits') expect(callsFor('patient_material_costs')).toHaveLength(0);
    expectSignals(controller.signal);
  });

  it('aborts both full MLS APIs with one watchdog signal and schedules no later batches', async () => {
    const controller = new AbortController();
    const requests = [read('treatments', controller.signal, {
      onEnrichmentProgress: (stage: string, completed: number) => {
        if (stage === 'commission' && completed === 1) controller.abort(new Error('MLS idle timeout'));
      }
    }), read('payments', controller.signal)];
    const results = await Promise.allSettled(requests);
    expect(results.every(result => result.status === 'rejected' && result.reason === controller.signal.reason)).toBe(true);
    expect(callsFor('doctor_commission_entries')).toHaveLength(2);
    expectSignals(controller.signal);
  });
});
