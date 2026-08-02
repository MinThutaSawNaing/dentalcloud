import type { ClinicalRecord } from '../types';

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export const calculateMaterialAdjustedDoctorEarnings = (
  records: ClinicalRecord[]
): number => {
  const total = records.reduce((sum, record) => {
    return sum + Math.max(0, Number(record.doctorEarnings || 0));
  }, 0);

  return roundMoney(total);
};

export const calculateMaterialNetProfit = (
  records: ClinicalRecord[],
  getMaterialCost: (treatmentId: string) => number
): number => {
  const treatmentAmount = records.reduce((sum, record) => sum + Math.max(0, Number(record.cost || 0)), 0);
  const materialCost = records.reduce((sum, record) => sum + Math.max(0, Number(getMaterialCost(record.id) || 0)), 0);
  const doctorEarnings = calculateMaterialAdjustedDoctorEarnings(records);
  return roundMoney(treatmentAmount - materialCost - doctorEarnings);
};
