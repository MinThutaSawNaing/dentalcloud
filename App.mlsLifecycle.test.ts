import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const section = (start: string, end: string) => {
  const from = app.indexOf(start);
  expect(from, `Missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = app.indexOf(end, from + start.length);
  expect(to, `Missing anchor: ${end}`).toBeGreaterThan(from);
  return app.slice(from, to);
};

// Source guards only: no React mount, network requests, or database access.
describe('MLS branch/session lifecycle source guards', () => {
  const loader = () => section('// MLS reads are owned by the branch/session', '// Fetch only the selected screen');

  it('starts on MLS visit once ready and deduplicates the scope/session/version flight', () => {
    const source = loader();
    expect(source).toContain("currentView !== 'material-cost'");
    expect(source).toContain('startupScope !== currentLocationId || initialSyncActive');
    expect(source).toContain('!isAuthenticated');
    expect(source).toContain('existing?.scope === scope');
    expect(source).toContain('existing.startupRequestId === startupRequestId');
    expect(source).toContain('existing.cacheVersion === cacheVersion');
    expect(source).not.toContain('return () =>');
    expect(source).not.toContain('cancelled');
    expect(source).not.toContain('lazyViewRequestRef');
  });

  it('guards progress and completion against auth, branch, session, and invalidation changes', () => {
    const source = loader();
    expect(source).toContain('mlsAuthenticatedRef.current && currentLocationIdRef.current === scope');
    expect(source).toContain('initialDataFetchRequestRef.current === startupRequestId');
    expect(source).toContain('mlsCacheVersionRef.current === cacheVersion');
    expect(source).toContain('if (!isCurrent()) return;');
    expect(source).toContain('if (isCurrent()) {');
    expect(source).toContain('if (mlsInFlightRef.current === flight) mlsInFlightRef.current = null');
  });

  it('publishes only after both complete reads succeed and caps intermediate progress', () => {
    const source = loader();
    expect(source).toContain('Promise.allSettled');
    expect(source).toContain('await Promise.race');
    expect(source).toContain('clearTimeout(timeout)');
    expect(source).toContain('Math.min(99, percentage)');
    const publication = source.indexOf('setMlsRecords(records.value)');
    expect(source.indexOf("if (records.status === 'rejected') throw records.reason")).toBeLessThan(publication);
    expect(source.indexOf("if (payments.status === 'rejected') throw payments.reason")).toBeLessThan(publication);
    expect(source.indexOf('const mergedPayments =')).toBeLessThan(publication);
    expect(source).toContain('setMlsScope(scope)');
    expect(source).not.toContain('setGlobalRecords(');
  });

  it('makes the generic lazy MLS branch readiness-only', () => {
    const lazy = section('// Fetch only the selected screen', 'const refreshVisibleReads =');
    expect(lazy).toMatch(/if \(view === 'material-cost'\) \{\s*setLoadedLazyView\(key\);\s*return;\s*}/);
    expect(lazy).not.toContain('setMlsRecords');
    const mlsBranch = section("if (view === 'material-cost')", 'const requestId = ++lazyViewRequestRef.current;');
    expect(mlsBranch).not.toContain('api.');
    expect(mlsBranch).not.toContain('getPayments');
    expect(mlsBranch).not.toContain('cached(');
  });

  it('retains a separate error across navigation and clears it on retry/session reset', () => {
    expect(loader()).toContain('|| mlsSyncError) return;');
    expect(loader()).toContain('if (isCurrent()) setMlsSyncError(');
    const component = section("{currentView === 'material-cost' &&", "{currentView === 'records' &&");
    expect(component).toContain('loadError={leanStaffStartup ? mlsSyncError : null}');
    expect(component).toContain('mlsScope !== currentLocationId && !mlsSyncError');
    expect(component.match(/setMlsSyncError\(null\)/g)).toHaveLength(2);
    expect(section('const resetStaffSession =', 'const canAccessView =')).toContain('setMlsSyncError(null)');
    expect(section('const fetchInitialData =', 'const advanceInitialSync =')).toContain('++initialDataFetchRequestRef.current');
    expect(app).toMatch(/invalidateMlsMemory\(\);\s*setMlsSyncError\(null\);\s*setMlsSyncProgress\(null\);\s*setMlsRecords\(\[\]\)/);
  });
});
