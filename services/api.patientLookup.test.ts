import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return { query, from: vi.fn(() => query) };
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

 describe('patients.getById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.query.maybeSingle.mockReset();
    supabaseMock.query.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it.each(['branch-1', 'branch-2'])('scopes the single patient lookup by both id AND %s', async (branch) => {
    await api.patients.getById('patient-1', branch);
    expect(supabaseMock.from).toHaveBeenCalledExactlyOnceWith('patients');
    expect(supabaseMock.query.select).toHaveBeenCalledExactlyOnceWith('*');
    expect(supabaseMock.query.eq.mock.calls).toEqual([
      ['id', 'patient-1'], ['location_id', branch]
    ]);
    expect(supabaseMock.query.maybeSingle).toHaveBeenCalledExactlyOnceWith();
  });

  it('maps database medical history and preserves patient identity', async () => {
    const medicalHistory = { allergies: ['penicillin'], conditions: ['diabetes'] };
    supabaseMock.query.maybeSingle.mockResolvedValue({
      data: { id: 'patient-1', location_id: 'branch-1', name: 'Test Patient', medical_history: medicalHistory },
      error: null
    });
    await expect(api.patients.getById('patient-1', 'branch-1')).resolves.toMatchObject({
      id: 'patient-1', location_id: 'branch-1', name: 'Test Patient', medicalHistory
    });
  });

  it('returns null when no patient matches the scoped query', async () => {
    await expect(api.patients.getById('missing', 'branch-1')).resolves.toBeNull();
  });

  it('does not replace existing directory account flags with an unqueried account state', async () => {
    supabaseMock.query.maybeSingle.mockResolvedValue({
      data: { id: 'patient-1', location_id: 'branch-1', medical_history: 'History' }, error: null
    });
    const fresh = await api.patients.getById('patient-1', 'branch-1');
    expect(fresh).not.toHaveProperty('has_account');
    expect(fresh).not.toHaveProperty('username');
    expect({ has_account: true, username: 'existing', ...fresh }).toMatchObject({
      has_account: true, username: 'existing'
    });
  });

  it('rejects with the original Supabase error rather than treating failure as not found', async () => {
    const error = { message: 'Patient lookup denied', code: '42501' };
    supabaseMock.query.maybeSingle.mockResolvedValue({ data: null, error });
    await expect(api.patients.getById('patient-1', 'branch-1')).rejects.toBe(error);
  });
});
