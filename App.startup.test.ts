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
    expect(lazy).toContain('if (cancelled || requestId !== lazyViewRequestRef.current) return;');
    expect(lazy).toContain('if (!cancelled && requestId === lazyViewRequestRef.current) setLoadedLazyView(key);');
    expect(lazy).toMatch(/void load\(\)\.catch[\s\S]*if \(!cancelled && requestId === lazyViewRequestRef.current\)[\s\S]*setLazyViewError/);
    expect(lazy).toContain('return () => { cancelled = true; };');
  });

  it('places screen content behind the branch/loading/error gate with a retry action', () => {
    const gate = section(app, '{leanStaffStartup && (startupScope !== currentLocationId', "{currentView === 'dashboard'");
    expect(gate).toContain('initialSyncActive || lazyViewError || loadedLazyView !== `${currentLocationId}:${currentView}`');
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
});
