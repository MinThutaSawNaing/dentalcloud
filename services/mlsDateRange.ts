import { api } from './api';
import type { ClinicalRecord, PaymentRecord } from '../types';
import { getPaymentDedupeKey } from '../utils/paymentTreatmentAllocation';

export interface MlsDateRange { dateFrom?: string; dateTo?: string }
export interface MlsDateBundle {
  records: ClinicalRecord[];
  payments: PaymentRecord[];
  allocationPayments: PaymentRecord[];
}

/** Date selection limits the directory, never the historical allocation context.
 * Existing APIs retain payment MLS/commission mapping; no new RPC is required.
 */
export async function loadMlsDateRange(
  locationId: string,
  range: MlsDateRange,
  options: { signal?: AbortSignal; legacyPayments?: PaymentRecord[]; onProgress?: (loaded: number, total: number | null) => void } = {}
): Promise<MlsDateBundle> {
  if (!locationId) throw new Error('A branch is required to load MLS.');
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const matches = (payment: PaymentRecord) => payment.location_id === locationId
    && (!range.dateFrom || payment.date >= range.dateFrom) && (!range.dateTo || payment.date <= range.dateTo);
  const merge = (persisted: PaymentRecord[], local: PaymentRecord[]) => {
    const keys = new Set(persisted.map(getPaymentDedupeKey));
    return [...persisted, ...local.filter(payment => {
      const key = getPaymentDedupeKey(payment);
      if (keys.has(key)) return false;
      keys.add(key); return true;
    })];
  };
  const legacy = (options.legacyPayments || []).filter(payment => payment.location_id === locationId);
  const selected = await api.finance.getPayments(locationId, {
    dateFrom: range.dateFrom || undefined, dateTo: range.dateTo || undefined,
    includeCorrections: false, commissionRequestConcurrency: 3, signal, onProgress,
    onEnrichmentProgress: (_stage, completed, total) => onProgress?.(completed, total)
  });
  signal?.throwIfAborted();
  const payments = merge(selected, legacy.filter(matches));
  const patientIds = [...new Set(payments.map(payment => payment.patientId))];
  if (patientIds.some(id => !id)) throw new Error('MLS payment is missing its patient. Please refresh.');
  const records: ClinicalRecord[] = [];
  const history: PaymentRecord[] = [];
  for (let offset = 0; offset < patientIds.length; offset += 40) {
    signal?.throwIfAborted();
    const ids = patientIds.slice(offset, offset + 40);
    const [treatments, context] = await Promise.all([
      api.treatments.getAllRecords(locationId, { patientIds: ids, limit: null, throwOnError: true, includeCommissionEntries: false, signal, onProgress }),
      // Allocation needs dates/amounts/links, not historical MLS cost audits.
      range.dateFrom || range.dateTo
        ? api.finance.getPayments(locationId, { patientIds: ids, includeCorrections: false, includeEnrichment: false, signal, onProgress })
        : Promise.resolve(selected.filter(payment => ids.includes(payment.patientId)))
    ]);
    records.push(...treatments); history.push(...context);
  }
  signal?.throwIfAborted();
  const selectedPatients = new Set(patientIds);
  const allocationPayments = merge(history, legacy.filter(payment => selectedPatients.has(payment.patientId)));
  // A deletion or permissions change between reads must not publish partial money.
  const contextIds = new Set(allocationPayments.map(payment => payment.id));
  if (payments.some(payment => !contextIds.has(payment.id))) throw new Error('MLS payments changed while loading. Please refresh.');
  return { records, payments, allocationPayments };
}