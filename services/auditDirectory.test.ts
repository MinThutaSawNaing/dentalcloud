import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), records: vi.fn(), appointments: vi.fn(), payments: vi.fn(), logs: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./api', () => ({ api: {
  treatments: { getAllRecords: mocks.records }, appointments: { getAll: mocks.appointments },
  finance: { getPayments: mocks.payments }, appointmentRescheduleLogs: { getAll: mocks.logs }
} }));
import { getAuditDirectoryPage, getAllFilteredAuditRows } from './auditDirectory';
const query = { dateFrom: '2026-11-01', dateTo: '2026-11-03', auditFilter: 'all' as const, searchTerm: ' Ada ', page: 2 };
const counts = { treatments: 0, appointments: 0, payments: 0, reschedules: 0 };
beforeEach(() => { vi.resetAllMocks(); Object.values(mocks).slice(1).forEach((mock) => mock.mockResolvedValue([])); });
describe('audit directory', () => {
  it('filters and pages at the database and skips empty source hydration', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 0, counts, rows: [] }, error: null });
    expect((await getAuditDirectoryPage('branch', query)).total).toBe(0);
    expect(mocks.rpc).toHaveBeenCalledWith('audit_directory', expect.objectContaining({ p_location_id: 'branch', p_search: 'Ada', p_offset: 100, p_limit: 100 }));
    expect(mocks.records).not.toHaveBeenCalled(); expect(mocks.payments).not.toHaveBeenCalled();
  });
  it('hydrates whole visits and enforces doctor scope', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 1, counts, rows: [{ kind: 'treatment', ids: ['t1', 't2'] }] }, error: null });
    mocks.records.mockResolvedValue([{ id: 't1', patient_id: 'p', date: '2026-11-01', cost: 10 }, { id: 't2', patient_id: 'p', date: '2026-11-01', cost: 20 }]);
    const page = await getAuditDirectoryPage('branch', query, 'doctor');
    expect(mocks.rpc).toHaveBeenCalledWith('audit_directory', expect.objectContaining({ p_doctor_id: 'doctor', p_filter: 'treatments' }));
    expect(mocks.records).toHaveBeenCalledWith('branch', expect.objectContaining({ treatmentIds: ['t1', 't2'], doctorId: 'doctor', throwOnError: true }));
    expect(page.auditRows).toHaveLength(1);
  });
  it('explicitly walks every filtered page for export, not just the visible page', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 101, counts, rows: [] }, error: null })
      .mockResolvedValueOnce({ data: { total: 101, counts, rows: [] }, error: null });
    await getAllFilteredAuditRows('branch', query);
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_offset)).toEqual([0, 100]);
  });
  it('fails closed when migration is absent', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    await expect(getAuditDirectoryPage('branch', query)).rejects.toThrow('Apply the audit directory migration');
    expect(mocks.records).not.toHaveBeenCalled();
  });
  it('hydrates contextual rows without adding them to the selected display/export rows', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 1, counts,
      rows: [{ kind: 'payment', ids: ['pay'] }],
      context: [{ kind: 'treatment', ids: ['t'] }]
    }, error: null });
    mocks.payments.mockResolvedValue([{ id: 'pay', patientId: 'p', date: '2026-11-01', treatmentIds: ['t'], amount: 10 }]);
    mocks.records.mockResolvedValue([{ id: 't', patient_id: 'p', date: '2026-11-01', cost: 10, discountAmount: 5 }]);
    const page = await getAuditDirectoryPage('branch', query);
    expect(page.auditRows).toHaveLength(1);
    expect(page.auditRows![0].kind).toBe('payment');
    if (page.auditRows![0].kind === 'payment') expect(page.auditRows![0].payment._treatmentDiscountAmount).toBe(5);
  });
});