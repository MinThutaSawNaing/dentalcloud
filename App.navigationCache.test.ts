import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const settings = readFileSync(fileURLToPath(new URL('./components/SettingsView.tsx', import.meta.url)), 'utf8');
describe('tab navigation cache integration guards', () => {
  it('keys appointment pages by scope, session, filters, permissions and explicit refresh', () => {
    const source = app.slice(app.indexOf('const loadAppointmentPage ='), app.indexOf('const loadAuditLog ='));
    expect(source).toContain('appointment-page:${getClinicCacheScope(locationId)}:${startupRequestId}:${cacheVersion}:${appointmentPageRefreshKey}');
    expect(source).toContain('JSON.stringify([date, query.page, query.search, doctorIds, query.treatment, session?.role, session?.doctor_id])');
    expect(source).toContain('dataCache.getOrLoad(pageKey');
    expect(source).toContain('}), Infinity)');
    expect(source).toContain('cacheVersion !== navigationCacheVersionRef.current');
    expect(source).toContain('currentLocationIdRef.current !== locationId');
  });
  it('retains Records range bundles until explicit invalidation', () => {
    const source = app.slice(app.indexOf('const loadAuditLog ='), app.indexOf('const fetchInitialData ='));
    expect(source).toContain('}, Infinity)');
    expect(source).toContain('if (force) dataCache.invalidate(auditKey)');
  });
  it('only retries failed visible reads rather than invalidating successful datasets', () => {
    const source = app.slice(app.indexOf('const refreshVisibleReads ='), app.indexOf('const fetchMedicines ='));
    expect(source).toContain("currentView === 'appointments' && appointmentPageError");
    expect(source).toContain('if (lazyViewError) setLazyViewRevision');
    expect(source).toContain('if (mlsSyncError) setMlsSyncError(null)');
  });
  it('keeps storage configuration in session-scoped memory and invalidates after save', () => {
    expect(settings).toContain('JSON.stringify([session?.userId, session?.role, session?.location_id])');
    expect(settings).toContain('dataCache.getOrLoad(`view-settings:${scope}:s3`');
    expect(settings).toContain('dataCache.getOrLoad(`view-settings:${scope}:storage`');
    expect(settings).toMatch(/await api.appSettings.saveSupabaseStorage\(nextSettings\);\s*dataCache.invalidatePrefix\('view-settings:'\)/);
    expect(settings).toMatch(/await api.appSettings.saveS3Settings\(nextSettings\);\s*dataCache.invalidatePrefix\('view-settings:'\)/);
    expect(settings).toContain('if (isCurrent())');
  });
});