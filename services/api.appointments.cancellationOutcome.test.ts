import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rows: [], updates: [] };
  state.from = vi.fn(() => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      single: vi.fn(async () => ({ data: state.rows.shift() || null, error: null })),
      update: vi.fn((payload: any) => {
        state.updates.push(payload);
        return query;
      })
    };
    return query;
  });
  return state;
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from, rpc: vi.fn() },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const cancelledAppointment = {
  id: 'cancelled-1', patient_id: 'patient-1', date: '2026-07-01', time: '09:00:00', status: 'Cancelled'
};

describe('appointments.updateCancellationOutcome', () => {
  beforeEach(() => {
    supabaseMock.rows = [];
    supabaseMock.updates = [];
    supabaseMock.from.mockClear();
  });

  it('accepts a same-patient completed appointment later on the same day despite time formatting differences', async () => {
    supabaseMock.rows.push(
      cancelledAppointment,
      { id: 'completed-1', patient_id: 'patient-1', date: '2026-07-01', time: '09:30', status: 'Completed' },
      { ...cancelledAppointment, cancellation_outcome: 'COMPLETED_LATER', completed_later_appointment_id: 'completed-1' }
    );

    await api.appointments.updateCancellationOutcome('cancelled-1', 'COMPLETED_LATER', 'completed-1');

    expect(supabaseMock.updates).toContainEqual({
      cancellation_outcome: 'COMPLETED_LATER',
      completed_later_appointment_id: 'completed-1'
    });
  });

  it('rejects an earlier completion and does not write an outcome', async () => {
    supabaseMock.rows.push(
      cancelledAppointment,
      { id: 'completed-early', patient_id: 'patient-1', date: '2026-07-01', time: '08:59:59', status: 'Completed' }
    );

    await expect(api.appointments.updateCancellationOutcome('cancelled-1', 'COMPLETED_LATER', 'completed-early'))
      .rejects.toThrow('later completed appointment');
    expect(supabaseMock.updates).toEqual([]);
  });

  it('clears the link when the follow-up outcome is cleared', async () => {
    supabaseMock.rows.push(
      cancelledAppointment,
      { ...cancelledAppointment, cancellation_outcome: null, completed_later_appointment_id: null }
    );

    await api.appointments.updateCancellationOutcome('cancelled-1', null);

    expect(supabaseMock.updates).toContainEqual({
      cancellation_outcome: null,
      completed_later_appointment_id: null
    });
  });
});