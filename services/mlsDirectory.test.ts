import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildMaterialCostPaymentRows } from '../utils/materialCostPaymentRows';
import type { ClinicalRecord, PaymentRecord } from '../types';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), records: vi.fn(), payments: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./api', () => ({ api: { treatments: { getAllRecords: mocks.records }, finance: { getPayments: mocks.payments } } }));
import { loadMlsDirectoryPage } from './mlsDirectory';

const query = { page: 2, pageSize: 1, dateFrom: '2026-11-03', dateTo: '2026-11-03', patientSearch: ' Ann ', doctorSearch: 'Smith', treatmentSearch: 'Crown' };
const old = { id: 'old', patient_id: 'patient-1', date: '2026-10-01', cost: 100, doctor_name: 'Smith' } as ClinicalRecord;
const recent = { ...old, id: 'recent', date: '2026-11-01' };
const prior = { id: 'prior', patientId: 'patient-1', amount: 100, date: '2026-10-02', treatmentIds: ['old'] } as PaymentRecord;
const selected = { id: 'selected', patientId: 'patient-1', amount: 100, date: '2026-11-03', assignedSpecialDoctorTotal: 5, doctorEarningEntries: [{ paymentId: 'selected', treatmentId: 'recent', doctorId: 'd', earnings: 10 }] } as PaymentRecord;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { total: 3, payment_ids: ['selected'], patient_ids: ['patient-1'], treatment_ids: ['recent'] }, error: null });
  mocks.records.mockResolvedValue([old, recent]);
  mocks.payments.mockResolvedValue([selected, prior]);
});

describe('MLS bounded directory', () => {
  it('selects filters/count/page in RPC and hydrates only page patient history without date truncation', async () => {
    const result = await loadMlsDirectoryPage('branch-1', query);
    expect(mocks.rpc).toHaveBeenCalledWith('mls_directory_page', {
      p_location_id: 'branch-1', p_date_from: '2026-11-03', p_date_to: '2026-11-03',
      p_patient_search: 'Ann', p_doctor_search: 'Smith', p_treatment_search: 'Crown', p_page: 2, p_page_size: 1
    });
    expect(mocks.records).toHaveBeenCalledWith('branch-1', { patientIds: ['patient-1'], limit: null, throwOnError: true, signal: undefined });
    expect(mocks.payments).toHaveBeenCalledWith('branch-1', { patientIds: ['patient-1'], includeCorrections: false, signal: undefined });
    expect(result.payments.map((p) => p.id)).toEqual(['selected']);
    expect(result.total).toBe(3);
    const [row] = buildMaterialCostPaymentRows(result.records, result.payments, result.allocationPayments);
    expect(row.treatments.map((r) => r.id)).toEqual(['recent']);
    expect(row.allocatedTreatmentPayment).toBe(100);
    expect(row.doctorEarnings).toBe(15);
  });

  it('hydrates cross-date explicit links and does not display allocation context payments', async () => {
    mocks.payments.mockResolvedValue([{ ...selected, treatmentIds: ['old'] }]);
    const result = await loadMlsDirectoryPage('branch-1', query);
    const rows = buildMaterialCostPaymentRows(result.records, result.payments, result.allocationPayments);
    expect(rows).toHaveLength(1);
    expect(rows[0].treatments.map((r) => r.id)).toEqual(['old']);
  });

  it('does no branch hydration for an empty/out of range page', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 3, payment_ids: [], patient_ids: [], treatment_ids: [] } });
    expect(await loadMlsDirectoryPage('branch-1', query)).toEqual({ total: 3, records: [], payments: [], allocationPayments: [] });
    expect(mocks.records).not.toHaveBeenCalled();
    expect(mocks.payments).not.toHaveBeenCalled();
  });

  it('enumerates bounded RPC batches only when showAll is explicit', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 2, payment_ids: ['selected'], patient_ids: ['patient-1'], treatment_ids: [] } })
      .mockResolvedValueOnce({ data: { total: 2, payment_ids: ['prior'], patient_ids: ['patient-1'], treatment_ids: [] } });
    const result = await loadMlsDirectoryPage('branch-1', { ...query, showAll: true });
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_page)).toEqual([1, 2]);
    expect(result.payments.map((p) => p.id)).toEqual(['selected', 'prior']);
    expect(mocks.records).toHaveBeenCalledTimes(1);
  });

  it('fails closed on selection errors and cancellation', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'permission denied' } });
    await expect(loadMlsDirectoryPage('branch-1', query)).rejects.toThrow('permission denied');
    const controller = new AbortController(); controller.abort();
    await expect(loadMlsDirectoryPage('branch-1', query, controller.signal)).rejects.toThrow();
    expect(mocks.records).not.toHaveBeenCalled();
    await expect(loadMlsDirectoryPage('', query)).rejects.toThrow('branch');
  });

  it('migration bounds after filtering and keeps allocation history independent of payment date filters', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261103000001_mls_directory.sql', import.meta.url), 'utf8');
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).toContain('p.payment_date >= p_date_from');
    expect(sql).toContain('mls_patient_payment_links(p_location_id, patients.patient_id)');
    expect(sql).toContain('SELECT count(*) FROM filtered');
    expect(sql).toContain('SELECT * FROM filtered ORDER BY payment_date DESC, created_at DESC, id DESC');
    expect(sql).toContain('LIMIT least(500');
    expect(sql.indexOf('CONTINUE WHEN share <= 0')).toBeLessThan(sql.indexOf('remaining := jsonb_set'));
    expect(sql).toContain('t.patient_id = p.patient_id AND t.location_id = p_location_id');
  });
});