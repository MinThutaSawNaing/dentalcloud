import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ from: vi.fn(), result: { data: null as any, error: null as any }, writes: [] as any[] }));
vi.mock('./supabase', () => ({ supabase: { from: mock.from }, supabaseUrl: '', supabaseAnonKey: '' }));
import { api } from './api';

describe('Auto OPT settings', () => {
  beforeEach(() => {
    mock.result = { data: null, error: null };
    mock.writes = [];
    const query: any = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => mock.result),
      upsert: vi.fn(async (value) => { mock.writes.push(value); return mock.result; })
    };
    mock.from.mockReset().mockReturnValue(query);
  });

  it('defaults off for a missing singleton or migration', async () => {
    expect(await api.appSettings.getAutoOptPatientTypeEnabled()).toBe(false);
    mock.result.error = { code: '42703', message: 'column auto_opt_patient_type_enabled does not exist' };
    expect(await api.appSettings.getAutoOptPatientTypeEnabled()).toBe(false);
  });

  it('loads the shared enabled value', async () => {
    mock.result.data = { auto_opt_patient_type_enabled: true };
    expect(await api.appSettings.getAutoOptPatientTypeEnabled()).toBe(true);
  });

  it('saves only the singleton preference without touching patients or visits', async () => {
    await api.appSettings.saveAutoOptPatientTypeEnabled(true);
    await api.appSettings.saveAutoOptPatientTypeEnabled(false);
    expect(mock.from.mock.calls).toEqual([['app_settings'], ['app_settings']]);
    expect(mock.writes).toEqual([
      { id: 1, auto_opt_patient_type_enabled: true, updated_at: expect.any(String) },
      { id: 1, auto_opt_patient_type_enabled: false, updated_at: expect.any(String) }
    ]);
  });

  it('reports missing migration and persistence errors rather than claiming success', async () => {
    mock.result.error = { code: '42703', message: 'column auto_opt_patient_type_enabled does not exist' };
    await expect(api.appSettings.saveAutoOptPatientTypeEnabled(true)).rejects.toThrow(/not installed/);
    mock.result.error = { code: '42501', message: 'permission denied' };
    await expect(api.appSettings.saveAutoOptPatientTypeEnabled(true)).rejects.toThrow('permission denied');
  });
});