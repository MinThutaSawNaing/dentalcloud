import type { Appointment, CancellationOutcome } from '../types';
import { parseAppointmentClinicalFocus } from './appointmentClinicalFocus';
import { formatDoctorName } from './doctorName';

export const appointmentPatientName = (appointment: Appointment) => appointment.patient_name || appointment.guest_name || 'Unknown';

const isCancellationOutcome = (outcome: unknown): outcome is CancellationOutcome =>
  outcome === 'NO_SHOW' || outcome === 'RESCHEDULED' || outcome === 'COMPLETED_LATER';

export type RecallsCancelsCategory = 'Upcoming Recall' | 'Late / No-show' | 'Needs Follow-up' | 'No Show' | 'Rescheduled' | 'Completed Later';

export interface RecallsCancelsExportRow {
  category: RecallsCancelsCategory;
  date: string;
  time: string;
  patient: string;
  patientType: 'Registered Patient' | 'Lead';
  phone: string;
  source: string;
  appointmentType: string;
  doctor: string;
  clinicalFocus: string;
  notes: string;
  cancellationOutcome: CancellationOutcome | null;
  completedLaterDate: string;
}

const sortNewestFirst = (appointments: Appointment[]) => appointments
  .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));

export const buildRecallsCancelsLists = (appointments: Appointment[], todayKey: string) => ({
  recalls: appointments
    .filter(appointment => appointment.patient_id && appointment.status === 'Scheduled' && appointment.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)),
  late: appointments
    .filter(appointment => appointment.status === 'Scheduled' && appointment.date < todayKey)
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)),
  cancelled: sortNewestFirst(appointments.filter(appointment => appointment.status === 'Cancelled' && !isCancellationOutcome(appointment.cancellation_outcome))),
  noShow: sortNewestFirst(appointments.filter(appointment => appointment.status === 'Cancelled' && appointment.cancellation_outcome === 'NO_SHOW')),
  rescheduled: sortNewestFirst(appointments.filter(appointment => appointment.status === 'Cancelled' && appointment.cancellation_outcome === 'RESCHEDULED')),
  completedLater: sortNewestFirst(appointments.filter(appointment => appointment.status === 'Cancelled' && appointment.cancellation_outcome === 'COMPLETED_LATER'))
});

const toExportRow = (appointment: Appointment, category: RecallsCancelsCategory, completedAppointmentDates: Map<string, string>): RecallsCancelsExportRow => {
  const { clinicalFocus, notes } = parseAppointmentClinicalFocus(appointment.notes);

  return {
    category,
    date: appointment.date || '',
    time: appointment.time || '',
    patient: appointmentPatientName(appointment),
    patientType: appointment.patient_id ? 'Registered Patient' : 'Lead',
    phone: appointment.guest_phone || '',
    source: appointment.patient_id ? 'Registered Patient' : appointment.guest_source || 'Lead',
    appointmentType: appointment.type || 'Checkup',
    doctor: formatDoctorName(appointment.doctor_name, 'N/A'),
    clinicalFocus,
    notes,
    cancellationOutcome: appointment.cancellation_outcome || null,
    completedLaterDate: appointment.completed_later_appointment_id
      ? completedAppointmentDates.get(appointment.completed_later_appointment_id) || ''
      : ''
  };
};

export const buildRecallsCancelsExportRows = (appointments: Appointment[], todayKey: string) => {
  const lists = buildRecallsCancelsLists(appointments, todayKey);
  const completedAppointmentDates = new Map(
    appointments.filter(appointment => appointment.status === 'Completed').map(appointment => [appointment.id, appointment.date])
  );

  return {
    recalls: lists.recalls.map(appointment => toExportRow(appointment, 'Upcoming Recall', completedAppointmentDates)),
    late: lists.late.map(appointment => toExportRow(appointment, 'Late / No-show', completedAppointmentDates)),
    cancelled: lists.cancelled.map(appointment => toExportRow(appointment, 'Needs Follow-up', completedAppointmentDates)),
    noShow: lists.noShow.map(appointment => toExportRow(appointment, 'No Show', completedAppointmentDates)),
    rescheduled: lists.rescheduled.map(appointment => toExportRow(appointment, 'Rescheduled', completedAppointmentDates)),
    completedLater: lists.completedLater.map(appointment => toExportRow(appointment, 'Completed Later', completedAppointmentDates))
  };
};