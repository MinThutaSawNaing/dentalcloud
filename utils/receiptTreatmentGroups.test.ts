import { describe, expect, it } from 'vitest';
import type { ClinicalRecord } from '../types';
import { groupReceiptTreatmentsByDate, splitReceiptTreatmentsByDate } from './receiptTreatmentGroups';

const treatment = (id: string, date: string, cost: number): ClinicalRecord => ({
  id,
  location_id: 'location-1',
  patient_id: 'patient-1',
  teeth: [],
  description: id,
  cost,
  date
});

describe('receipt treatment groups', () => {
  it('combines all treatments from a visit date and sorts visits newest first', () => {
    const groups = groupReceiptTreatmentsByDate([
      treatment('cleaning', '2025-10-11', 100),
      treatment('extraction', '2025-10-12T08:30:00', 250),
      treatment('xray', '2025-10-12', 50)
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ date: '2025-10-12', total: 300 });
    expect(groups[0].treatments.map(({ id }) => id)).toEqual(['extraction', 'xray']);
  });

  it('keeps only today in the default treatment list', () => {
    const split = splitReceiptTreatmentsByDate([
      treatment('today', '2025-10-12', 100),
      treatment('past', '2025-10-11', 100)
    ], new Date(2025, 9, 12, 9, 0, 0));

    expect(split.today.map(({ id }) => id)).toEqual(['today']);
    expect(split.past.map(({ id }) => id)).toEqual(['past']);
  });

  it('does not expose future or invalid treatment dates as past records', () => {
    const split = splitReceiptTreatmentsByDate([
      treatment('future', '2025-10-13', 100),
      treatment('invalid', '2025-02-30', 100)
    ], new Date(2025, 9, 12, 9, 0, 0));

    expect(split.today).toEqual([]);
    expect(split.past).toEqual([]);
  });
});