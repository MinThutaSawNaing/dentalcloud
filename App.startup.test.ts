import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const staffStartup = readFileSync(fileURLToPath(new URL('./services/staffStartup.ts', import.meta.url)), 'utf8');

// Structural regression guards only: these do not mount React or prove runtime UI behavior.
// Assert anchors exist before slicing so missing/renamed code cannot silently pass.
const section = (source: string, start: string, end: string) => {
  const from = source.indexOf(start);
  expect(from, `Missing start anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `Missing end anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
};

 describe('App startup structural source guards (not runtime UI tests)', () => {
  it('returns from lean startup before the legacy supportingTasks path', () => {
    const lean = section(app,
      "if (import.meta.env.VITE_LEAN_STAFF_STARTUP !== 'false' && session?.role !== 'doctor') {",
      'const sessionDoctorId =');
    expect(lean).toContain('await loadStaffStartup(api, locId)');
    expect(lean).toContain('setStartupScope(locId)');
    expect(lean).toMatch(/return;\s*}\s*\/\/[^\n]*\n\s*$/);
    const legacy = section(app, 'const sessionDoctorId =', 'const supportingTasks =');
    expect(legacy).toContain("session?.role === 'doctor'");
  });

  it('keeps doctors out of both lean startup conditions and permits the opt-out', () => {
    expect(app).toContain("const leanStaffStartup = import.meta.env.VITE_LEAN_STAFF_STARTUP !== 'false' && !isDoctor;");
    expect(app).toContain("if (import.meta.env.VITE_LEAN_STAFF_STARTUP !== 'false' && session?.role !== 'doctor') {");
  });

  it('restricts staffStartup reads to the five lightweight datasets, not heavy histories', () => {
    const reads = [...staffStartup.matchAll(/source\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`);
    expect(reads).toEqual([
      'patients.getPage', 'appointments.getAll', 'doctors.getAll', 'treatments.getTypes', 'loyalty.getRules'
    ]);
    expect(staffStartup).toContain('source.patients.getPage(locationId, 0, 100)');
    expect(staffStartup).not.toMatch(/getAllRecords|getPayments|getSales|getTransactions|source\.expenses|source\.messages|source\.appointmentRescheduleLogs/);
  });

  it('gates lazy reads by authentication, branch readiness, sync and permission; preserves errors and stale-request guards', () => {
    const lazy = section(app, 'if (!leanStaffStartup || !isAuthenticated || !currentLocationId', 'const refreshVisibleReads =');
    expect(lazy).toContain('startupScope !== currentLocationId || initialSyncActive) return;');
    expect(lazy).toContain("if (!canAccessView(currentView) && currentView !== 'finance') return;");
    expect(lazy).toContain("setLoadedLazyView('')");
    expect(lazy).toContain('throwOnError: true');
    expect(lazy).toContain('if (!isCurrent()) return;');
    expect(lazy).toContain('if (!cancelled && requestId === lazyViewRequestRef.current && isCurrent()) setLoadedLazyView(key);');
    expect(lazy).toMatch(/void load\(\)\.catch\(\(err: any\) => {\s*if \(!cancelled && requestId === lazyViewRequestRef.current && isCurrent\(\)\) {\s*setLazyViewError/);
    expect(lazy).toContain('return () => { cancelled = true; };');
  });

  it('scopes navigation keys and publication to clinic, session, permission, revision and cache version', () => {
    const lazy = section(app, 'const requestId = ++lazyViewRequestRef.current;', 'const cached = <T,>');
    expect(lazy).toContain('const startupRequestId = initialDataFetchRequestRef.current;');
    expect(lazy).toContain('const cacheVersion = navigationCacheVersionRef.current;');
    expect(lazy).toContain('const clinicScope = getClinicCacheScope(scope);');
    expect(lazy).toMatch(/const permissionKey = JSON.stringify\(\[session\?\.role, session\?\.doctor_id,\s*session\?\.location_id, \[\.\.\.allowedViews\].sort\(\)\]\);/);
    expect(lazy).toContain('const restrictedScope = getSessionRestrictedLocationId(session);');
    expect(lazy).toContain('const cacheKey = `navigation:${clinicScope}:${startupRequestId}:${cacheVersion}:${view}:${JSON.stringify([');
    expect(lazy).toContain("view === 'dashboard' ? dashboardLocationId : ''");
    expect(lazy).toContain("view === 'dashboard' ? effectiveDashboardScope : restrictedScope || scope");
    expect(lazy).toContain('permissionKey, lazyViewRevision');
    const current = section(lazy, 'const isCurrent =', '=== permissionKey;');
    for (const guard of [
      '!cancelled && requestId === lazyViewRequestRef.current',
      'startupRequestId === initialDataFetchRequestRef.current',
      'cacheVersion === navigationCacheVersionRef.current',
      'currentLocationIdRef.current === scope',
      'getClinicCacheScope(scope) === clinicScope'
    ]) expect(current).toContain(guard);
    expect(current).toMatch(/JSON.stringify\(\[auth.getSession\(\)\?\.role, auth.getSession\(\)\?\.doctor_id,\s*auth.getSession\(\)\?\.location_id, \[\.\.\.allowedViews\].sort\(\)\]\)/);
  });

  it('retains complete navigation bundles indefinitely and cancels publication, not cache flights', () => {
    const lazy = section(app, '// Fetch only the selected screen', 'const refreshVisibleReads =');
    expect(lazy).toContain('const cached = <T,>(loader: () => Promise<T>) => dataCache.getOrLoad(cacheKey, loader, Infinity);');
    for (const [start, end] of [
      ["if (view === 'expenses')", "} else if (view === 'inventory'"],
      ["} else if (view === 'inventory'", "} else if (view === 'dashboard')"],
      ["} else if (view === 'dashboard')", "} else if (view === 'ai-assistant')"],
      ["} else if (view === 'ai-assistant')", "} else if (view === 'users')"]
    ]) {
      const bundle = section(lazy, start, end);
      expect(bundle).toContain('await cached(() => Promise.all([');
      expect(bundle).toMatch(/\]\)\);\s*if \(!isCurrent\(\)/);
    }
    const cleanup = section(lazy, '// Cancel publication only:', '}, [currentView');
    expect(cleanup).toContain('return () => { cancelled = true; };');
    expect(lazy).not.toMatch(/AbortController|\.abort\(|dataCache\.(invalidate\w*|clear)\(/);
  });

  it('invalidates navigation bundles and versions through refresh, settings and MLS lifecycle hooks', () => {
    const invalidate = section(app, 'const invalidateNavigationCache =', 'const [mlsSyncError');
    expect(invalidate).toContain('navigationCacheVersionRef.current += 1;');
    for (const prefix of ['navigation:', 'appointment-page:', 'view-settings:']) {
      expect(invalidate).toContain(`dataCache.invalidatePrefix('${prefix}');`);
    }
    expect(invalidate).toContain("dataCache.invalidatePrefix(`${getClinicCacheKey('audit-range', currentLocationId)}:`);");
    expect(section(app, 'const invalidateMlsMemory =', 'const lazyViewRequestRef =')).toContain('invalidateNavigationCache();');
    for (const [start, end] of [
      ['const fetchMedicines =', 'const fetchExpenses ='],
      ['const fetchExpenses =', 'const fetchMedicineSales ='],
      ['const fetchMedicineSales =', 'const handlePatientSelect =']
    ]) expect(section(app, start, end)).toMatch(/if \(force\) {\s*invalidateNavigationCache\(\);/);
    expect(section(app, 'const handleSaveAppName =', 'const handleDeleteAppLogo =')).toMatch(/await api.appSettings.saveAppName\(name\);\s*invalidateNavigationCache\(\);/);
  });

  it('keeps MLS progress guarded and independent from other datasets', () => {
    const mls = section(app, '// MLS reads are owned by the branch/session', '// Fetch only the selected screen');
    expect(mls).toContain('Promise.allSettled');
    expect(mls).toContain('await Promise.race');
    expect(mls).toContain('if (!isCurrent()) return;');
    expect(mls).toContain("if (records.status === 'rejected') throw records.reason");
    expect(mls).toContain("if (payments.status === 'rejected') throw payments.reason");
    expect(mls).toContain('setMlsRecords(records.value)');
    expect(mls).toContain('setMlsPayments(mergedPayments)');
    expect(mls).toContain('setMlsSyncProgress(100)');
    expect(mls).toContain('setMlsScope(scope)');
    expect(mls).toContain('mlsCacheVersionRef.current === cacheVersion');
    expect(mls).not.toContain('setGlobalRecords(');
    expect(mls).not.toContain('setPaymentRecords(');
    const component = section(app, "{currentView === 'material-cost' &&", "{currentView === 'records' &&");
    expect(component).toContain('key={currentLocationId}');
    expect(component).toContain('loadError={leanStaffStartup ? mlsSyncError : null}');
    expect(component).toContain("setLoadedLazyView('')");
    expect(component).toContain('setLazyViewRevision((value) => value + 1)');
  });

  it('reuses complete branch MLS data before clearing lazy readiness or starting requests', () => {
    const lazy = section(app, 'const key = `${scope}:${view}`;', "if (view === 'expenses')");
    const cached = section(lazy, "if (view === 'material-cost')", 'const requestId =');
    expect(cached).toContain('setLoadedLazyView(key)');
    expect(cached).toContain('return;');
    expect(cached).not.toContain('setMlsScope');
    expect(cached).not.toContain('api.');
    const component = section(app, "{currentView === 'material-cost' &&", "{currentView === 'records' &&");
    expect(component).toContain('mlsScope !== currentLocationId && !mlsSyncError');
  });

  it('invalidates retained MLS data for session, branch, refresh and financial writes', () => {
    const reset = section(app, 'const resetStaffSession =', 'const canAccessView =');
    expect(reset).toContain('invalidateMlsMemory()');
    expect(reset).toContain('setMlsRecords([])');
    expect(reset).toContain('setMlsPayments([])');
    expect(app).toMatch(/setStartupScope\(''\);\s*setLoadedLazyView\(''\);\s*invalidateMlsMemory\(\)/);
    expect(app).toMatch(/recordedResponses.push\(res\);\s*invalidateMlsMemory\(\)/);
    expect(app).toMatch(/await api.treatments.undoRecord\(record.id\);\s*invalidateMlsMemory\(\)/);
    const payment = section(app, 'const res = await api.finance.processPayment({', 'let paymentRecord: PaymentRecord');
    expect(payment).toContain('invalidateMlsMemory()');
    expect(app).toContain('if (force) invalidateMlsMemory();');
    expect(app).toMatch(/const refreshGlobalRecordsForPatient = [^\n]+\n\s*invalidateMlsMemory\(\)/);
    expect(app).toMatch(/const invalidateMaterialCostCaches = [^\n]+\n\s*invalidateMlsMemory\(\)/);
    expect(app).toContain('leanStaffStartup, allowedViews, mlsCacheRevision, mlsScope, mlsSyncError]');
  });

  it('places screen content behind the branch/loading/error gate with a retry action', () => {
    const gate = section(app, '{leanStaffStartup && (startupScope !== currentLocationId', "{currentView === 'dashboard'");
    expect(gate).toContain("initialSyncActive || (currentView !== 'material-cost' && (lazyViewError || loadedLazyView !== `${currentLocationId}:${currentView}`))");
    expect(gate).toContain("role={lazyViewError || error ? 'alert' : 'status'}");
    expect(gate).toContain('setLazyViewRevision((value) => value + 1)');
    expect(gate).toContain('}>Retry</button>');
    expect(gate).toContain(') : <>');
  });
  it('uses patient-scoped sales and payments for the lean payment receipt', () => {
    expect(app).toContain('setPatientPaymentRecords(leanStaffStartup ? mergeLegacyPaymentRecords(payments, locationId, patient.id) : payments)');
    const receipt = section(app, 'const matchedMedicineSales = getUncapturedMedicineSalesForReceipt(', '// These reads are independent prerequisites');
    expect(receipt).toMatch(/getUncapturedMedicineSalesForReceipt\(\s*leanStaffStartup \? patientMedicineSales : medicineSales,\s*leanStaffStartup \? patientPaymentRecords : paymentRecords,\s*selectedPatient\.id,/);
  });

  it('blocks payment submission on patient loading or errors before any payment work', () => {
    const readiness = section(app, 'const patientPaymentNotReady =', 'const handleOpenPaymentModal =');
    expect(readiness).toContain('leanStaffStartup && (');
    for (const flag of ['patientProfileLoading', 'patientProfileError', 'treatmentHistoryLoading',
      'patientPaymentHistoryLoading', 'patientMedicineHistoryLoading', 'patientAppointmentsLoading',
      'patientTreatmentError', 'patientPaymentHistoryError', 'patientMedicineHistoryError', 'patientAppointmentsError']) {
      expect(readiness).toContain(flag);
    }
    const submit = section(app, 'const handlePaymentSubmit =', 'const matchedMedicineSales =');
    expect(submit).toMatch(/if \(patientPaymentNotReady\(\)\)\s*{\s*alert\([^;]+;\s*return;\s*}/);
    expect(submit.indexOf('if (patientPaymentNotReady())')).toBeLessThan(submit.indexOf('paymentSubmitInFlightRef.current = true'));
    expect(submit.indexOf('if (patientPaymentNotReady())')).toBeLessThan(submit.indexOf('setIsSubmitting(true)'));
  });
  it('clears the selected chart and draft on session reset and scopes lazy chart refresh', () => {
    const reset = section(app, 'const resetStaffSession =', 'const canAccessView =');
    expect(reset).toContain('handleClosePatient();');
    expect(reset).toContain('startupNavigationDoneRef.current = false;');
    const close = section(app, 'const handleClosePatient =', 'const renderAppBrand =');
    expect(close).toContain('setSelectedPatient(null)');
    expect(close).toContain('setPaymentDraft(');
    expect(close).toContain('appointmentPatientSelectionRef.current += 1;');
    expect(app).toContain('selectedPatient.location_id !== scope) handleClosePatient();');
    expect(app).toContain('if (!startupNavigationDoneRef.current && session)');
  });
  it('invalidates older chart/profile lookups on newer selections', () => {
    for (const [start, end] of [
      ['const handleViewAppointmentChart =', 'const handleEditAppointmentPatientInfo ='],
      ['const handleEditAppointmentPatientInfo =', 'const handleConvertLeadAppointment =']
    ]) {
      const handler = section(app, start, end);
      expect(handler).toContain('const selectionId = ++appointmentPatientSelectionRef.current;');
      expect(handler).toContain('if (selectionId !== appointmentPatientSelectionRef.current) return;');
    }
    expect(section(app, 'const handlePatientSelect =', '// Clinical Focus')).toContain('appointmentPatientSelectionRef.current += 1;');
  });
  it('starts directory history automatically only after the allowed Patients screen is ready', () => {
    const auto = section(app, "if (!leanStaffStartup || !isAuthenticated || initialSyncActive || !currentLocationId", "if (currentView !== 'finance')");
    expect(auto).toContain("currentView !== 'patients'");
    expect(auto).toContain("!canAccessView('patients')");
    expect(auto).toContain('loadedLazyView !== `${currentLocationId}:patients`');
    expect(auto).toContain('historyScope === currentLocationId || historyLoading || historyError) return;');
    expect(auto).toContain('void loadDirectoryHistory();');
  });
  it('guards background progress and publishes complete datasets together', () => {
    const sync = section(app, 'const loadDirectoryHistory =', "if (!leanStaffStartup || !isAuthenticated || initialSyncActive || !currentLocationId");
    expect(sync).toContain('historyInFlightRef.current?.scope === scope');
    expect(sync).toContain('currentLocationIdRef.current === scope');
    expect(sync).toContain('if (!isCurrent()) return;');
    expect(sync).toContain('await Promise.allSettled(');
    expect(sync).toContain('setDirectoryHistoryRecords(records.value)');
    expect(sync).toContain('setDirectoryHistoryAppointments(allAppointments.value)');
    expect(sync).not.toContain('setGlobalRecords(');
    expect(sync).not.toContain('setAppointments(');
    expect(sync).toContain('onProgress: (loaded, total) => report(0, loaded, total)');
    expect(sync).toContain('onProgress: (loaded, total) => report(1, loaded, total)');
    expect(sync.indexOf('setHistoryProgress(100)')).toBeGreaterThan(sync.indexOf('setHistoryScope(scope)'));
    expect(sync).toContain('historyRequestRef.current += 1; // Ignore the other parallel read after a failure.');
  });
});
