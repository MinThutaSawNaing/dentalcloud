import { beforeEach, expect, it, vi } from 'vitest';
import type { ClinicalRecord, PaymentRecord } from '../types';
import { buildMaterialCostPaymentRows } from '../utils/materialCostPaymentRows';

const mocks = vi.hoisted(() => ({ payments: vi.fn(), records: vi.fn() }));
vi.mock('./api', () => ({ api: { finance: { getPayments: mocks.payments }, treatments: { getAllRecords: mocks.records } } }));
import { loadMlsDateRange } from './mlsDateRange';

const old = { id: 'old', patient_id: 'p1', location_id: 'branch', date: '2026-10-01', cost: 100 } as ClinicalRecord;
const recent = { ...old, id: 'recent', date: '2026-11-01' };
const prior = { id: 'prior', patientId: 'p1', location_id: 'branch', amount: 100, date: '2026-10-02', treatmentIds: ['old'] } as PaymentRecord;
const today = { ...prior, id: 'today', date: '2026-11-04', treatmentIds: [] };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.payments.mockResolvedValueOnce([today]).mockResolvedValue([prior, today]);
  mocks.records.mockResolvedValue([old, recent]);
});

it('selects today only and preserves earlier payments solely as allocation context', async () => {
  const result = await loadMlsDateRange('branch', { dateFrom: '2026-11-04', dateTo: '2026-11-04' });
  expect(mocks.payments.mock.calls[0]).toEqual(['branch', expect.objectContaining({ dateFrom: '2026-11-04', dateTo: '2026-11-04', includeCorrections: false })]);
  expect(mocks.records).toHaveBeenCalledWith('branch', expect.objectContaining({ patientIds: ['p1'], limit: null, throwOnError: true }));
  expect(mocks.payments.mock.calls[1]).toEqual(['branch', expect.objectContaining({ patientIds: ['p1'], includeEnrichment: false })]);
  expect(result.payments.map(p => p.id)).toEqual(['today']);
  const [row] = buildMaterialCostPaymentRows(result.records, result.payments, result.allocationPayments);
  expect(row.treatments.map(r => r.id)).toEqual(['recent']);
  expect(row.allocatedTreatmentPayment).toBe(100);
});

it('does not read any patient history when the selected date has no payments', async () => {
  mocks.payments.mockReset().mockResolvedValue([]);
  expect(await loadMlsDateRange('branch', { dateFrom: '2026-11-05', dateTo: '2026-11-05' })).toEqual({ records: [], payments: [], allocationPayments: [] });
  expect(mocks.payments).toHaveBeenCalledTimes(1);
  expect(mocks.records).not.toHaveBeenCalled();
});

it('only removes date bounds for an explicit All selection and reuses its payment history', async () => {
  mocks.payments.mockReset().mockResolvedValue([prior, today]);
  const result = await loadMlsDateRange('branch', {});
  expect(mocks.payments).toHaveBeenCalledExactlyOnceWith('branch', expect.objectContaining({ dateFrom: undefined, dateTo: undefined }));
  expect(result.payments.map(p => p.id)).toEqual(['prior', 'today']);
  expect(result.allocationPayments).toEqual(result.payments);
});

it('keeps branch-local legacy payments, dedupes persisted receipts and restricts visible dates', async () => {
  const local = { ...today, id: 'local', amount: 30 };
  const result = await loadMlsDateRange('branch', { dateFrom: today.date, dateTo: today.date }, {
    legacyPayments: [prior, today, local, { ...local, id: 'other-branch', location_id: 'elsewhere' }]
  });
  expect(result.payments.map(p => p.id)).toEqual(['today', 'local']);
  expect(result.allocationPayments.map(p => p.id)).toEqual(['prior', 'today', 'local']);
});

it('rejects partial history rather than displaying misleading allocation values', async () => {
  mocks.payments.mockReset().mockResolvedValueOnce([today]).mockResolvedValue([prior]);
  await expect(loadMlsDateRange('branch', { dateFrom: today.date })).rejects.toThrow('changed while loading');
});

it('fails closed on treatment errors or cancellation, with no broad fallback', async () => {
  mocks.records.mockRejectedValue(new Error('offline'));
  await expect(loadMlsDateRange('branch', { dateFrom: today.date })).rejects.toThrow('offline');
  const controller = new AbortController(); controller.abort();
  mocks.payments.mockClear();
  await expect(loadMlsDateRange('branch', {}, { signal: controller.signal })).rejects.toThrow();
  expect(mocks.payments).not.toHaveBeenCalled();
});

it('bounds historical hydration to 40 patients per request', async () => {
  const selected = Array.from({ length: 81 }, (_, i) => ({ ...today, id: `pay-${i}`, patientId: `p-${i}` }));
  mocks.payments.mockReset().mockResolvedValueOnce(selected).mockImplementation(async (_branch, options) => selected.filter(p => options.patientIds.includes(p.patientId)));
  mocks.records.mockResolvedValue([]);
  const completed: number[] = [];
  await loadMlsDateRange('branch', { dateFrom: today.date }, { onLoadProgress: progress => {
    if (progress.stages[4].total === 81) completed.push(progress.stages[4].completed);
  } });
  expect(mocks.records.mock.calls.map(call => call[1].patientIds.length)).toEqual([40, 40, 1]);
  expect(mocks.payments.mock.calls.slice(1).every(call => call[1].patientIds.length <= 40)).toBe(true);
  expect(completed).toContain(40);
  expect(completed).toContain(80);
  expect(completed.at(-1)).toBe(81);
});

it('reports real download, parallel enrichment and patient-history work without reaching 100 early', async () => {
  const updates: import('./mlsDateRange').MlsLoadProgress[] = [];
  mocks.payments.mockReset().mockImplementation(async (_branch, options) => {
    options.onProgress?.(1, 2);
    options.onProgress?.(2, 2);
    options.onRowsDownloaded?.();
    options.onEnrichmentProgress?.('commission', 1, 2);
    options.onEnrichmentProgress?.('cost-audits', 0, 1);
    options.onEnrichmentProgress?.('commission', 2, 2);
    options.onEnrichmentProgress?.('cost-audits', 1, 1);
    options.onEnrichmentProgress?.('cost-items', 0, 0);
    return [prior, today];
  });
  mocks.records.mockImplementation(async (_branch, options) => {
    options.onProgress?.(2, null);
    return [old, recent];
  });
  await loadMlsDateRange('branch', {}, { onLoadProgress: progress => updates.push(progress) });
  expect(updates.some(p => p.stages[0].completed === 1 && p.stages[0].total === 2)).toBe(true);
  expect(updates.some(p => p.stages[1].completed === 1 && p.stages[1].total === 2 && p.stages[2].total === 1)).toBe(true);
  const final = updates.at(-1)!;
  expect(final.stages.map(s => s.status)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete']);
  expect(final.stages[4]).toMatchObject({ completed: 1, total: 1, detail: '2 treatments and 0 historical payments downloaded' });
  expect(final.label).toBe('Preparing MLS payment rows...');
  expect(updates.every(p => p.percentage < 100)).toBe(true);
});