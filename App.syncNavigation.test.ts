import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataCache } from './utils/dataCache';
import { mergePatientsById } from './utils/patientMerge';
import { getMlsSyncPercentage, getMlsStageFraction } from './utils/mlsSyncProgress';

beforeEach(() => dataCache.clear());

const app = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const mlsAnchor = '// MLS reads are owned by the branch/session';
const lazyAnchor = '// Fetch only the selected screen';
function section(start: string, end: string) {
  const from = app.indexOf(start);
  const to = app.indexOf(end, from + start.length);
  if (from < 0 || to <= from) throw new Error(`Missing effect boundaries: ${start} / ${end}`);
  return app.slice(from, to);
}
const mlsSource = section(mlsAnchor, lazyAnchor);
// Keep the entire lazy useEffect, but not the following visibility effect.
const lazyStart = app.indexOf(lazyAnchor);
const lazyEffectStart = app.indexOf('\n  useEffect(() => {', lazyStart);
const lazyEffectEnd = app.indexOf('\n  useEffect(() => {', lazyEffectStart + 1);
if (lazyEffectStart < 0 || lazyEffectEnd < 0) throw new Error('Missing lazy effect boundaries');
const lazySource = app.slice(lazyStart, lazyEffectEnd);
const compile = (source: string) => transpileModule(source, {
  compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  fileName: 'isolated-effect.tsx',
}).outputText;
const mlsCode = compile(mlsSource);
const lazyCode = compile(lazySource);

type Context = Record<string, any>;
type Effect = () => void | (() => void);
function renderer(code: string, context: Context) {
  let cleanup: void | (() => void);
  return (currentView: string) => {
    if (typeof cleanup === 'function') cleanup();
    let effect: Effect | undefined;
    // A new lexical environment per render, with persistent refs and setters.
    const closure = { ...context, currentView, useEffect: (callback: Effect) => { effect = callback; } };
    new Function(...Object.keys(closure), code)(...Object.values(closure));
    if (!effect) throw new Error('Extracted source did not register an effect');
    cleanup = effect();
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// All asynchronous work is promise-only; drain without timers or polling.
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
const records = [{ id: 'treatment-1' }];
const payments = [{ id: 'payment-1' }];
function harness(code = mlsCode) {
  const treatmentReads: ReturnType<typeof deferred<any[]>>[] = [];
  const paymentReads: ReturnType<typeof deferred<any[]>>[] = [];
  const patientReads: ReturnType<typeof deferred<any[]>>[] = [];
  const pending = (reads: typeof treatmentReads) => {
    const read = deferred<any[]>();
    reads.push(read);
    return read.promise;
  };
  const context: Context = {
    leanStaffStartup: true, isAuthenticated: true, currentLocationId: 'branch-a',
    startupScope: 'branch-a', initialSyncActive: false, allowedViews: ['material-cost', 'patients'],
    mlsScope: '', mlsSyncError: null, mlsCacheRevision: 0, lazyViewRevision: 0,
    initialDataFetchRequestRef: { current: 1 }, mlsCacheVersionRef: { current: 0 },
    mlsInFlightRef: { current: null }, mlsAuthenticatedRef: { current: true },
    currentLocationIdRef: { current: 'branch-a' }, lazyViewRequestRef: { current: 0 },
    canAccessView: vi.fn(() => true),
    loadAIAssistantView: vi.fn().mockResolvedValue({ default: () => null }),
    api: {
      treatments: { getAllRecords: vi.fn(() => pending(treatmentReads)) },
      finance: { getPayments: vi.fn(() => pending(paymentReads)) },
      patients: { getPage: vi.fn(() => pending(patientReads)) },
    },
    // Collaborators are mocked; loader control flow is always the actual App source.
    getHistorySyncPercentage: vi.fn((reads: { done: boolean }[]) =>
      reads.every(read => read.done) ? 100 : 50),
    mergeLegacyPaymentRecords: vi.fn((rows: any[]) => rows),
    setMlsRecords: vi.fn(), setMlsPayments: vi.fn(), setMlsSyncProgress: vi.fn(), setMlsFinalizing: vi.fn(),
    setMlsScope: vi.fn((scope: string) => { context.mlsScope = scope; }),
    setMlsSyncError: vi.fn((error: string | null) => { context.mlsSyncError = error; }),
    setLoadedLazyView: vi.fn(), setLazyViewError: vi.fn(),
    historyScope: 'branch-a', setHistoryScope: vi.fn((scope: string) => { context.historyScope = scope; }),
    patients: [{ id: 'existing', name: 'Old' }],
    setPatients: vi.fn((update: (previous: any[]) => any[]) => { context.patients = update(context.patients); }),
    mergePatientsById,
    getMlsSyncPercentage, getMlsStageFraction,
    dataCache, navigationCacheVersionRef: { current: 0 },
    auth: { getSession: vi.fn(() => ({ role: 'admin', location_id: 'branch-a' })), isAdmin: vi.fn(() => true) },
    isAdmin: true, getClinicCacheScope: (scope: string) => `tenant-a:${scope}`,
    getSessionRestrictedLocationId: vi.fn(() => undefined),
    dashboardLocationId: 'branch-a', dashboardFetchRequestRef: { current: 0 },
    locations: [{ id: 'branch-a' }, { id: 'branch-b' }], ALL_BRANCHES_VALUE: 'all',
    localStorage: { setItem: vi.fn() },
    PATIENTS_INITIAL_LOAD_SIZE: 50,
  };
  const render = renderer(code, context);
  const counts = (count: number) => {
    expect(context.api.treatments.getAllRecords).toHaveBeenCalledTimes(count);
    expect(context.api.finance.getPayments).toHaveBeenCalledTimes(count);
  };
  const settle = async (index = 0) => {
    treatmentReads[index].resolve(records);
    paymentReads[index].resolve(payments);
    await flush();
  };
  return { context, render, counts, settle, treatmentReads, paymentReads, patientReads };
}


// Cleanup runs on navigation so future cancellation regressions fail.
describe('App MLS navigation runtime regression', () => {
  it('leaves preparing with a retryable error when a read never settles', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.render('material-cost');
      h.treatmentReads[0].resolve(records);
      await flush();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.context.setMlsSyncError).toHaveBeenCalledWith(expect.stringMatching(/timed out.*retry/i));
      expect(h.context.mlsInFlightRef.current).toBeNull();
      expect(h.context.setMlsRecords).not.toHaveBeenCalled();
      expect(h.context.api.treatments.getAllRecords.mock.calls[0][1].signal.aborted).toBe(true);
      expect(h.context.api.finance.getPayments.mock.calls[0][1].signal.aborted).toBe(true);
      h.render('patients');
      h.render('material-cost');
      h.counts(1); // Failed attempts stay stopped until explicit Retry.
      h.context.setMlsSyncError(null);
      h.render('material-cost');
      h.counts(2);
      await h.settle(1);
      h.paymentReads[0].resolve([{ id: 'stale-payment' }]);
      await flush();
      expect(h.context.setMlsPayments).toHaveBeenCalledExactlyOnceWith(payments);
    } finally {
      vi.useRealTimers();
    }
  });

  it('finishes delayed financial enrichment without any navigation rerender', async () => {
    const h = harness();
    h.render('material-cost');
    const treatmentOptions = h.context.api.treatments.getAllRecords.mock.calls[0][1];
    const paymentOptions = h.context.api.finance.getPayments.mock.calls[0][1];
    treatmentOptions.onProgress(100, 100);
    paymentOptions.onProgress(100, 100);
    treatmentOptions.onRowsDownloaded();
    paymentOptions.onRowsDownloaded();
    expect(h.context.setMlsFinalizing).toHaveBeenLastCalledWith(true);
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(33);
    expect(h.context.setMlsScope).not.toHaveBeenCalled();
    treatmentOptions.onEnrichmentProgress('commission', 1, 2);
    paymentOptions.onEnrichmentProgress('commission', 1, 2);
    paymentOptions.onEnrichmentProgress('cost-audits', 2, 2);
    paymentOptions.onEnrichmentProgress('cost-items', 1, 2);
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(75);
    h.treatmentReads[0].resolve(records);
    await flush();
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(83);
    expect(h.context.setMlsRecords).not.toHaveBeenCalled();
    h.paymentReads[0].resolve(payments);
    await flush();
    expect(h.context.setMlsScope).toHaveBeenCalledExactlyOnceWith('branch-a');
    expect(h.context.setMlsFinalizing).toHaveBeenLastCalledWith(false);
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(100);
    h.counts(1);
  });

  it('allows a slow progressing MLS sync beyond the old one-minute total deadline', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.render('material-cost');
      const treatmentOptions = h.context.api.treatments.getAllRecords.mock.calls[0][1];
      const paymentOptions = h.context.api.finance.getPayments.mock.calls[0][1];
      expect(paymentOptions.signal).toBe(treatmentOptions.signal);
      for (let page = 1; page <= 4; page++) {
        await vi.advanceTimersByTimeAsync(70_000);
        treatmentOptions.onProgress(page * 1000, 4000);
        paymentOptions.onProgress(page * 1000, 4000);
        expect(h.context.setMlsSyncError).not.toHaveBeenCalled();
      }
      treatmentOptions.onRowsDownloaded();
      paymentOptions.onRowsDownloaded();
      for (let batch = 1; batch <= 3; batch++) {
        await vi.advanceTimersByTimeAsync(70_000);
        treatmentOptions.onEnrichmentProgress('commission', batch, 3);
        paymentOptions.onEnrichmentProgress('cost-items', batch, 3);
      }
      expect(h.context.setMlsSyncError).not.toHaveBeenCalled();
      expect(treatmentOptions.signal.aborted).toBe(false);
      await h.settle();
      expect(h.context.setMlsScope).toHaveBeenCalledExactlyOnceWith('branch-a');
      expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(100);
      expect(vi.getTimerCount()).toBe(0);
      h.counts(1);
    } finally { vi.useRealTimers(); }
  });

  it('stops two minutes after the last progress, not two minutes after startup', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.render('material-cost');
      await vi.advanceTimersByTimeAsync(100_000);
      const options = h.context.api.finance.getPayments.mock.calls[0][1];
      options.onProgress(1000, 2000);
      await vi.advanceTimersByTimeAsync(119_999);
      expect(h.context.setMlsSyncError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(h.context.setMlsSyncError).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/without progress/));
      expect(options.signal.aborted).toBe(true);
      await h.settle();
      expect(h.context.setMlsRecords).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('fails promptly and aborts the other read instead of waiting for a hung sibling', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      h.render('material-cost');
      h.treatmentReads[0].reject(new Error('Treatment download failed'));
      await flush();
      expect(h.context.setMlsSyncError).toHaveBeenCalledExactlyOnceWith('Treatment download failed');
      expect(h.context.api.finance.getPayments.mock.calls[0][1].signal.aborted).toBe(true);
      expect(h.context.mlsInFlightRef.current).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      h.paymentReads[0].resolve(payments);
      await flush();
      expect(h.context.setMlsPayments).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('does not restart failed MLS on focus or online events', () => {
    const visibilityStart = app.lastIndexOf('  useEffect(() => {', app.indexOf('const refreshVisibleReads ='));
    const visibilityEnd = app.indexOf('  const loadDirectoryHistory =', visibilityStart);
    const h = harness(compile(app.slice(visibilityStart, visibilityEnd)));
    const handlers: Record<string, () => void> = {};
    const events = { addEventListener: vi.fn((event: string, callback: () => void) => { handlers[event] = callback; }),
      removeEventListener: vi.fn() };
    h.context.document = { ...events, visibilityState: 'visible' };
    h.context.window = events;
    h.context.mlsSyncError = 'Connection timed out';
    h.context.lazyViewError = null;
    h.context.appointmentPageError = null;
    h.render('material-cost');
    for (let i = 0; i < 5; i++) {
      handlers.visibilitychange();
      handlers.online();
    }
    expect(h.context.setMlsSyncError).not.toHaveBeenCalled();
    expect(h.context.mlsSyncError).toBe('Connection timed out');
    h.counts(0);
  });
  it('deduplicates pending visits, completes away, and reuses ready data', async () => {
    const h = harness();
    h.render('patients');
    h.counts(0);
    h.render('material-cost');
    h.counts(1);
    expect(h.context.api.treatments.getAllRecords).toHaveBeenCalledWith('branch-a', {
      limit: null, throwOnError: true, onProgress: expect.any(Function),
      signal: expect.any(AbortSignal),
      countMode: 'exact', onEnrichmentProgress: expect.any(Function),
      commissionRequestConcurrency: 3,
      onRowsDownloaded: expect.any(Function),
    });
    expect(h.context.api.finance.getPayments).toHaveBeenCalledWith('branch-a', {
      signal: expect.any(AbortSignal),
      countMode: 'exact', includeCorrections: false, onEnrichmentProgress: expect.any(Function),
      commissionRequestConcurrency: 3,
      onProgress: expect.any(Function),
      onRowsDownloaded: expect.any(Function),
    });
    h.render('patients');
    h.render('material-cost');
    h.counts(1);
    h.render('patients');
    h.treatmentReads[0].resolve(records);
    await flush();
    expect(h.context.setMlsRecords).not.toHaveBeenCalled();
    expect(h.context.setMlsPayments).not.toHaveBeenCalled();
    expect(h.context.setMlsScope).not.toHaveBeenCalled();
    h.paymentReads[0].resolve(payments);
    await flush();
    expect(h.context.setMlsRecords).toHaveBeenCalledExactlyOnceWith(records);
    expect(h.context.setMlsPayments).toHaveBeenCalledExactlyOnceWith(payments);
    expect(h.context.mergeLegacyPaymentRecords).toHaveBeenCalledExactlyOnceWith(payments, 'branch-a');
    expect(h.context.setMlsScope).toHaveBeenCalledExactlyOnceWith('branch-a');
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(100);
    expect(h.context.mlsInFlightRef.current).toBeNull();
    h.render('material-cost');
    h.counts(1);
  });

  it.each(['treatment', 'payment'])('does not retry a %s failure until error is cleared', async (failed) => {
    const h = harness();
    h.render('material-cost');
    h.render('patients');
    if (failed === 'treatment') {
      h.treatmentReads[0].reject(new Error('read failed'));
      h.paymentReads[0].resolve(payments);
    } else {
      h.treatmentReads[0].resolve(records);
      h.paymentReads[0].reject(new Error('read failed'));
    }
    await flush();
    expect(h.context.setMlsSyncError).toHaveBeenCalledExactlyOnceWith('read failed');
    expect(h.context.setMlsRecords).not.toHaveBeenCalled();
    expect(h.context.setMlsPayments).not.toHaveBeenCalled();
    expect(h.context.setMlsScope).not.toHaveBeenCalled();
    expect(h.context.mlsInFlightRef.current).toBeNull();
    h.render('material-cost');
    h.render('patients');
    h.render('material-cost');
    h.counts(1);
    h.context.setMlsSyncError(null);
    h.render('material-cost');
    h.counts(2);
    await h.settle(1);
    expect(h.context.setMlsScope).toHaveBeenCalledExactlyOnceWith('branch-a');
    expect(h.context.setMlsRecords).toHaveBeenCalledExactlyOnceWith(records);
  });

  it.each(['cache version', 'session', 'branch', 'authentication'])('ignores stale progress and results after %s changes', async (change) => {
    const h = harness();
    h.render('material-cost');
    const treatmentProgress = h.context.api.treatments.getAllRecords.mock.calls[0][1].onProgress;
    const paymentProgress = h.context.api.finance.getPayments.mock.calls[0][1].onProgress;
    const financialProgress = h.context.api.finance.getPayments.mock.calls[0][1].onEnrichmentProgress;
    treatmentProgress(1, 10);
    expect(h.context.setMlsSyncProgress).toHaveBeenLastCalledWith(1);
    if (change === 'cache version') h.context.mlsCacheVersionRef.current++;
    if (change === 'session') h.context.initialDataFetchRequestRef.current++;
    if (change === 'branch') {
      h.context.currentLocationId = 'branch-b';
      h.context.startupScope = 'branch-b';
      h.context.currentLocationIdRef.current = 'branch-b';
    }
    if (change === 'authentication') {
      h.context.isAuthenticated = false;
      h.context.mlsAuthenticatedRef.current = false;
    }
    h.render('patients');
    h.context.setMlsSyncProgress.mockClear();
    treatmentProgress(10, 10);
    paymentProgress(10, 10);
    financialProgress('commission', 1, 1);
    financialProgress('cost-items', 1, 1);
    await h.settle();
    expect(h.context.setMlsSyncProgress).not.toHaveBeenCalled();
    expect(h.context.setMlsRecords).not.toHaveBeenCalled();
    expect(h.context.setMlsPayments).not.toHaveBeenCalled();
    expect(h.context.setMlsScope).not.toHaveBeenCalled();
    expect(h.context.setMlsSyncError).not.toHaveBeenCalled();
    expect(h.context.mlsInFlightRef.current).toBeNull();
  });

  it.each(['cache version', 'session', 'branch'])('old completion cannot clear a replacement %s flight', async (change) => {
    const h = harness();
    h.render('material-cost');
    if (change === 'cache version') h.context.mlsCacheVersionRef.current++;
    if (change === 'session') h.context.initialDataFetchRequestRef.current++;
    if (change === 'branch') {
      h.context.currentLocationId = 'branch-b';
      h.context.startupScope = 'branch-b';
      h.context.currentLocationIdRef.current = 'branch-b';
    }
    const oldSignal = h.context.api.finance.getPayments.mock.calls[0][1].signal;
    h.render('material-cost');
    h.counts(2);
    expect(oldSignal.aborted).toBe(true);
    const replacement = h.context.mlsInFlightRef.current;
    await h.settle(0);
    expect(h.context.mlsInFlightRef.current).toBe(replacement);
    expect(h.context.setMlsRecords).not.toHaveBeenCalled();
    expect(h.context.setMlsPayments).not.toHaveBeenCalled();
    expect(h.context.setMlsScope).not.toHaveBeenCalled();
    h.render('patients');
    h.render('material-cost');
    h.counts(2);
    await h.settle(1);
    expect(h.context.setMlsRecords).toHaveBeenCalledExactlyOnceWith(records);
    expect(h.context.setMlsPayments).toHaveBeenCalledExactlyOnceWith(payments);
    expect(h.context.setMlsScope).toHaveBeenCalledExactlyOnceWith(change === 'branch' ? 'branch-b' : 'branch-a');
    expect(h.context.mlsInFlightRef.current).toBeNull();
  });
});


describe('App Patients lazy effect runtime regression', () => {
  it('reuses the cached patient page across visits and preserves edits and full history', async () => {
    const h = harness(lazyCode);
    h.render('patients');
    expect(h.context.api.patients.getPage).toHaveBeenCalledExactlyOnceWith('branch-a', 0, 50);
    h.patientReads[0].resolve([{ id: 'existing', name: 'Updated' }, { id: 'new' }]);
    await flush();
    expect(h.context.patients).toEqual([{ id: 'existing', name: 'Updated' }, { id: 'new' }]);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('branch-a:patients');
    expect(h.context.setHistoryScope).not.toHaveBeenCalled();
    h.context.patients[0] = { id: 'existing', name: 'Local edit' };
    h.context.patients.push({ id: 'later-page' });
    h.render('material-cost');
    h.counts(0); // The generic MLS branch must not own financial reads.
    h.render('patients');
    expect(h.context.api.patients.getPage).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.context.patients).toEqual([{ id: 'existing', name: 'Local edit' }, { id: 'new' }, { id: 'later-page' }]);
    expect(h.context.setPatients).toHaveBeenCalledTimes(2);
    expect(h.context.setHistoryScope).not.toHaveBeenCalled();
    expect(h.context.historyScope).toBe('branch-a');
    expect(h.context.setLazyViewError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it('uses a fresh patient revision rather than letting previous rows win', async () => {
    const h = harness(lazyCode);
    h.render('patients');
    h.patientReads[0].resolve([{ id: 'existing', name: 'Updated' }, { id: 'new' }]);
    await flush();
    h.context.patients.push({ id: 'later-page' });
    h.context.lazyViewRevision++;
    h.render('patients');
    expect(h.context.api.patients.getPage).toHaveBeenCalledTimes(2);
    h.patientReads[1].resolve([{ id: 'existing', name: 'Fresh revision' }]);
    await flush();
    expect(h.context.patients).toEqual([
      { id: 'existing', name: 'Fresh revision' }, { id: 'new' }, { id: 'later-page' },
    ]);
    expect(h.context.historyScope).toBe('branch-a');
    expect(h.context.setHistoryScope).not.toHaveBeenCalled();
  });

  it('ignores a patient page completed after navigation without touching history', async () => {
    const h = harness(lazyCode);
    h.render('patients');
    h.render('material-cost');
    h.patientReads[0].resolve([{ id: 'stale' }]);
    await flush();
    expect(h.context.setPatients).not.toHaveBeenCalled();
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('branch-a:material-cost');
    expect(h.context.setHistoryScope).not.toHaveBeenCalled();
    expect(h.context.historyScope).toBe('branch-a');
  });
});


const bundles = [
  { view: 'expenses', reads: ['expenses.getAll', 'medicines.getSales', 'treatments.getAllRecords'], setters: ['setExpenses', 'setMedicineSales', 'setGlobalRecords'] },
  { view: 'inventory', reads: ['medicines.getAll', 'medicines.getTopSelling'], setters: ['setMedicines', 'setTopSellingMedicines'] },
  { view: 'doctors', reads: ['doctors.getAll'], setters: ['setDoctors'] },
  { view: 'users', reads: ['users.getAll'], setters: ['setUsers'] },
  { view: 'dashboard', reads: ['patients.getAll', 'appointments.getAll', 'treatments.getAllRecords', 'expenses.getAll', 'finance.getPayments'], setters: ['setDashboardPatients', 'setDashboardAppointments', 'setDashboardRecords', 'setDashboardExpenses', 'setDashboardPayments'] },
  { view: 'ai-assistant', reads: ['patients.getAll', 'appointments.getAll', 'doctors.getAll', 'treatments.getTypes', 'treatments.getAllRecords', 'medicines.getAll', 'expenses.getAll', 'medicines.getSales', 'finance.getPayments'], setters: ['setAssistantPatients', 'setAssistantAppointments', 'setAssistantDoctors', 'setAssistantTreatmentTypes', 'setAssistantRecords', 'setAssistantMedicines', 'setAssistantExpenses', 'setAssistantMedicineSales', 'setAssistantPaymentRecords'] },
];
describe('Assistant parallel module/data startup runtime', () => {
  it('starts the module while data remains unresolved and publishes no incomplete data', () => {
    const h = bundleHarness(bundles.find((bundle) => bundle.view === 'ai-assistant')!);
    h.render('ai-assistant');
    expect(h.context.loadAIAssistantView).toHaveBeenCalledTimes(1);
    h.reads.forEach(({ mock }) => expect(mock).toHaveBeenCalledTimes(1));
    expect(h.context.setAssistantPatients).not.toHaveBeenCalled();
    expect(h.context.setLoadedLazyView).not.toHaveBeenCalledWith('branch-a:ai-assistant');
  });
});
// Actual App effect and real cache, with deferred API bundles.
function bundleHarness(bundle: typeof bundles[number]) {
  const h = harness(lazyCode);
  const reads = bundle.reads.map((path) => {
    const pending: ReturnType<typeof deferred<any[]>>[] = [];
    const mock = vi.fn(() => {
      const read = deferred<any[]>();
      pending.push(read);
      return read.promise;
    });
    const [domain, method] = path.split('.');
    h.context.api[domain] ||= {};
    h.context.api[domain][method] = mock;
    return { pending, mock };
  });
  for (const setter of [...bundle.setters, 'setGlobalRecordsReady', 'setMedicinesReady', 'setDashboardLocationId', 'setDashboardLoading']) h.context[setter] = vi.fn();
  const rows = bundle.reads.map(path => [{ id: path }]);
  const counts = (n: number) => reads.forEach(read => expect(read.mock).toHaveBeenCalledTimes(n));
  const published = (n: number) => bundle.setters.forEach((setter, i) => {
    expect(h.context[setter]).toHaveBeenCalledTimes(n);
    if (n) expect(h.context[setter]).toHaveBeenLastCalledWith(rows[i]);
  });
  const settle = async (flight = 0) => {
    reads.forEach((read, i) => read.pending[flight].resolve(rows[i]));
    await flush();
  };
  return { ...h, reads, rows, counts, published, settle };
}

describe.each(bundles)('App generic $view navigation cache runtime', (bundle) => {
  it.each(['branch', 'version', 'revision', 'session', 'permission'])('isolates %s changes from old flights', async (change) => {
    const h = bundleHarness(bundle);
    h.render(bundle.view);
    if (change === 'branch') {
      h.context.currentLocationId = h.context.startupScope = h.context.currentLocationIdRef.current = 'branch-b';
      h.context.dashboardLocationId = 'branch-b';
    }
    if (change === 'version') {
      h.context.navigationCacheVersionRef.current++;
      dataCache.invalidatePrefix('navigation:');
    }
    if (change === 'revision') h.context.lazyViewRevision++;
    if (change === 'session') h.context.initialDataFetchRequestRef.current++;
    if (change === 'permission') h.context.allowedViews = [...h.context.allowedViews, 'doctors'];
    h.render(bundle.view);
    h.counts(2);
    await h.settle(0);
    h.published(0);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('');
    h.render('material-cost');
    h.render(bundle.view);
    h.counts(2); // Old completion cannot clear the replacement flight.
    await h.settle(1);
    h.published(1);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith(`${h.context.currentLocationId}:${bundle.view}`);
    h.render('material-cost');
    h.render(bundle.view);
    await flush();
    h.counts(2);
    h.published(2);
  });
  it('reuses ready data on re-entry', async () => {
    const h = bundleHarness(bundle);
    h.render(bundle.view);
    h.counts(1);
    await h.settle();
    h.published(1);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith(`branch-a:${bundle.view}`);
    h.render('material-cost');
    h.render(bundle.view);
    await flush();
    h.counts(1);
    h.published(2);
    expect(h.context.setLazyViewError).not.toHaveBeenCalledWith(expect.any(String));
  });
  it('shares in-flight reads after navigation and never publishes partial data', async () => {
    const h = bundleHarness(bundle);
    h.render(bundle.view);
    h.render('material-cost');
    h.render(bundle.view);
    h.counts(1);
    h.reads[0].pending[0].resolve(h.rows[0]);
    await flush();
    if (h.reads.length > 1) {
      h.published(0);
      expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('');
    }
    await h.settle();
    h.published(1);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith(`branch-a:${bundle.view}`);
  });
  it('caches completion away without publishing until re-entry', async () => {
    const h = bundleHarness(bundle);
    h.render(bundle.view);
    h.render('material-cost');
    await h.settle();
    h.published(0);
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('branch-a:material-cost');
    h.render(bundle.view);
    await flush();
    h.counts(1);
    h.published(1);
  });
  it('does not store failed or partial bundles and retries every read', async () => {
    const h = bundleHarness(bundle);
    h.render(bundle.view);
    h.reads[0].pending[0].reject(new Error('bundle failed'));
    await flush();
    h.published(0);
    expect(h.context.setLazyViewError).toHaveBeenLastCalledWith('bundle failed');
    expect(h.context.setLoadedLazyView).toHaveBeenLastCalledWith('');
    h.reads.slice(1).forEach((read, i) => read.pending[0].resolve(h.rows[i + 1]));
    await flush();
    h.render('material-cost');
    h.render(bundle.view);
    h.counts(2);
    await h.settle(1);
    h.published(1);
    h.render('material-cost');
    h.render(bundle.view);
    await flush();
    h.counts(2);
    h.published(2);
  });
});
