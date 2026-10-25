import { describe, expect, it, vi } from 'vitest';
import type { ClinicalRecord, DoctorEarningEntry } from '../types';
import { loadOverviewRecords, type OverviewRecordsSource } from './overviewRecords';

const range = { dateFrom: '2026-08-01', dateTo: '2026-08-31' };
const record = (id: string, overrides: Partial<ClinicalRecord> = {}): ClinicalRecord => ({
  id, location_id: 'branch-1', patient_id: 'synthetic-patient', teeth: [],
  description: 'Synthetic treatment', cost: 100, date: '2026-08-01', ...overrides
});
const entry = (treatmentId: string, overrides: Partial<DoctorEarningEntry> = {}): DoctorEarningEntry => ({
  paymentId: `payment-${treatmentId}`, treatmentId, doctorId: 'recipient-1',
  paymentDate: '2026-08-15', treatmentDate: '2025-01-01',
  calculationMode: 'percentage', allocatedPayment: 100, commissionRate: 10,
  earnings: 10, ...overrides
});
const source = (overrides: Partial<OverviewRecordsSource> = {}): OverviewRecordsSource => ({
  loadTreatmentsInRange: vi.fn().mockResolvedValue([]),
  loadCommissionEntriesInRange: vi.fn().mockResolvedValue([]),
  loadTreatmentsByIds: vi.fn(async (_locationId, ids) => ids.map((id) => record(id, { date: '2025-01-01' }))),
  ...overrides
});

describe('overview clinical/payment-date union', () => {
  it('includes old paid treatments without duplicating range treatments or ledger entries', async () => {
    const inRange = entry('new');
    const old = entry('old');
    const api = source({
      loadTreatmentsInRange: vi.fn().mockResolvedValue([record('new', { doctorEarningEntries: [inRange] })]),
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([inRange, old, old])
    });
    const result = await loadOverviewRecords(api, 'branch-1', range);
    expect(result.map((row) => row.id)).toEqual(['new', 'old']);
    expect(result.flatMap((row) => row.doctorEarningEntries || [])).toEqual([inRange, old]);
    expect(api.loadTreatmentsByIds).toHaveBeenCalledWith('branch-1', ['old']);
    expect(api.loadTreatmentsInRange).toHaveBeenCalledWith('branch-1', range);
    expect(api.loadCommissionEntriesInRange).toHaveBeenCalledWith('branch-1', range);
  });

  it('retains legacy fallback when no actual ledger exists and replaces it when ledger exists', async () => {
    const legacy = entry('legacy', { paymentId: 'legacy-legacy' });
    const replacedLegacy = entry('actual', { paymentId: 'legacy-actual', earnings: 999 });
    const actual = entry('actual');
    const result = await loadOverviewRecords(source({
      loadTreatmentsInRange: vi.fn().mockResolvedValue([
        record('legacy', { doctorEarningEntries: [legacy] }),
        record('actual', { doctorEarningEntries: [replacedLegacy] })
      ]),
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([actual])
    }), 'branch-1', range);
    expect(result[0].doctorEarningEntries).toEqual([legacy]);
    expect(result[1].doctorEarningEntries).toEqual([actual]);
  });

  it('preserves recipient distinct from clinical owner and ignores synthetic fallback on old rows', async () => {
    const payment = entry('old', { doctorId: 'historical-recipient' });
    const result = await loadOverviewRecords(source({
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([payment]),
      loadTreatmentsByIds: vi.fn().mockResolvedValue([record('old', {
        doctor_id: 'current-owner',
        doctorEarningEntries: [entry('old', { paymentId: 'legacy-old', earnings: 999 })]
      })])
    }), 'branch-1', range);
    expect(result[0].doctor_id).toBe('current-owner');
    expect(result[0].doctorEarningEntries).toEqual([payment]);
  });

  it('bounds id groups to 50 and does not fetch existing range IDs', async () => {
    const api = source({
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue(Array.from({ length: 101 }, (_, i) => entry(`old-${i}`)))
    });
    expect(await loadOverviewRecords(api, 'branch-1', range)).toHaveLength(101);
    expect(vi.mocked(api.loadTreatmentsByIds).mock.calls.map((call) => call[1].length)).toEqual([50, 50, 1]);
  });

  it('propagates ledger errors rather than publishing fake zero totals', async () => {
    const api = source({ loadCommissionEntriesInRange: vi.fn().mockRejectedValue(new Error('Ledger unavailable')) });
    await expect(loadOverviewRecords(api, 'branch-1', range)).rejects.toThrow('Ledger unavailable');
  });

  it('rejects missing or unexpected related treatment rows instead of a partial ledger', async () => {
    const api = source({
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([entry('old')]),
      loadTreatmentsByIds: vi.fn().mockResolvedValue([])
    });
    await expect(loadOverviewRecords(api, 'branch-1', range)).rejects.toThrow('could not be loaded');
    api.loadTreatmentsByIds = vi.fn().mockResolvedValue([record('unrequested')]);
    await expect(loadOverviewRecords(api, 'branch-1', range)).rejects.toThrow('unexpected treatment');
  });

  it('rejects invalid/reversed ranges before making requests', async () => {
    const api = source();
    for (const invalid of [
      { dateFrom: '2026-02-30', dateTo: '2026-08-31' },
      { dateFrom: '2026-08-31', dateTo: '2026-08-01' }
    ]) {
      await expect(loadOverviewRecords(api, 'branch-1', invalid)).rejects.toThrow('valid overview date range');
    }
    expect(api.loadTreatmentsInRange).not.toHaveBeenCalled();
  });

  it('fails closed on branch mismatches in either clinical source', async () => {
    const outside = record('old', { location_id: 'another-branch' });
    await expect(loadOverviewRecords(source({
      loadTreatmentsInRange: vi.fn().mockResolvedValue([outside])
    }), 'branch-1', range)).rejects.toThrow('outside the requested branch');
    await expect(loadOverviewRecords(source({
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([entry('old')]),
      loadTreatmentsByIds: vi.fn().mockResolvedValue([outside])
    }), 'branch-1', range)).rejects.toThrow('outside the requested branch');
  });

  it('rejects a source ledger outside the requested calendar dates', async () => {
    await expect(loadOverviewRecords(source({
      loadCommissionEntriesInRange: vi.fn().mockResolvedValue([entry('old', { paymentDate: '2026-09-01' })])
    }), 'branch-1', range)).rejects.toThrow('invalid range entry');
  });
});