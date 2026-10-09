import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('MLS save targeted refresh regression', () => {
  it('preserves the ready MLS cache on a save but still invalidates it for explicit full refresh', () => {
    const start = source.indexOf('  const invalidateMaterialCostCaches =');
    const end = source.indexOf('  // -- Selection State --', start);
    const code = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const invalidateMlsMemory = vi.fn();
    const invalidateNavigationCache = vi.fn();
    const context = {
      currentLocationId: 'branch-a', invalidateMlsMemory, invalidateNavigationCache,
      getClinicCacheScope: () => 'staff:branch-a', getClinicCacheKey: (domain: string) => domain,
      dataCache: { invalidate: vi.fn(), invalidatePrefix: vi.fn() }, setMaterialCostCacheRevision: vi.fn(),
    };
    const run = new Function(...Object.keys(context), `${code}\nreturn invalidateMaterialCostCaches;`)(...Object.values(context));
    run('branch-a', true);
    expect(invalidateMlsMemory).not.toHaveBeenCalled();
    expect(invalidateNavigationCache).toHaveBeenCalledTimes(1);
    run('branch-a');
    expect(invalidateMlsMemory).toHaveBeenCalledTimes(1);
  });

  it('uses a targeted save handler rather than invalidating all MLS history', () => {
    const start = source.indexOf('<MaterialCostView');
    const props = source.slice(start, source.indexOf("{currentView === 'records'", start));
    expect(props.includes('onCostsSaved={refreshMlsAfterCostSave}')).toBe(true);
    expect(props.includes('void fetchDashboardData')).toBe(false);
  });

  it.each(['success', 'failure', 'branch', 'session', 'invalidation', 'repeat'])(
    'refreshes only the patient with safe publication: %s', async (scenario) => {
    const start = source.indexOf('  const refreshMlsAfterCostSave =');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('  const handlePaymentCorrected =', start);
    const code = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    let records: any[] = [{ id: 'old', patient_id: 'patient-a' }, { id: 'other', patient_id: 'patient-b' }];
    let payments: any[] = [{ id: 'old-pay', patientId: 'patient-a', date: '2026-10-01' }, { id: 'other-pay', patientId: 'patient-b', date: '2026-10-01' }];
    const session = { userId: 'staff', role: 'admin' };
    const context: Record<string, any> = {
      leanStaffStartup: true, currentLocationId: 'branch-a', mlsScope: 'branch-a',
      currentLocationIdRef: { current: 'branch-a' }, mlsAuthenticatedRef: { current: true },
      mlsCacheVersionRef: { current: 1 }, initialDataFetchRequestRef: { current: 1 },
      mlsPatientRefreshRequestRef: { current: 0 },
      auth: { getSession: () => session }, isSameAuthSession: (a: any, b: any) => a === b,
      getClinicCacheScope: () => 'staff:branch-a',
      invalidateMaterialCostCaches: vi.fn(), refreshGlobalRecordsForPatient: vi.fn(),
      api: {
        treatments: { getAllRecords: vi.fn().mockResolvedValue([{ id: 'fresh', patient_id: 'patient-a', date: '2026-10-09' }]) },
        finance: { getPayments: vi.fn().mockResolvedValue([{ id: 'fresh-pay', patientId: 'patient-a', date: '2026-10-09' }]) },
      },
      mergeLegacyPaymentRecords: (rows: any[]) => rows,
      setMlsRecords: vi.fn((update) => { records = update(records); }),
      setMlsPayments: vi.fn((update) => { payments = update(payments); }),
      setMlsSyncError: vi.fn(),
    };
    let resolveRecords!: (rows: any[]) => void;
    if (scenario !== 'success' && scenario !== 'repeat' && scenario !== 'failure') {
      context.api.treatments.getAllRecords.mockImplementationOnce(() => new Promise((resolve) => { resolveRecords = resolve; }));
    }
    if (scenario === 'failure') context.api.finance.getPayments.mockRejectedValueOnce(new Error('offline'));
    const run = new Function(...Object.keys(context), `${code}\nreturn refreshMlsAfterCostSave;`)(...Object.values(context));
    const refresh = run('patient-a');
    if (scenario === 'branch') context.currentLocationIdRef.current = 'branch-b';
    if (scenario === 'session') context.auth.getSession = () => null;
    if (scenario === 'invalidation') context.mlsCacheVersionRef.current++;
    if (resolveRecords) resolveRecords([{ id: 'stale', patient_id: 'patient-a' }]);
    if (scenario === 'failure') {
      await expect(refresh).rejects.toThrow('offline');
      expect(context.setMlsSyncError).toHaveBeenCalledTimes(1);
    } else await refresh;
    expect(context.invalidateMaterialCostCaches).toHaveBeenCalledWith('branch-a', true);
    expect(context.api.treatments.getAllRecords).toHaveBeenCalledWith('branch-a', expect.objectContaining({ patientId: 'patient-a', limit: null, throwOnError: true }));
    expect(context.api.finance.getPayments).toHaveBeenCalledWith('branch-a', expect.objectContaining({ patientId: 'patient-a', includeCorrections: false }));
    if (scenario === 'success' || scenario === 'repeat') {
      if (scenario === 'repeat') await run('patient-a');
      expect(records.map((row) => row.id).sort()).toEqual(['fresh', 'other']);
      expect(payments.map((row) => row.id).sort()).toEqual(['fresh-pay', 'other-pay']);
    } else {
      expect(context.setMlsRecords).not.toHaveBeenCalled();
      expect(context.setMlsPayments).not.toHaveBeenCalled();
    }
    expect(context.refreshGlobalRecordsForPatient).not.toHaveBeenCalled();
  });
});