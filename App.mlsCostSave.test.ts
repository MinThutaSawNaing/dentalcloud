import { readFileSync } from 'node:fs';
import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

describe('MLS save targeted refresh regression', () => {
  it('invalidates MLS pages by default while retaining the explicit preserve option', () => {
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

  it.each(['patient-a', null, undefined])('invalidates the filtered page after saving costs for %s without history reads', async (patientId) => {
    const start = source.indexOf('  const refreshMlsAfterCostSave =');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf('  const handlePaymentCorrected =', start);
    expect(end).toBeGreaterThan(start);
    const code = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022 } }).outputText;
    const context = {
      currentLocationId: 'branch-a', invalidateMaterialCostCaches: vi.fn(),
      api: { treatments: { getAllRecords: vi.fn() }, finance: { getPayments: vi.fn() } },
      refreshGlobalRecordsForPatient: vi.fn(),
    };
    const run = new Function(...Object.keys(context), `${code}\nreturn refreshMlsAfterCostSave;`)(...Object.values(context));
    await run(patientId);
    expect(context.invalidateMaterialCostCaches).toHaveBeenCalledExactlyOnceWith('branch-a');
    expect(context.api.treatments.getAllRecords).not.toHaveBeenCalled();
    expect(context.api.finance.getPayments).not.toHaveBeenCalled();
    expect(context.refreshGlobalRecordsForPatient).not.toHaveBeenCalled();
  });
});
