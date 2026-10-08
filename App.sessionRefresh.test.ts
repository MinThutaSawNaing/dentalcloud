import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transpileModule, ScriptTarget } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOCTOR_DASHBOARD_TABS } from './constants';
import { resolveAllowedTabs } from './utils/permissions';
import { isSameAuthSession, type AuthSession } from './services/auth';

vi.mock('./services/api', () => ({ api: {} }));
vi.mock('./services/secureAuth', () => ({ secureAuthRequest: vi.fn() }));
vi.mock('./services/activeStaffPresence', () => ({ activeStaffPresence: {} }));

const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
function extract(start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to <= from) throw new Error(`Missing App block: ${start}`);
  return transpileModule(source.slice(from, to), {
    compilerOptions: { target: ScriptTarget.ES2022 }, fileName: 'session.ts'
  }).outputText;
}
const intervalCode = extract('    let syncInProgress = false;', '  }, [isAuthenticated]);');
const applyCode = extract('  const applySessionState =', '  const resetStaffSession =');
const bootstrapCode = extract('    let cancelled = false;\n    const bootstrapSession =', '  }, []);');
const logoutCode = extract('  const handleLogout =', '  const handleMouseDown =');

function bootstrapHarness(auth: Record<string, any>) {
  const applySessionState = vi.fn();
  const resetStaffSession = vi.fn();
  const fetchInitialData = vi.fn();
  const fetchUsers = vi.fn();
  const mount = () => new Function('auth', 'applySessionState', 'resetStaffSession',
    'fetchInitialData', 'fetchUsers', 'getPreferredSessionBranchId', 'isSameAuthSession', bootstrapCode)(
    auth, applySessionState, resetStaffSession, fetchInitialData, fetchUsers,
    (value: AuthSession) => value.location_id, isSameAuthSession);
  return { mount, applySessionState, resetStaffSession, fetchInitialData, fetchUsers };
}

function harness() {
  let session: AuthSession | null = { userId: 'staff-1', username: 'Staff', role: 'normal',
    staffAuthToken: 'token-1', clientSessionId: 'device-1', loginTime: 1, location_id: null };
  const auth = { getSession: vi.fn(() => session), refreshStaffSession: vi.fn(async () => session) };
  const applySessionState = vi.fn();
  const resetStaffSession = vi.fn();
  const setCurrentView = vi.fn();
  const fetchInitialData = vi.fn();
  const window = { setInterval, clearInterval, location: { reload: vi.fn() } };
  const cleanup = new Function('auth', 'applySessionState', 'resetStaffSession', 'setCurrentView',
    'fetchInitialData', 'getPreferredSessionBranchId', 'isSameAuthSession', 'window', intervalCode)(
    auth, applySessionState, resetStaffSession, setCurrentView, fetchInitialData,
    (value: AuthSession) => value.location_id, isSameAuthSession, window);
  return { auth, applySessionState, resetStaffSession, setCurrentView, fetchInitialData, cleanup, window,
    getSession: () => session, setSession: (value: AuthSession | null) => { session = value; } };
}

// Execute the actual App callbacks with controlled timers; this is not a mounted React/browser test.
describe('App permission refresh callbacks', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('does not reload clinic data or navigate during unchanged minute refreshes', async () => {
    vi.useFakeTimers();
    const h = harness();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(h.auth.refreshStaffSession).toHaveBeenCalledTimes(3);
    expect(h.applySessionState).toHaveBeenCalledTimes(3);
    expect(h.fetchInitialData).not.toHaveBeenCalled();
    expect(h.setCurrentView).not.toHaveBeenCalled();
    expect(h.window.location.reload).not.toHaveBeenCalled();
    h.cleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.auth.refreshStaffSession).toHaveBeenCalledTimes(3);
  });

  it.each(['cleanup', 'new-login', 'superseded'])('ignores a pending result after %s', async (reason) => {
    vi.useFakeTimers();
    const h = harness();
    const old = h.getSession();
    let finish!: (value: AuthSession | null) => void;
    h.auth.refreshStaffSession.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.auth.refreshStaffSession).toHaveBeenCalledTimes(1);
    if (reason === 'cleanup') h.cleanup();
    else h.setSession({ ...old!, staffAuthToken: 'new-token' });
    finish(reason === 'superseded' ? null : old);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.applySessionState).not.toHaveBeenCalled();
    expect(h.resetStaffSession).not.toHaveBeenCalled();
    expect(h.fetchInitialData).not.toHaveBeenCalled();
    h.cleanup();
  });

  it('resets the UI when validation actually clears the active login', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.auth.refreshStaffSession.mockImplementationOnce(async () => { h.setSession(null); return null; });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.resetStaffSession).toHaveBeenCalledTimes(1);
    expect(h.setCurrentView).toHaveBeenCalledWith('dashboard');
    h.cleanup();
  });

  it('reloads data once when the current staff branch assignment changes', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.auth.refreshStaffSession.mockImplementationOnce(async () => {
      h.setSession({ ...h.getSession()!, location_id: 'branch-2' });
      return h.getSession();
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.fetchInitialData).toHaveBeenCalledExactlyOnceWith('branch-2');
    h.cleanup();
  });

  it.each(['doctor', 'normal', 'admin'] as const)('preserves unchanged %s permission array identity', (role) => {
    let views: string[] = [];
    const setters = ['setIsAuthenticated', 'setIsAdmin', 'setIsDoctor', 'setCurrentUser'];
    const apply = new Function(...setters, 'setAllowedViews', 'DOCTOR_DASHBOARD_TABS', 'resolveAllowedTabs',
      `${applyCode}\nreturn applySessionState;`)(...setters.map(() => vi.fn()),
      (update: string[] | ((previous: string[]) => string[])) => {
        views = typeof update === 'function' ? update(views) : update;
      }, DOCTOR_DASHBOARD_TABS, resolveAllowedTabs);
    const session = { userId: 'staff-1', username: 'Staff', role, location_id: null, allowed_tabs: ['dashboard'] };
    apply(session);
    const previous = views;
    apply(session);
    expect(views.length).toBeGreaterThan(0);
    expect(views).toBe(previous);
    if (role === 'normal') {
      apply({ ...session, allowed_tabs: ['dashboard', 'patients'] });
      expect(views).not.toBe(previous);
      expect(views).toContain('patients');
    }
  });

  it.each([false, true])('uses the live bootstrap when a cancelled StrictMode refresh supersedes its request (doctor migration: %s)', async (migrateDoctor) => {
    vi.useFakeTimers();
    const original: AuthSession = { userId: 'staff-1', username: 'Staff', role: 'normal',
      staffAuthToken: 'token-1', loginTime: 1, location_id: null,
      ...(migrateDoctor ? { role: 'doctor' as const, doctor_id: 'doctor-1' } : {}) };
    let current = original;
    const completions: Array<(value: AuthSession | null) => void> = [];
    const auth = { getSession: () => current,
      refreshStaffSession: vi.fn(() => new Promise((resolve) => { completions.push(resolve); })),
      initializeDefaultAdmin: vi.fn(async () => {}), restoreSupabaseSession: vi.fn() };
    const h = bootstrapHarness(auth);
    const firstCleanup = h.mount();
    firstCleanup();
    const secondCleanup = h.mount();
    current = { ...original, userId: migrateDoctor ? 'canonical-staff-1' : original.userId, allowed_tabs: ['patients'] };
    completions[0](current);
    completions[1](null);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.applySessionState).toHaveBeenCalledExactlyOnceWith(current);
    expect(h.fetchInitialData).toHaveBeenCalledTimes(1);
    expect(h.resetStaffSession).not.toHaveBeenCalled();
    secondCleanup();
  });

  it('uses latest same-login permissions when bootstrap refresh fails', async () => {
    vi.useFakeTimers();
    const original: AuthSession = { userId: 'staff-1', username: 'Staff', role: 'admin',
      staffAuthToken: 'token-1', loginTime: 1, location_id: null };
    let current = original;
    const auth = { getSession: () => current, refreshStaffSession: vi.fn(async () => {
      current = { ...original, role: 'normal', allowed_tabs: ['patients'] };
      throw new Error('Network unavailable');
    }), initializeDefaultAdmin: vi.fn(async () => {}) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = bootstrapHarness(auth);
    const cleanup = h.mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.applySessionState).toHaveBeenCalledExactlyOnceWith(current);
    expect(h.resetStaffSession).not.toHaveBeenCalled();
    cleanup();
    warn.mockRestore();
  });

  it('does not reset a newer login after an old patient bootstrap rejects', async () => {
    vi.useFakeTimers();
    let current: AuthSession = { userId: 'patient-1', username: 'Patient', role: 'patient',
      patientAuthToken: 'old-token', loginTime: 1, location_id: null };
    let fail!: (error: Error) => void;
    const auth = { getSession: () => current,
      validatePatientSession: vi.fn(() => new Promise((_, reject) => { fail = reject; })) };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = bootstrapHarness(auth);
    const cleanup = h.mount();
    current = { ...current, userId: 'patient-2', patientAuthToken: 'new-token' };
    fail(new Error('Network unavailable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.resetStaffSession).not.toHaveBeenCalled();
    expect(h.applySessionState).not.toHaveBeenCalled();
    cleanup();
    warn.mockRestore();
  });

  it('does not clear newer login UI after old logout network cleanup completes', async () => {
    let finish!: () => void;
    let current: AuthSession | null = null;
    const auth = { getSession: () => current, logout: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })) };
    const setIsLoggingOut = vi.fn();
    const logout = new Function('auth', 'isLoggingOut', 'setIsLoggingOut',
      `${logoutCode}\nreturn handleLogout();`)(auth, false, setIsLoggingOut);
    current = { userId: 'staff-2', username: 'New Staff', role: 'normal',
      staffAuthToken: 'new-token', loginTime: 2, location_id: null };
    finish();
    // Any attempt to reach old-session cleanup accesses unbound UI/cache setters
    // and fails this test, rather than silently clearing a newer login.
    await expect(logout).resolves.toBeUndefined();
    expect(setIsLoggingOut.mock.calls).toEqual([[true], [false]]);
  });
});