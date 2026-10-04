import type { Appointment, Doctor, Patient, TreatmentType, LoyaltyRule } from '../types';
import { toLocalDateInputValue } from '../utils/patientCreationDate';

export interface StaffStartupSource {
  patients: { getPage: (locationId: string, offset: number, limit: number) => Promise<Patient[]> };
  appointments: { getAll: (locationId: string, options: { dateFrom: string; dateTo: string; throwOnError: boolean }) => Promise<Appointment[]> };
  doctors: { getAll: (locationId: string, options: { throwOnError: boolean }) => Promise<Doctor[]> };
  treatments: { getTypes: (locationId: string, options: { throwOnError: boolean }) => Promise<TreatmentType[]> };
  loyalty: { getRules: (locationId: string, options: { throwOnError: boolean }) => Promise<LoyaltyRule[]> };
}

// Keep the network boundary small and testable. No historical queries belong here.
export const loadStaffStartup = async (source: StaffStartupSource, locationId: string, now = new Date()) => {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [patients, appointments, doctors, treatmentTypes, loyaltyRules] = await Promise.all([
    source.patients.getPage(locationId, 0, 100),
    source.appointments.getAll(locationId, {
      dateFrom: toLocalDateInputValue(now),
      dateTo: toLocalDateInputValue(tomorrow),
      throwOnError: true
    }),
    source.doctors.getAll(locationId, { throwOnError: true }),
    source.treatments.getTypes(locationId, { throwOnError: true }),
    source.loyalty.getRules(locationId, { throwOnError: true })
  ]);
  return { patients, appointments, doctors, treatmentTypes, loyaltyRules };
};