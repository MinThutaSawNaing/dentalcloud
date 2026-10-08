import { beforeEach, describe, expect, it, vi } from 'vitest';

const presenceMock = vi.hoisted(() => ({
  markActive: vi.fn(),
  markInactive: vi.fn()
}));

vi.mock('./activeStaffPresence', () => ({
  activeStaffPresence: presenceMock
}));

vi.mock('./api', () => ({
  api: {
    users: {
      getAll: vi.fn(),
      getById: vi.fn(),
      getByDoctorId: vi.fn(),
      create: vi.fn(),
      authenticate: vi.fn(),
      revokeAuthSession: vi.fn()
    }
  }
}));

import { auth, type AuthSession } from './auth';
import { api } from './api';
vi.mock('./secureAuth', () => ({ secureAuthRequest: vi.fn() }));
import { secureAuthRequest } from './secureAuth';

const createLocalStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    })
  };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('auth staff session presence resilience', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('localStorage', createLocalStorageMock());
    presenceMock.markActive.mockReset();
    presenceMock.markInactive.mockReset();
    vi.mocked(secureAuthRequest).mockImplementation(async () => {
      const current = auth.getSession();
      return { session: { kind: 'staff', id: current?.userId, doctor_id: current?.doctor_id } } as any;
    });
  });

  it('keeps a valid staff session when active presence tracking fails', async () => {
    presenceMock.markActive.mockRejectedValueOnce(new Error('RPC unavailable'));

    const session = await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000001',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      location_id: null
    });

    expect(session.username).toBe('admin');
    expect(auth.getSession()?.username).toBe('admin');
    expect(localStorage.removeItem).not.toHaveBeenCalledWith('dental_auth_session');
  });

  it('clears the local session even when inactive presence tracking fails during logout', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockRejectedValueOnce(new Error('RPC unavailable'));

    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000002',
      username: 'frontdesk',
      password: 'secret',
      role: 'normal',
      location_id: null
    });

    await auth.logout();

    expect(auth.getSession()).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('dental_auth_session');
  });

  it('revokes the server-issued staff token during logout', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockResolvedValueOnce(undefined);

    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000005',
      username: 'admin',
      auth_session_token: 'server-token-1',
      role: 'admin',
      location_id: null
    });

    await auth.logout();

    expect(api.users.revokeAuthSession).toHaveBeenCalledWith('server-token-1');
    expect(auth.getSession()).toBeNull();
  });

  it('refreshes branch permission changes from the database without requiring a new login', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000003',
      username: 'marketing',
      auth_session_token: 'valid-server-token',
      password: 'secret',
      role: 'normal',
      location_id: null,
      allowed_tabs: ['dashboard']
    });

    vi.mocked(api.users.getById).mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000003',
      username: 'marketing',
      password: '',
      role: 'normal',
      location_id: null,
      allowed_tabs: ['dashboard', 'branch-switching']
    });

    const refreshed = await auth.refreshStaffSession();

    expect(refreshed?.allowed_tabs).toContain('branch-switching');
    expect(auth.getSession()?.allowed_tabs).toContain('branch-switching');
  });

  it('clears a cached session when the staff account was deleted', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    presenceMock.markInactive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000004',
      username: 'removed-user',
      auth_session_token: 'valid-server-token',
      password: 'secret',
      role: 'normal',
      location_id: null
    });
    vi.mocked(api.users.getById).mockResolvedValueOnce(null);

    await expect(auth.refreshStaffSession()).resolves.toBeNull();
    expect(auth.getSession()).toBeNull();
    expect(api.users.getById).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000004');
  });

  it('repairs a legacy doctor session that stored doctors.id as userId', async () => {
    presenceMock.markActive.mockResolvedValueOnce(undefined);
    await auth.createStaffSession({
      id: '00000000-0000-0000-0000-000000000010',
      username: 'doctor@example.com',
      auth_session_token: 'valid-server-token',
      role: 'normal',
      location_id: '00000000-0000-0000-0000-000000000020',
      doctor_id: '00000000-0000-0000-0000-000000000010'
    });
    vi.mocked(api.users.getById).mockResolvedValueOnce(null);
    vi.mocked(api.users.getByDoctorId).mockResolvedValueOnce({
      id: '00000000-0000-0000-0000-000000000011',
      username: 'doctor@example.com',
      role: 'normal',
      location_id: '00000000-0000-0000-0000-000000000020',
      doctor_id: '00000000-0000-0000-0000-000000000010'
    });

    const refreshed = await auth.refreshStaffSession();

    expect(api.users.getByDoctorId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000010');
    expect(refreshed?.userId).toBe('00000000-0000-0000-0000-000000000011');
    expect(refreshed?.role).toBe('doctor');
    expect(auth.getSession()?.userId).toBe('00000000-0000-0000-0000-000000000011');
  });

  it('does not validate patient sessions against the staff users table', async () => {
    auth.setSession({
      userId: '00000000-0000-0000-0000-000000000030',
      patientId: '00000000-0000-0000-0000-000000000030',
      username: 'Patient One',
      role: 'patient',
      location_id: '00000000-0000-0000-0000-000000000040',
      loginTime: Date.now()
    });

    const refreshed = await auth.refreshStaffSession();

    expect(refreshed?.role).toBe('patient');
    expect(api.users.getById).not.toHaveBeenCalled();
    expect(api.users.getByDoctorId).not.toHaveBeenCalled();
  });

  const seedSession = (): AuthSession => {
    auth.setSession({ userId: 'staff-1', username: 'Staff', role: 'normal',
      staffAuthToken: 'token-1', location_id: null, loginTime: Date.now() });
    return auth.getSession()!;
  };

  it('does not resurrect a logged-out session after a delayed user lookup', async () => {
    seedSession();
    const lookup = deferred<any>();
    vi.mocked(api.users.getById).mockReturnValueOnce(lookup.promise);
    const refresh = auth.refreshStaffSession();
    await vi.waitFor(() => expect(api.users.getById).toHaveBeenCalled());
    await auth.logout();
    lookup.resolve({ id: 'staff-1', username: 'Staff', role: 'normal', location_id: null });
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()).toBeNull();
  });

  it.each([true, false])('does not overwrite or delete a newer login after a delayed lookup (account exists: %s)', async (exists) => {
    const original = seedSession();
    const lookup = deferred<any>();
    vi.mocked(api.users.getById).mockReturnValueOnce(lookup.promise);
    const refresh = auth.refreshStaffSession();
    await vi.waitFor(() => expect(api.users.getById).toHaveBeenCalled());
    auth.setSession({ ...original, userId: 'staff-2', staffAuthToken: 'token-2' });
    const newer = auth.getSession();
    lookup.resolve(exists ? { id: 'staff-1', username: 'Staff', role: 'normal' } : null);
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()).toEqual(newer);
    expect(api.users.revokeAuthSession).not.toHaveBeenCalled();
  });

  it('does not revoke a newer login after delayed invalid validation', async () => {
    const original = seedSession();
    const validation = deferred<any>();
    vi.mocked(secureAuthRequest).mockReturnValueOnce(validation.promise);
    const refresh = auth.refreshStaffSession();
    auth.setSession({ ...original, staffAuthToken: 'new-token' });
    validation.resolve({ session: null });
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()?.staffAuthToken).toBe('new-token');
    expect(api.users.getById).not.toHaveBeenCalled();
    expect(api.users.revokeAuthSession).not.toHaveBeenCalled();
  });

  it('invalidates refreshes as soon as logout starts, before network cleanup finishes', async () => {
    seedSession();
    const lookup = deferred<any>();
    const cleanup = deferred<void>();
    vi.mocked(api.users.getById).mockReturnValueOnce(lookup.promise);
    presenceMock.markInactive.mockReturnValueOnce(cleanup.promise);
    const refresh = auth.refreshStaffSession();
    await vi.waitFor(() => expect(api.users.getById).toHaveBeenCalled());
    const logout = auth.logout();
    lookup.resolve({ id: 'staff-1', username: 'Changed', role: 'normal' });
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()).toBeNull();
    cleanup.resolve();
    await logout;
    expect(auth.getSession()).toBeNull();
  });

  it('does not clear a newer login when an old logout finishes', async () => {
    const original = seedSession();
    const revoke = deferred<void>();
    vi.mocked(api.users.revokeAuthSession).mockReturnValueOnce(revoke.promise);
    const logout = auth.logout();
    await vi.waitFor(() => expect(api.users.revokeAuthSession).toHaveBeenCalledWith('token-1'));
    auth.setSession({ ...original, staffAuthToken: 'new-token' });
    revoke.resolve();
    await logout;
    expect(auth.getSession()?.staffAuthToken).toBe('new-token');
  });

  it('rejects cross-tab session replacement during refresh', async () => {
    seedSession();
    const lookup = deferred<any>();
    vi.mocked(api.users.getById).mockReturnValueOnce(lookup.promise);
    const refresh = auth.refreshStaffSession();
    await vi.waitFor(() => expect(api.users.getById).toHaveBeenCalled());
    // Another tab writes localStorage without changing this module's revision.
    localStorage.setItem('dental_auth_session', JSON.stringify({ ...auth.getSession(), staffAuthToken: 'other-tab-token' }));
    lookup.resolve({ id: 'staff-1', username: 'Old', role: 'normal' });
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()?.staffAuthToken).toBe('other-tab-token');
  });

  it('does not start a new refresh while logout network cleanup is pending', async () => {
    seedSession();
    const cleanup = deferred<void>();
    presenceMock.markInactive.mockReturnValueOnce(cleanup.promise);
    const logout = auth.logout();
    await expect(auth.refreshStaffSession()).resolves.toBeNull();
    expect(secureAuthRequest).not.toHaveBeenCalled();
    expect(api.users.getById).not.toHaveBeenCalled();
    cleanup.resolve();
    await logout;
  });

  it('gives a login during logout a new presence instance', async () => {
    const original = seedSession();
    const cleanup = deferred<void>();
    presenceMock.markInactive.mockReturnValueOnce(cleanup.promise);
    const logout = auth.logout();
    await auth.createStaffSession({ id: 'staff-2', username: 'New Staff', role: 'normal',
      location_id: null, auth_session_token: 'token-2' });
    expect(auth.getSession()?.clientSessionId).not.toBe(original.clientSessionId);
    cleanup.resolve();
    await logout;
    expect(auth.getSession()?.staffAuthToken).toBe('token-2');
  });

  it('does not revoke a newer login after delayed invalid patient validation', async () => {
    auth.setSession({ userId: 'patient-1', patientId: 'patient-1', username: 'Patient',
      role: 'patient', patientAuthToken: 'patient-token', loginTime: Date.now(), location_id: null });
    const validation = deferred<any>();
    vi.mocked(secureAuthRequest).mockReturnValueOnce(validation.promise);
    const refresh = auth.validatePatientSession();
    const newer = seedSession();
    validation.resolve({ session: null });
    await expect(refresh).resolves.toBeNull();
    expect(auth.getSession()).toEqual(newer);
    expect(api.users.revokeAuthSession).not.toHaveBeenCalled();
  });
});
