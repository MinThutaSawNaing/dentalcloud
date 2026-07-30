import { describe, expect, it } from 'vitest';
import type { Appointment } from '../types';
import { appointmentPatientName, buildRecallsCancelsExportRows, buildRecallsCancelsLists } from './recallsCancels';

const appointment = (overrides: Partial<Appointment>): Appointment => ({
  id: overrides.id || Math.random().toString(),
  location_id: 'loc-1',
  date: '2026-06-27',
  time: '09:00',
  type: 'Consult',
  status: 'Scheduled',
  ...overrides
});

describe('recalls and cancels dashboard lists', () => {
  it('splits cancelled appointments into unresolved and outcome buckets', () => {
    const { recalls, late, cancelled, noShow, rescheduled, completedLater } = buildRecallsCancelsLists([
      appointment({ id: 'future-patient', patient_id: 'p1', patient_name: 'Patient', date: '2026-06-28' }),
      appointment({ id: 'future-lead', guest_name: 'Lead', date: '2026-06-29' }),
      appointment({ id: 'late-lead', guest_name: 'Late Lead', date: '2026-06-26' }),
      appointment({ id: 'cancelled', patient_name: 'Cancelled', status: 'Cancelled', date: '2026-06-20' }),
      appointment({ id: 'no-show', patient_name: 'No Show', status: 'Cancelled', cancellation_outcome: 'NO_SHOW' }),
      appointment({ id: 'rescheduled', patient_name: 'Rescheduled', status: 'Cancelled', cancellation_outcome: 'RESCHEDULED' }),
      appointment({ id: 'completed-later', patient_name: 'Completed Later', status: 'Cancelled', cancellation_outcome: 'COMPLETED_LATER', completed_later_appointment_id: 'completed' }),
      appointment({ id: 'completed', patient_name: 'Done', status: 'Completed', date: '2026-06-20' })
    ], '2026-06-27');

    expect(recalls.map(item => item.id)).toEqual(['future-patient']);
    expect(late.map(item => item.id)).toEqual(['late-lead']);
    expect(cancelled.map(item => item.id)).toEqual(['cancelled']);
    expect(noShow.map(item => item.id)).toEqual(['no-show']);
    expect(rescheduled.map(item => item.id)).toEqual(['rescheduled']);
    expect(completedLater.map(item => item.id)).toEqual(['completed-later']);
  });

  it('uses patient name, then guest name, then Unknown', () => {
    expect(appointmentPatientName(appointment({ patient_name: 'Registered', guest_name: 'Guest' }))).toBe('Registered');
    expect(appointmentPatientName(appointment({ guest_name: 'Guest' }))).toBe('Guest');
    expect(appointmentPatientName(appointment({}))).toBe('Unknown');
  });

  it('keeps a cancelled appointment with an invalid outcome in Needs Follow-up', () => {
    const { cancelled, noShow, rescheduled, completedLater } = buildRecallsCancelsLists([
      appointment({ id: 'invalid-outcome', patient_name: 'Needs review', status: 'Cancelled', cancellation_outcome: 'UNKNOWN' as any })
    ], '2026-06-27');

    expect(cancelled.map(item => item.id)).toEqual(['invalid-outcome']);
    expect(noShow).toEqual([]);
    expect(rescheduled).toEqual([]);
    expect(completedLater).toEqual([]);
  });

  it('builds detailed export rows for each dashboard section', () => {
    const rows = buildRecallsCancelsExportRows([
      appointment({
        id: 'recall',
        patient_id: 'p1',
        patient_name: 'Aye Aye',
        doctor_name: 'Dr. Smith',
        date: '2026-06-28',
        notes: 'Clinical Focus: Implant review\nNotes: Bring previous X-ray'
      }),
      appointment({
        id: 'late-lead',
        guest_name: 'New Lead',
        guest_phone: '0912345678',
        guest_source: 'Facebook',
        date: '2026-06-26'
      }),
      appointment({ id: 'cancelled', patient_name: 'Cancelled Patient', status: 'Cancelled' }),
      appointment({ id: 'completed-later', patient_id: 'p1', patient_name: 'Completed later', status: 'Cancelled', cancellation_outcome: 'COMPLETED_LATER', completed_later_appointment_id: 'later-visit' }),
      appointment({ id: 'later-visit', patient_id: 'p1', patient_name: 'Completed later', status: 'Completed', date: '2026-06-30' })
    ], '2026-06-27');

    expect(rows.recalls[0]).toMatchObject({
      category: 'Upcoming Recall',
      patient: 'Aye Aye',
      patientType: 'Registered Patient',
      doctor: 'Dr. Smith',
      clinicalFocus: 'Implant review',
      notes: 'Bring previous X-ray'
    });
    expect(rows.late[0]).toMatchObject({
      category: 'Late / No-show',
      patient: 'New Lead',
      patientType: 'Lead',
      phone: '0912345678',
      source: 'Facebook'
    });
    expect(rows.cancelled[0].category).toBe('Needs Follow-up');
    expect(rows.completedLater[0]).toMatchObject({ category: 'Completed Later', completedLaterDate: '2026-06-30' });
  });
});