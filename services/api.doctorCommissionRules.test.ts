import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: supabaseMock,
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('doctor commission rule editor API', () => {
  beforeEach(() => supabaseMock.from.mockReset());

  it('loads both values and the enabled flag for existing treatment rules', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'rule-2', doctor_id: 'doctor-1', treatment_id: 'service-1', commission_rate: '25.00', fixed_amount: '45000.00', is_enabled: false, treatment_types: { name: 'Implant' } }],
      error: null
    });
    const eq = vi.fn().mockReturnValue({ order });
    supabaseMock.from.mockReturnValue({ select: vi.fn().mockReturnValue({ eq }) });

    const result = await api.doctorTreatmentCommissions.getByDoctor('doctor-1');

    expect(result).toMatchObject([{ commission_rate: 25, fixed_amount: 45000, is_enabled: false, treatment_name: 'Implant' }]);
  });

  it('retains treatment rules with no fixed override while saving a flat-visit doctor', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const existingEq = vi.fn().mockResolvedValue({ data: [{ id: 'rule-2', treatment_id: 'service-1' }], error: null });
    const select = vi.fn().mockReturnValue({ eq: existingEq });
    const remove = vi.fn();
    supabaseMock.from.mockReturnValue({ upsert, select, delete: remove });

    await api.doctorTreatmentCommissions.replaceForDoctor('doctor-1', [
      { treatment_id: 'service-1', commission_rate: 25, fixed_amount: null, is_enabled: true }
    ]);

    expect(upsert).toHaveBeenCalledWith([{
      doctor_id: 'doctor-1', treatment_id: 'service-1', commission_rate: 25,
      fixed_amount: null, is_enabled: true
    }], { onConflict: 'doctor_id,treatment_id' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('loads both percentage and fixed amount when editing existing category rules', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'rule-1', doctor_id: 'doctor-1', category: 'Surgery', commission_rate: '35.50', fixed_amount: '50000.00' }],
      error: null
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    supabaseMock.from.mockReturnValue({ select });

    const result = await api.doctorCategoryCommissions.getByDoctor('doctor-1');

    expect(supabaseMock.from).toHaveBeenCalledWith('doctor_category_commissions');
    expect(eq).toHaveBeenCalledWith('doctor_id', 'doctor-1');
    expect(result).toEqual([{
      id: 'rule-1', doctor_id: 'doctor-1', category: 'Surgery', commission_rate: 35.5, fixed_amount: 50000
    }]);
  });

  it('updates an existing category rule with both values without deleting it', async () => {
    const existingEq = vi.fn().mockResolvedValue({ data: [{ id: 'rule-1', category: 'Surgery' }], error: null });
    const select = vi.fn().mockReturnValue({ eq: existingEq });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq: updateEq });
    const remove = vi.fn();
    supabaseMock.from.mockReturnValue({ select, update, delete: remove });

    await api.doctorCategoryCommissions.replaceForDoctor('doctor-1', [
      { category: 'Surgery', commission_rate: 40, fixed_amount: 60000 }
    ]);

    expect(update).toHaveBeenCalledWith({
      doctor_id: 'doctor-1', category: 'Surgery', commission_rate: 40, fixed_amount: 60000
    });
    expect(updateEq).toHaveBeenCalledWith('id', 'rule-1');
    expect(remove).not.toHaveBeenCalled();
  });
});