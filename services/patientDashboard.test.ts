import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Patient, ReceiptPreferences, TreatmentType } from '../types';
import { loadPatientDashboard, type PatientDashboardSource } from './patientDashboard';

const patient = { id: 'patient-1', name: 'Synthetic Patient', location_id: 'branch-1', email: '', phone: '' } as Patient;
const makeSource = () => ({
  patients: {
    getById: vi.fn<PatientDashboardSource['patients']['getById']>().mockResolvedValue(patient),
    getAll: vi.fn<PatientDashboardSource['patients']['getAll']>().mockResolvedValue([patient])
  },
  appointments: { getAll: vi.fn<PatientDashboardSource['appointments']['getAll']>().mockResolvedValue([]) },
  treatments: {
    getHistory: vi.fn<PatientDashboardSource['treatments']['getHistory']>().mockResolvedValue([]),
    getTypes: vi.fn<PatientDashboardSource['treatments']['getTypes']>().mockResolvedValue([])
  },
  files: { list: vi.fn<PatientDashboardSource['files']['list']>().mockResolvedValue([]) },
  doctors: { getAll: vi.fn<PatientDashboardSource['doctors']['getAll']>().mockResolvedValue([]) },
  appSettings: {
    getReceiptPreferences: vi.fn<PatientDashboardSource['appSettings']['getReceiptPreferences']>().mockResolvedValue(null),
    getAppName: vi.fn<PatientDashboardSource['appSettings']['getAppName']>().mockResolvedValue('Synthetic Clinic')
  },
  branchReceiptIdentity: { get: vi.fn<PatientDashboardSource['branchReceiptIdentity']['get']>().mockResolvedValue({} as any) }
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
afterEach(() => vi.restoreAllMocks());

describe('loadPatientDashboard', () => {
  it.each(['branch-1', 'branch-2'])('uses a single scoped profile and server-filtered full appointment history for %s', async (branch) => {
    const source = makeSource();
    source.patients.getById.mockResolvedValue({ ...patient, location_id: branch });
    const result = await loadPatientDashboard(source, patient.id, branch);
    expect(source.patients.getById).toHaveBeenCalledExactlyOnceWith(patient.id, branch);
    expect(source.patients.getAll).not.toHaveBeenCalled();
    expect(source.appointments.getAll).toHaveBeenCalledExactlyOnceWith(branch, { patientId: patient.id, throwOnError: true });
    expect(source.treatments.getHistory).toHaveBeenCalledExactlyOnceWith(patient.id);
    expect(source.files.list).toHaveBeenCalledExactlyOnceWith(patient.id);
    expect(source.doctors.getAll).toHaveBeenCalledExactlyOnceWith(branch);
    expect(source.treatments.getTypes).toHaveBeenCalledExactlyOnceWith(branch);
    expect(source.branchReceiptIdentity.get).toHaveBeenCalledExactlyOnceWith(branch);
    expect(result.patient.id).toBe(patient.id);
  });

  it('retains the legacy missing-location fallback and uses the found profile branch for subsequent reads', async () => {
    const source = makeSource();
    source.patients.getAll.mockResolvedValue([{ ...patient, id: 'unrelated' }, patient]);
    const result = await loadPatientDashboard(source, patient.id);
    expect(source.patients.getAll).toHaveBeenCalledExactlyOnceWith();
    expect(source.patients.getById).not.toHaveBeenCalled();
    expect(result.patient).toBe(patient);
    expect(source.appointments.getAll).toHaveBeenCalledExactlyOnceWith(patient.location_id, { patientId: patient.id, throwOnError: true });
  });

  it('starts all independent reads together without waiting for receipts or another clinical response', async () => {
    const source = makeSource();
    const profile = deferred<Patient | null>();
    const appointments = deferred<never[]>();
    const receipts = deferred<ReceiptPreferences | null>();
    source.patients.getById.mockReturnValue(profile.promise);
    source.appointments.getAll.mockReturnValue(appointments.promise);
    source.appSettings.getReceiptPreferences.mockReturnValue(receipts.promise);
    let settled = false;
    const loading = loadPatientDashboard(source, patient.id, patient.location_id).then((result) => { settled = true; return result; });
    expect(source.appointments.getAll).not.toHaveBeenCalled();
    profile.resolve(patient);
    await flush();
    for (const read of [source.appointments.getAll, source.treatments.getHistory, source.files.list,
      source.doctors.getAll, source.treatments.getTypes, source.appSettings.getReceiptPreferences,
      source.appSettings.getAppName, source.branchReceiptIdentity.get]) expect(read).toHaveBeenCalledTimes(1);
    appointments.resolve([]);
    await flush();
    // Keep receipt actions correct: don't expose the dashboard with pending currency/size.
    expect(settled).toBe(false);
    receipts.resolve(null);
    await loading;
    expect(settled).toBe(true);
  });

  it('fails before any data reads when no patient session exists', async () => {
    const source = makeSource();
    await expect(loadPatientDashboard(source, null, 'branch-1')).rejects.toThrow('No patient session found');
    expect(source.patients.getById).not.toHaveBeenCalled();
    expect(source.patients.getAll).not.toHaveBeenCalled();
    expect(source.appointments.getAll).not.toHaveBeenCalled();
  });

  it('does not fall back to a clinic directory when a scoped patient is missing', async () => {
    const source = makeSource();
    source.patients.getById.mockResolvedValue(null);
    await expect(loadPatientDashboard(source, patient.id, 'branch-1')).rejects.toThrow('Patient data not found');
    expect(source.patients.getAll).not.toHaveBeenCalled();
    expect(source.appointments.getAll).not.toHaveBeenCalled();
  });

  it('preserves profile lookup errors instead of treating them as missing patients', async () => {
    const source = makeSource();
    const error = new Error('Profile access denied');
    source.patients.getById.mockRejectedValue(error);
    await expect(loadPatientDashboard(source, patient.id, 'branch-1')).rejects.toBe(error);
    expect(source.patients.getAll).not.toHaveBeenCalled();
  });

  it.each(['appointments', 'history', 'doctors', 'types'] as const)('propagates %s read failures to the dashboard error handler', async (key) => {
    const source = makeSource();
    const error = new Error(`${key} unavailable`);
    const read = key === 'appointments' ? source.appointments.getAll : key === 'history' ? source.treatments.getHistory
      : key === 'doctors' ? source.doctors.getAll : source.treatments.getTypes;
    read.mockRejectedValue(error);
    await expect(loadPatientDashboard(source, patient.id, 'branch-1')).rejects.toBe(error);
  });

  it('isolates all receipt configuration and file failures while preserving clinical data', async () => {
    const source = makeSource();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Supplementary data unavailable');
    source.files.list.mockRejectedValue(error);
    source.appSettings.getReceiptPreferences.mockRejectedValue(error);
    source.appSettings.getAppName.mockRejectedValue(error);
    source.branchReceiptIdentity.get.mockRejectedValue(error);
    const result = await loadPatientDashboard(source, patient.id, 'branch-1');
    expect(result.patient).toBe(patient);
    expect(result.patientFiles).toEqual([]);
    expect(result.appointments).toEqual([]);
    expect(result.receiptConfiguration.every((entry) => entry.status === 'rejected')).toBe(true);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalledExactlyOnceWith('Failed to fetch patient files:', error);
  });

  it('preserves successful receipt settings independently and normalizes booking type options', async () => {
    const source = makeSource();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const preferences = { receiptSize: 'THERMAL_80MM', currency: 'MMK', headerTitle: 'Receipt' } as ReceiptPreferences;
    source.appSettings.getReceiptPreferences.mockResolvedValue(preferences);
    source.branchReceiptIdentity.get.mockRejectedValue(new Error('Migration missing'));
    source.treatments.getTypes.mockResolvedValue([
      { name: ' Cleaning ' }, { name: 'Extraction' }, { name: 'Cleaning' }, { name: '' }, { name: '  ' }
    ] as TreatmentType[]);
    const result = await loadPatientDashboard(source, patient.id, 'branch-1');
    expect(result.receiptConfiguration[0]).toEqual({ status: 'fulfilled', value: preferences });
    expect(result.receiptConfiguration[1]).toEqual({ status: 'fulfilled', value: 'Synthetic Clinic' });
    expect(result.receiptConfiguration[2].status).toBe('rejected');
    expect(result.treatmentTypeOptions).toEqual(['Cleaning', 'Extraction']);
  });
});