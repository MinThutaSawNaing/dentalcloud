import type { api } from './api';

// Inject the read boundary so loading behavior can be tested without network access.
export interface PatientDashboardSource {
  patients: Pick<typeof api.patients, 'getById' | 'getAll'>;
  appointments: Pick<typeof api.appointments, 'getAll'>;
  treatments: Pick<typeof api.treatments, 'getHistory' | 'getTypes'>;
  files: Pick<typeof api.files, 'list'>;
  doctors: Pick<typeof api.doctors, 'getAll'>;
  appSettings: Pick<typeof api.appSettings, 'getReceiptPreferences' | 'getAppName'>;
  branchReceiptIdentity: Pick<typeof api.branchReceiptIdentity, 'get'>;
}

export const loadPatientDashboard = async (
  source: PatientDashboardSource,
  patientId: string | null,
  sessionLocationId?: string
) => {
  if (!patientId) throw new Error('No patient session found');

  // Older sessions may not carry a branch. Retain their existing lookup fallback,
  // but never load the clinic directory for a normal branch-scoped session.
  const patient = sessionLocationId
    ? await source.patients.getById(patientId, sessionLocationId)
    : (await source.patients.getAll()).find((row) => row.id === patientId);
  if (!patient) throw new Error('Patient data not found');

  // Once the profile supplies the authoritative branch, every independent read
  // can run together. Receipt configuration must not delay starting clinical reads.
  const [appointments, treatmentRecords, patientFiles, doctors, treatmentTypes, receiptConfiguration] = await Promise.all([
    source.appointments.getAll(patient.location_id, { patientId, throwOnError: true }),
    source.treatments.getHistory(patientId),
    source.files.list(patientId).catch((error) => {
      console.error('Failed to fetch patient files:', error);
      return [];
    }),
    source.doctors.getAll(patient.location_id),
    source.treatments.getTypes(patient.location_id),
    Promise.allSettled([
      source.appSettings.getReceiptPreferences(),
      source.appSettings.getAppName(),
      source.branchReceiptIdentity.get(patient.location_id)
    ]).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(['receipt preferences', 'application name', 'branch receipt identity'][index] + ' unavailable in patient portal:', result.reason);
        }
      });
      return results;
    })
  ]);

  const treatmentTypeOptions = [...new Set(treatmentTypes.map((type) => (type.name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  return { patient, appointments, treatmentRecords, patientFiles, doctors, treatmentTypeOptions, receiptConfiguration };
};