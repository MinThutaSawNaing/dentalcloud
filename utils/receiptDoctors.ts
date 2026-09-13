import type { Appointment, ClinicalRecord } from '../types';
import { normalizeDoctorName } from './doctorName';

/**
 * A receipt treatment line can know its doctor in up to three ways. Payment
 * snapshots win because they are the immutable facts of the printed receipt;
 * live clinical rows and the appointment cover receipts saved before the
 * snapshot carried a doctor.
 */
export interface ReceiptDoctorResolutionInput {
  snapshotDoctorName?: string | null;
  liveDoctorName?: string | null;
  lookupDoctorName?: string | null;
}

export const resolveReceiptTreatmentDoctorName = (
  input: ReceiptDoctorResolutionInput
): string =>
  normalizeDoctorName(input.snapshotDoctorName)
  || normalizeDoctorName(input.liveDoctorName)
  || normalizeDoctorName(input.lookupDoctorName);

type DoctorLookupTreatment = Pick<ClinicalRecord, 'id'> &
  Partial<Pick<ClinicalRecord, 'doctor_id' | 'doctor_name' | 'patient_id' | 'date' | 'appointment_id'>>;

/**
 * Builds a treatment-id -> doctor-name map for views that only hold a payment
 * snapshot, where the stored lines may predate doctor capture. A treatment
 * without its own doctor falls back to the appointment it came from, matched by
 * appointment id first and by patient + date second.
 */
export const buildTreatmentDoctorLookup = (
  treatments: DoctorLookupTreatment[] = [],
  appointments: Appointment[] = []
): Record<string, string> => {
  const appointmentsById = new Map<string, Appointment>();
  const appointmentsByPatientAndDate = new Map<string, Appointment>();

  (appointments || []).forEach((appointment) => {
    if (!appointment) return;
    if (appointment.id) appointmentsById.set(String(appointment.id), appointment);

    if (appointment.patient_id && appointment.date) {
      const key = `${appointment.patient_id}|${appointment.date}`;
      const existing = appointmentsByPatientAndDate.get(key);
      // Several visits can share one day; a completed visit owns the treatment.
      if (!existing || (existing.status !== 'Completed' && appointment.status === 'Completed')) {
        appointmentsByPatientAndDate.set(key, appointment);
      }
    }
  });

  const lookup: Record<string, string> = {};
  // Callers merge overlapping record collections, so the same treatment can be
  // seen twice - once with its own doctor and once from a query that skipped the
  // doctors join. Clinical ownership must always beat the appointment estimate.
  const resolvedFromClinicalRow = new Set<string>();

  (treatments || []).forEach((treatment) => {
    if (!treatment?.id) return;
    const treatmentId = String(treatment.id);
    if (resolvedFromClinicalRow.has(treatmentId)) return;

    const clinicalDoctorName = normalizeDoctorName(treatment.doctor_name);
    if (clinicalDoctorName) {
      lookup[treatmentId] = clinicalDoctorName;
      resolvedFromClinicalRow.add(treatmentId);
      return;
    }

    const linkedAppointment = treatment.appointment_id
      ? appointmentsById.get(String(treatment.appointment_id))
      : undefined;
    const sameDayAppointment = !linkedAppointment && treatment.patient_id && treatment.date
      ? appointmentsByPatientAndDate.get(`${treatment.patient_id}|${treatment.date}`)
      : undefined;
    const appointmentDoctorName = normalizeDoctorName(
      (linkedAppointment || sameDayAppointment)?.doctor_name
    );

    if (appointmentDoctorName && !lookup[treatmentId]) {
      lookup[treatmentId] = appointmentDoctorName;
    }
  });

  return lookup;
};
