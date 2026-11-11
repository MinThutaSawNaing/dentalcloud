import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: mock, supabaseUrl: '', supabaseAnonKey: '' }));
import { api } from './api';

describe('automatic ONP load safety', () => {
  beforeEach(() => {
    mock.from.mockReset();
    mock.rpc.mockReset();
    const query: any = {
      select: vi.fn(() => query), order: vi.fn(() => query),
      range: vi.fn(() => query), eq: vi.fn(() => query),
      then: (resolve: any) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve)
    };
    mock.from.mockReturnValue(query);
  });

  it('fails closed without downloading eligible IDs or issuing PATCH batches when the RPC is missing', async () => {
    mock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find apply_auto_onp_patient_type' } });
    await api.patients.getPage('missing-rpc', 0, 10);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    // Only the ordinary paginated directory read remains; no fallback reads or writes.
    expect(mock.from.mock.calls).toEqual([['patients']]);
  });

  it('deduplicates concurrent refreshes and observes the per-branch cooldown', async () => {
    mock.rpc.mockResolvedValue({ data: 0, error: null });
    await Promise.all([
      api.patients.getPage('deduplicated', 0, 10),
      api.patients.getPage('deduplicated', 0, 10)
    ]);
    await api.patients.getPage('deduplicated', 0, 10);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc).toHaveBeenCalledWith('apply_auto_onp_patient_type', { p_location_id: 'deduplicated' });
  });
});