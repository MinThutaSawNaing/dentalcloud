import { describe, expect, it } from 'vitest';
import type { Appointment, ClinicalRecord } from '../types';
import {
  buildTreatmentDoctorLookup,
  resolveReceiptTreatmentDoctorName
} from './receiptDoctors';

describe('receiptDoctors', () => {
  const appointment = (overrides: Partial<Appointment>): Appointment => ({
    id: 'apt-1',
    location_id: 'branch-1',
    patient_id: 'patient-1',
    date: '2026-09-12',
    time: '10:00',
    type: 'Checkup',
    status: 'Completed',
    ...overrides
  });

  const treatment = (overrides: Partial<ClinicalRecord>): ClinicalRecord => ({
    id: 'tr-1',
    location_id: 'branch-1',
    patient_id: 'patient-1',
    teeth: [],
    description: 'Cleaning',
    cost: 1000,
    date: '2026-09-12',
    ...overrides
  });

  it('prefers the immutable snapshot name over later clinical or appointment data', () => {
    expect(resolveReceiptTreatmentDoctorName({
      snapshotDoctorName: 'Dr. Original',
      liveDoctorName: 'Dr. Corrected',
      lookupDoctorName: 'Dr. Appointment'
    })).toBe('Original');

    expect(resolveReceiptTreatmentDoctorName({
      snapshotDoctorName: '   ',
      liveDoctorName: 'Dr. Corrected',
      lookupDoctorName: 'Dr. Appointment'
    })).toBe('Corrected');

    expect(resolveReceiptTreatmentDoctorName({
      liveDoctorName: null,
      lookupDoctorName: 'Dr. Appointment'
    })).toBe('Appointment');
  });

  it('returns an empty name when no source knows the doctor', () => {
    expect(resolveReceiptTreatmentDoctorName({})).toBe('');
  });

  it('builds a lookup from the clinical row first', () => {
    expect(buildTreatmentDoctorLookup(
      [treatment({ id: 'tr-1', doctor_name: 'Dr. Thiri' })],
      [appointment({ doctor_name: 'Dr. Nobody' })]
    )).toEqual({ 'tr-1': 'Thiri' });
  });

  it('falls back to the linked appointment when the treatment has no doctor', () => {
    expect(buildTreatmentDoctorLookup(
      [treatment({ id: 'tr-1', appointment_id: 'apt-9' })],
      [appointment({ id: 'apt-9', doctor_name: 'Dr. Aung' })]
    )).toEqual({ 'tr-1': 'Aung' });
  });

  it('falls back to the same-day visit when the treatment has no appointment id', () => {
    expect(buildTreatmentDoctorLookup(
      [treatment({ id: 'tr-1' })],
      [appointment({ id: 'apt-1', doctor_name: 'Dr. Saw Naing' })]
    )).toEqual({ 'tr-1': 'Saw Naing' });
  });

  it('prefers a completed visit when several share one day', () => {
    expect(buildTreatmentDoctorLookup(
      [treatment({ id: 'tr-1' })],
      [
        appointment({ id: 'apt-scheduled', status: 'Scheduled', doctor_name: 'Dr. Planned' }),
        appointment({ id: 'apt-completed', status: 'Completed', doctor_name: 'Dr. Actual' })
      ]
    )).toEqual({ 'tr-1': 'Actual' });
  });

  it('omits treatments nothing can attribute', () => {
    expect(buildTreatmentDoctorLookup(
      [treatment({ id: 'tr-1' }), treatment({ id: 'tr-2', patient_id: 'patient-2', date: '2026-01-05' })],
      [appointment({ doctor_name: 'Dr. Aung' })]
    )).toEqual({ 'tr-1': 'Aung' });
  });

  it('lets the clinical row win when a merged collection repeats it without a doctor join', () => {
    // RecordsView/dashboard/assistant caches can hand the same treatment over
    // twice, one copy lacking doctors(name). Order must not matter.
    expect(buildTreatmentDoctorLookup(
      [
        treatment({ id: 'tr-1', appointment_id: 'apt-1' }),
        treatment({ id: 'tr-1', appointment_id: 'apt-1', doctor_name: 'Dr. Thiri' })
      ],
      [appointment({ id: 'apt-1', doctor_name: 'Dr. Appointment' })]
    )).toEqual({ 'tr-1': 'Thiri' });

    expect(buildTreatmentDoctorLookup(
      [
        treatment({ id: 'tr-1', appointment_id: 'apt-1', doctor_name: 'Dr. Thiri' }),
        treatment({ id: 'tr-1', appointment_id: 'apt-1' })
      ],
      [appointment({ id: 'apt-1', doctor_name: 'Dr. Appointment' })]
    )).toEqual({ 'tr-1': 'Thiri' });
  });

  it('tolerates missing collections', () => {
    expect(buildTreatmentDoctorLookup()).toEqual({});
    expect(buildTreatmentDoctorLookup([treatment({})], [])).toEqual({});
  });
});
