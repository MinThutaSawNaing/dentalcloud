import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('./supabase', () => ({
  supabase: { rpc, from: vi.fn() },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('patient directory summaries', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({
      data: [{
        patient_id: 'patient-1',
        last_visit: '2026-10-20',
        next_appointment: { id: 'appointment-1', date: '2026-10-30', time: '09:30', status: 'Scheduled' },
        treatments: [{ id: 'treatment-1', date: '2026-10-20', description: 'Synthetic cleaning', doctor_id: 'doctor-1', doctor_name: 'Synthetic Doctor' }],
        doctor_names: ['Synthetic Doctor', null]
      }],
      error: null
    });
  });

  it('requests one bounded branch-scoped RPC and maps nullable fields', async () => {
    const summaries = await api.patients.getDirectorySummaries('branch-1', [
      'patient-1', 'patient-1', 'patient-2'
    ]);

    expect(rpc).toHaveBeenCalledExactlyOnceWith('patient_directory_summaries', {
      p_location_id: 'branch-1',
      p_patient_ids: ['patient-1', 'patient-2']
    });
    expect(summaries).toEqual([{
      patientId: 'patient-1',
      lastVisit: '2026-10-20',
      nextAppointment: { id: 'appointment-1', date: '2026-10-30', time: '09:30', status: 'Scheduled' },
      treatments: [expect.objectContaining({ description: 'Synthetic cleaning' })],
      doctorNames: ['Synthetic Doctor']
    }]);
  });

  it('never requests more than one page of IDs and skips an empty page', async () => {
    await api.patients.getDirectorySummaries(undefined, Array.from({ length: 130 }, (_, index) => `patient-${index}`));
    expect(rpc.mock.calls[0][1].p_patient_ids).toHaveLength(100);
    expect(rpc.mock.calls[0][1].p_location_id).toBeNull();

    rpc.mockClear();
    await expect(api.patients.getDirectorySummaries('branch-1', [])).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a missing or failing summary query instead of silently showing wrong history', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'function patient_directory_summaries does not exist' } });
    await expect(api.patients.getDirectorySummaries('branch-1', ['patient-1']))
      .rejects.toThrow('Patient summaries are not installed yet. Apply the patient directory summary migration.');
  });
});
