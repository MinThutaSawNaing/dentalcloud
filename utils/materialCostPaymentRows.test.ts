import { describe, expect, it } from 'vitest';
import type { ClinicalRecord, PaymentRecord } from '../types';
import { buildMaterialCostPaymentRows } from './materialCostPaymentRows';

const treatment: ClinicalRecord = {
  id: 'treatment-1',
  location_id: 'branch-1',
  patient_id: 'patient-1',
  patient_name: 'Patient One',
  doctor_id: 'doctor-1',
  doctor_name: 'Doctor One',
  teeth: [],
  description: 'Implant',
  cost: 1_000_000,
  date: '2026-09-06',
  doctorEarningEntries: [
    {
      paymentId: 'payment-1', treatmentId: 'treatment-1', doctorId: 'doctor-1',
      paymentDate: '2026-09-06', treatmentDate: '2026-09-06', calculationMode: 'percentage',
      allocatedPayment: 300_000, commissionRate: 10, earnings: 30_000
    },
    {
      paymentId: 'payment-2', treatmentId: 'treatment-1', doctorId: 'doctor-1',
      paymentDate: '2026-09-07', treatmentDate: '2026-09-06', calculationMode: 'percentage',
      allocatedPayment: 700_000, commissionRate: 10, earnings: 70_000
    }
  ]
};

const payment = (id: string, date: string, amount: number, remainingBalance: number): PaymentRecord => ({
  id,
  patientId: 'patient-1',
  patient_name: 'Patient One',
  amount,
  clearedAmount: amount,
  treatmentIds: ['treatment-1'],
  date,
  type: remainingBalance === 0 ? 'FULL' : 'PARTIAL',
  remainingBalance
});

describe('MLS payment rows', () => {
  it('keeps partial collections and their doctor earnings as separate payment rows', () => {
    const rows = buildMaterialCostPaymentRows([treatment], [
      payment('payment-1', '2026-09-06', 300_000, 700_000),
      payment('payment-2', '2026-09-07', 700_000, 0)
    ]);

    expect(rows.map((row) => ({
      id: row.id,
      collected: row.allocatedTreatmentPayment,
      doctorEarnings: row.doctorEarnings
    }))).toEqual([
      { id: 'payment-2', collected: 700_000, doctorEarnings: 70_000 },
      { id: 'payment-1', collected: 300_000, doctorEarnings: 30_000 }
    ]);
  });

  it('does not create an MLS payment row for a payment with no treatment allocation', () => {
    const rows = buildMaterialCostPaymentRows([], [payment('payment-1', '2026-09-07', 50_000, 0)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'payment-1',
      treatments: [],
      allocatedTreatmentPayment: 0
    });
  });

  it('adds only assigned special doctor fees to doctor earned while preserving commission separately', () => {
    const paid = payment('payment-1', '2026-09-06', 300_000, 700_000);
    paid.doctorEarningEntries = treatment.doctorEarningEntries?.filter((entry) => entry.paymentId === paid.id);
    paid.specialDoctorTotal = 45_000;
    paid.assignedSpecialDoctorTotal = 40_000;
    paid.mlsTotal = 45_000;

    const [row] = buildMaterialCostPaymentRows([treatment], [paid]);

    expect(row).toMatchObject({
      doctorCommission: 30_000,
      assignedSpecialDoctorFees: 40_000,
      doctorEarnings: 70_000
    });
  });
});
