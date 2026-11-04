import { api } from './api';
import type { ClinicalRecord, PaymentRecord } from '../types';
import { getPaymentDedupeKey } from '../utils/paymentTreatmentAllocation';
import { getMlsStageFraction, getMlsSyncPercentage } from '../utils/mlsSyncProgress';

export interface MlsLoadStage {
  label: string;
  unit: string;
  completed: number;
  total: number | null;
  status: 'waiting' | 'active' | 'complete';
  detail?: string;
}
export interface MlsLoadProgress {
  percentage: number;
  label: string;
  stages: MlsLoadStage[];
}

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
  options: { signal?: AbortSignal; legacyPayments?: PaymentRecord[]; onProgress?: (loaded: number, total: number | null) => void; onLoadProgress?: (progress: MlsLoadProgress) => void } = {}
): Promise<MlsDateBundle> {
  if (!locationId) throw new Error('A branch is required to load MLS.');
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const stages: MlsLoadStage[] = [
    { label: 'Downloading payments', unit: 'payments', completed: 0, total: null, status: 'active' },
    { label: 'Loading doctor commissions', unit: 'batches', completed: 0, total: null, status: 'waiting' },
    { label: 'Loading MLS cost audits', unit: 'batches', completed: 0, total: null, status: 'waiting' },
    { label: 'Loading MLS cost items', unit: 'batches', completed: 0, total: null, status: 'waiting' },
    { label: 'Loading patient allocation history', unit: 'patients', completed: 0, total: null, status: 'waiting' }
  ];
  const report = () => {
    if (signal?.aborted) return;
    const active = stages.filter(stage => stage.status === 'active');
    options.onLoadProgress?.({
      percentage: getMlsSyncPercentage(stages.map(stage => stage.status === 'complete' ? 1 : getMlsStageFraction(stage.completed, stage.total))),
      label: active.length ? active.map(stage => stage.label).join(' + ') : 'Preparing MLS payment rows...',
      stages: stages.map(stage => ({ ...stage }))
    });
  };
  const update = (index: number, completed: number, total: number | null) => {
    stages[index] = { ...stages[index], completed, total, status: total !== null && completed >= total ? 'complete' : 'active' };
    onProgress?.(completed, total);
    report();
  };
  report();
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
    includeCorrections: false, commissionRequestConcurrency: 3, signal,
    onProgress: (loaded, total) => update(0, loaded, total),
    onRowsDownloaded: () => {
      stages[0].status = 'complete';
      stages[1].status = 'active'; stages[2].status = 'active';
      report();
    },
    onEnrichmentProgress: (stage, completed, total) => update(stage === 'commission' ? 1 : stage === 'cost-audits' ? 2 : 3, completed, total)
  });
  signal?.throwIfAborted();
  const payments = merge(selected, legacy.filter(matches));
  stages[0] = { ...stages[0], completed: selected.length, total: selected.length, status: 'complete' };
  for (let i = 1; i <= 3; i++) stages[i].status = 'complete';
  const patientIds = [...new Set(payments.map(payment => payment.patientId))];
  if (patientIds.some(id => !id)) throw new Error('MLS payment is missing its patient. Please refresh.');
  const records: ClinicalRecord[] = [];
  const history: PaymentRecord[] = [];
  let treatmentRows = 0;
  let historyRows = 0;
  stages[4] = { ...stages[4], total: patientIds.length, status: patientIds.length ? 'active' : 'complete' };
  report();
  for (let offset = 0; offset < patientIds.length; offset += 40) {
    signal?.throwIfAborted();
    const ids = patientIds.slice(offset, offset + 40);
    let chunkTreatments = 0;
    let chunkPayments = 0;
    const reportHistory = () => {
      stages[4].detail = `${treatmentRows + chunkTreatments} treatments and ${historyRows + chunkPayments} historical payments downloaded`;
      report();
    };
    stages[4].detail = `Loading patients ${offset + 1}-${offset + ids.length} of ${patientIds.length}`;
    report();
    const [treatments, context] = await Promise.all([
      api.treatments.getAllRecords(locationId, { patientIds: ids, limit: null, throwOnError: true, includeCommissionEntries: false, signal,
        onProgress: (loaded, total) => { chunkTreatments = loaded; onProgress?.(loaded, total); reportHistory(); } }),
      // Allocation needs dates/amounts/links, not historical MLS cost audits.
      range.dateFrom || range.dateTo
        ? api.finance.getPayments(locationId, { patientIds: ids, includeCorrections: false, includeEnrichment: false, signal,
          onProgress: (loaded, total) => { chunkPayments = loaded; onProgress?.(loaded, total); reportHistory(); } })
        : Promise.resolve(selected.filter(payment => ids.includes(payment.patientId)))
    ]);
    records.push(...treatments); history.push(...context);
    treatmentRows += treatments.length;
    historyRows += range.dateFrom || range.dateTo ? context.length : 0;
    chunkTreatments = 0; chunkPayments = 0;
    stages[4].completed = offset + ids.length;
    if (stages[4].completed === patientIds.length) stages[4].status = 'complete';
    reportHistory();
  }
  signal?.throwIfAborted();
  const selectedPatients = new Set(patientIds);
  const allocationPayments = merge(history, legacy.filter(payment => selectedPatients.has(payment.patientId)));
  // A deletion or permissions change between reads must not publish partial money.
  const contextIds = new Set(allocationPayments.map(payment => payment.id));
  if (payments.some(payment => !contextIds.has(payment.id))) throw new Error('MLS payments changed while loading. Please refresh.');
  return { records, payments, allocationPayments };
}