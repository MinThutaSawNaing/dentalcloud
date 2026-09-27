import type { ClinicalRecord, DoctorEarningEntry, PaymentRecord } from '../types';
import { allocateCommissionablePayments } from './doctorCommissionLedger';
import {
  dedupePaymentRecords,
  getPaymentTreatmentIds,
  getPaymentTreatmentShare
} from './paymentTreatmentAllocation';

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export interface MaterialCostPaymentRow {
  id: string;
  date: string;
  createdAt?: string;
  payment: PaymentRecord;
  treatments: ClinicalRecord[];
  allocatedTreatmentPayment: number;
  doctorCommission: number;
  assignedSpecialDoctorFees: number;
  doctorEarnings: number;
  doctorNames: string[];
}

const getEntryKey = (entry: DoctorEarningEntry): string => (
  entry.id || `${entry.paymentId}|${entry.treatmentId}|${entry.doctorId}`
);

export const buildMaterialCostPaymentRows = (
  records: ClinicalRecord[],
  payments: PaymentRecord[]
): MaterialCostPaymentRow[] => {
  const uniquePayments = dedupePaymentRecords(payments);
  const treatmentById = new Map(records.map((record) => [record.id, record]));
  const allocations = allocateCommissionablePayments(
    records.map((record) => ({
      id: record.id,
      patientId: record.patient_id,
      date: record.date,
      cost: Math.max(0, Number(record.cost || 0))
    })),
    uniquePayments.map((payment) => ({
      id: payment.id,
      patientId: payment.patientId,
      date: payment.date,
      createdAt: payment.createdAt,
      commissionableAmount: getPaymentTreatmentShare(payment),
      treatmentIds: getPaymentTreatmentIds(payment)
    }))
  );

  const allocationsByPayment = new Map<string, typeof allocations>();
  allocations.forEach((allocation) => {
    const rows = allocationsByPayment.get(allocation.paymentId) || [];
    rows.push(allocation);
    allocationsByPayment.set(allocation.paymentId, rows);
  });

  return uniquePayments
    .map((payment): MaterialCostPaymentRow | null => {
      const paymentAllocations = allocationsByPayment.get(payment.id) || [];
      const treatmentIds = Array.from(new Set([
        ...paymentAllocations.map((allocation) => allocation.treatmentId),
        ...getPaymentTreatmentIds(payment)
      ]));
      const treatments = treatmentIds
        .map((treatmentId) => treatmentById.get(treatmentId))
        .filter((record): record is ClinicalRecord => Boolean(record));
      const entries = new Map<string, DoctorEarningEntry>();

      (payment.doctorEarningEntries || []).forEach((entry) => {
        if (entry.paymentId === payment.id) entries.set(getEntryKey(entry), entry);
      });
      treatments.forEach((record) => {
        (record.doctorEarningEntries || []).forEach((entry) => {
          if (entry.paymentId === payment.id) entries.set(getEntryKey(entry), entry);
        });
      });

      const doctorCommission = roundMoney(Array.from(entries.values()).reduce((sum, entry) => sum + Math.max(0, Number(entry.earnings || 0)), 0));
      const assignedSpecialDoctorFees = roundMoney(Math.max(0, Number(payment.assignedSpecialDoctorTotal || 0)));

      return {
        id: payment.id,
        date: payment.date,
        createdAt: payment.createdAt,
        payment,
        treatments,
        allocatedTreatmentPayment: roundMoney(paymentAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)),
        doctorCommission,
        assignedSpecialDoctorFees,
        doctorEarnings: roundMoney(doctorCommission + assignedSpecialDoctorFees),
        doctorNames: Array.from(new Set(treatments.map((record) => record.doctor_name).filter((name): name is string => Boolean(name))))
      };
    })
    .filter((row): row is MaterialCostPaymentRow => Boolean(row))
    .sort((a, b) => (
      b.date.localeCompare(a.date) ||
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')) ||
      b.id.localeCompare(a.id)
    ));
};
