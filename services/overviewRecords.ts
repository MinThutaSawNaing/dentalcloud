import type { ClinicalRecord, DoctorEarningEntry } from '../types';

export interface OverviewRecordRange {
  dateFrom: string;
  dateTo: string;
}

export interface OverviewRecordsSource {
  // Must load the complete range, with normal commission enrichment. In particular,
  // an empty payment-range lookup does not prove that a treatment is legacy-only.
  loadTreatmentsInRange(locationId: string | undefined, range: OverviewRecordRange): Promise<ClinicalRecord[]>;
  // Must paginate to completion and reject on errors (never return a partial ledger).
  loadCommissionEntriesInRange(locationId: string | undefined, range: OverviewRecordRange): Promise<DoctorEarningEntry[]>;
  // IDs are bounded to 50 per call. Commission enrichment is unnecessary here:
  // the authoritative payment-range ledger replaces entries on these older rows.
  loadTreatmentsByIds(locationId: string | undefined, ids: string[]): Promise<ClinicalRecord[]>;
}

const entryKey = (entry: DoctorEarningEntry): string => (
  `${entry.paymentId}|${entry.treatmentId}|${entry.doctorId}`
);

/** Union clinical-date treatments with older treatments paid in the selected range.
 * This deliberately does not filter by treatment doctor: commission recipient and
 * current clinical ownership are different concepts. Callers own authorization.
 */
export const loadOverviewRecords = async (
  source: OverviewRecordsSource,
  locationId: string | undefined,
  range: OverviewRecordRange
): Promise<ClinicalRecord[]> => {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(range.dateFrom) || !validDate(range.dateTo) || range.dateFrom > range.dateTo) {
    throw new Error('A valid overview date range is required.');
  }

  const [rangeRecords, entries] = await Promise.all([
    source.loadTreatmentsInRange(locationId, range),
    source.loadCommissionEntriesInRange(locationId, range)
  ]);
  const assertBranch = (record: ClinicalRecord) => {
    if (locationId && record.location_id !== locationId) {
      throw new Error('The overview source returned a treatment outside the requested branch.');
    }
  };
  rangeRecords.forEach(assertBranch);
  const records = new Map(rangeRecords.map((record) => [record.id, record]));
  const rangeIds = new Set(records.keys());
  const entriesByTreatment = new Map<string, Map<string, DoctorEarningEntry>>();
  for (const entry of entries) {
    if (!entry.treatmentId || !validDate(entry.paymentDate)
      || entry.paymentDate < range.dateFrom || entry.paymentDate > range.dateTo) {
      throw new Error('The overview commission source returned an invalid range entry.');
    }
    const group = entriesByTreatment.get(entry.treatmentId) || new Map();
    group.set(entryKey(entry), entry);
    entriesByTreatment.set(entry.treatmentId, group);
  }

  const missingIds = [...entriesByTreatment.keys()].filter((id) => !records.has(id));
  // Sequential bounded groups avoid unbounded request bursts and long GET URLs.
  for (let offset = 0; offset < missingIds.length; offset += 50) {
    const ids = missingIds.slice(offset, offset + 50);
    const requested = new Set(ids);
    const olderRecords = await source.loadTreatmentsByIds(locationId, ids);
    for (const record of olderRecords) {
      assertBranch(record);
      if (!requested.has(record.id)) throw new Error('The overview source returned an unexpected treatment.');
      records.set(record.id, record);
    }
    if (ids.some((id) => !records.has(id))) {
      throw new Error('Some commission treatments could not be loaded. Retry the overview.');
    }
  }

  return [...records.values()].map((record) => {
    const authoritative = entriesByTreatment.get(record.id);
    if (!authoritative) return record; // Includes the existing legacy fallback.
    const merged = new Map<string, DoctorEarningEntry>();
    if (rangeIds.has(record.id)) {
      // Preserve other payment dates, but never add a synthetic legacy total on
      // top of real ledger entries for the same treatment.
      for (const entry of record.doctorEarningEntries || []) {
        if (!entry.paymentId.startsWith('legacy-')) merged.set(entryKey(entry), entry);
      }
    }
    for (const [key, entry] of authoritative) merged.set(key, entry);
    return { ...record, doctorEarningEntries: [...merged.values()] };
  });
};