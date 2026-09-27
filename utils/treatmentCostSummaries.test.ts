import { describe, expect, it } from 'vitest';

import { summarizeTreatmentCostRows } from './treatmentCostSummaries';

describe('treatment cost summaries', () => {
  it('separates all treatment cost categories while preserving the combined total', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-1', cost_type: 'material', total_amount: 12_000 },
      { audit_log_id: 'audit-1', cost_type: 'lab', total_amount: '30,000'.replace(',', '') },
      { audit_log_id: 'audit-1', cost_type: 'material', total_amount: 8_000 },
      { audit_log_id: 'audit-1', cost_type: 'special_doctor', total_amount: 40_000, doctor_id: 'doctor-1' }
    ], new Map([['audit-1', 'treatment-1']]));

    expect(summaries['treatment-1']).toEqual({
      auditLogId: 'audit-1',
      materialTotal: 20_000,
      materialItemCount: 2,
      labTotal: 30_000,
      labItemCount: 1,
      specialDoctorTotal: 40_000,
      assignedSpecialDoctorTotal: 40_000,
      specialDoctorItemCount: 1,
      totalAmount: 90_000,
      itemCount: 4
    });
  });

  it('keeps unassigned special doctor costs out of attributable doctor revenue', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-1', cost_type: 'special_doctor', total_amount: 25_000, doctor_id: 'doctor-1' },
      { audit_log_id: 'audit-1', cost_type: 'special_doctor', total_amount: 5_000, doctor_id: null }
    ], new Map([['audit-1', 'payment-1']]));

    expect(summaries['payment-1']).toMatchObject({
      specialDoctorTotal: 30_000,
      assignedSpecialDoctorTotal: 25_000,
      specialDoctorItemCount: 2
    });
  });

  it('treats legacy rows without a cost type as material', () => {
    const summaries = summarizeTreatmentCostRows([
      { audit_log_id: 'audit-legacy', total_amount: 25_000 }
    ], new Map([['audit-legacy', 'treatment-legacy']]));

    expect(summaries['treatment-legacy']?.materialTotal).toBe(25_000);
    expect(summaries['treatment-legacy']?.labTotal).toBe(0);
    expect(summaries['treatment-legacy']?.specialDoctorTotal).toBe(0);
    expect(summaries['treatment-legacy']?.totalAmount).toBe(25_000);
  });

  it('ignores rows that cannot be linked to a treatment', () => {
    expect(summarizeTreatmentCostRows([
      { audit_log_id: 'missing', cost_type: 'lab', total_amount: 10_000 }
    ], new Map())).toEqual({});
  });
});