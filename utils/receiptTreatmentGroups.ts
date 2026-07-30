import type { ClinicalRecord } from '../types';
import { getLocalDateKey, getReceiptItemDateKey, isReceiptItemRecent } from './receiptItemRecency';

export interface ReceiptTreatmentGroup {
  date: string;
  treatments: ClinicalRecord[];
  total: number;
}

const toSortableDate = (date: string): number => {
  const timestamp = new Date(date || '').getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

export const groupReceiptTreatmentsByDate = (treatments: ClinicalRecord[]): ReceiptTreatmentGroup[] => {
  const groups = new Map<string, ClinicalRecord[]>();

  treatments.forEach((treatment) => {
    const date = getReceiptItemDateKey(treatment.date || '') || treatment.date || '';
    groups.set(date, [...(groups.get(date) || []), treatment]);
  });

  return Array.from(groups, ([date, groupedTreatments]) => ({
    date,
    treatments: groupedTreatments,
    total: groupedTreatments.reduce((sum, treatment) => sum + (treatment.cost || 0), 0)
  })).sort((a, b) => toSortableDate(b.date) - toSortableDate(a.date));
};

export const splitReceiptTreatmentsByDate = (treatments: ClinicalRecord[], today: Date = new Date()) => {
  const todayKey = getLocalDateKey(today);
  return {
    today: treatments.filter((treatment) => isReceiptItemRecent(treatment.date || '', today)),
    past: treatments.filter((treatment) => {
      const treatmentDateKey = getReceiptItemDateKey(treatment.date || '');
      return !!treatmentDateKey && !!todayKey && treatmentDateKey < todayKey;
    })
  };
};