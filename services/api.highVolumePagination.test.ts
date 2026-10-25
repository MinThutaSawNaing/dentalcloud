import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const state: any = { rowsByTable: {}, rangesByTable: {}, filtersByTable: {} };

  state.from = vi.fn((table: string) => ({
    select: vi.fn(() => {
      let from = 0;
      let to = 999;
      const query: any = {
        order: vi.fn(() => query),
        eq: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['eq', column, value]);
          return query;
        }),
        gte: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['gte', column, value]);
          return query;
        }),
        lte: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['lte', column, value]);
          return query;
        }),
        lt: vi.fn((column: string, value: unknown) => {
          (state.filtersByTable[table] ||= []).push(['lt', column, value]);
          return query;
        }),
        in: vi.fn(() => query),
        or: vi.fn(() => query),
        range: vi.fn((nextFrom: number, nextTo: number) => {
          from = nextFrom;
          to = nextTo;
          (state.rangesByTable[table] ||= []).push([from, to]);
          return query;
        }),
        then: (resolve: any, reject: any) => Promise.resolve({
          data: (state.rowsByTable[table] || []).slice(from, to + 1),
          error: null
        }).then(resolve, reject)
      };
      return query;
    })
  }));

  return state;
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from, rpc: vi.fn() },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const rows = (table: string) => Array.from({ length: 1001 }, (_, index) => ({
  id: `${table}-${String(index).padStart(4, '0')}`,
  location_id: 'location-1',
  patient_id: 'patient-1',
  appointment_id: 'appointment-1',
  patient_name: 'Patient One',
  original_date: '2026-08-05',
  new_date: '2026-08-06',
  reason: 'Schedule change',
  created_at: '2026-08-05T00:00:00Z',
  date: '2026-08-05',
  medicine_id: 'medicine-1',
  quantity: 1,
  unit_price: 100,
  total_price: 100,
  points: 1,
  type: 'EARNED',
  description: 'Test',
  sender_id: 'patient-1',
  sender_type: 'patient',
  recipient_id: 'admin-1',
  recipient_type: 'admin',
  content: 'Message',
  timestamp: '2026-08-05T00:00:00Z',
  read: false,
  conversation_id: 'conversation-1',
  amount: 100,
  payment_date: '2026-08-05'
}));

describe('high-volume Supabase fetches', () => {
  beforeEach(() => {
    supabaseMock.rowsByTable = { patient_material_costs: [] };
    supabaseMock.rangesByTable = {};
    supabaseMock.filtersByTable = {};
    supabaseMock.from.mockClear();
  });

  it('loads records after the first 1,000 rows for every production history fetch', async () => {
    for (const table of ['appointment_reschedule_logs', 'payments', 'expenses', 'medicine_sales', 'loyalty_transactions', 'messages']) {
      supabaseMock.rowsByTable[table] = rows(table);
    }
    vi.spyOn(api.messages, 'performAutomaticCleanup').mockResolvedValue(undefined);

    const results = await Promise.all([
      api.appointmentRescheduleLogs.getAll('location-1'),
      api.finance.getPayments('location-1'),
      api.expenses.getAll('location-1'),
      api.medicines.getSales('location-1'),
      api.loyalty.getTransactions('patient-1', 'location-1'),
      api.messages.getMessages('conversation-1')
    ]);

    results.forEach((result) => expect(result).toHaveLength(1001));
    for (const table of ['appointment_reschedule_logs', 'payments', 'expenses', 'medicine_sales', 'loyalty_transactions', 'messages']) {
      expect(supabaseMock.rangesByTable[table]).toEqual([[0, 999], [1000, 1999]]);
    }
  });

  it('applies the selected audit date range at the database query', async () => {
    await Promise.all([
      api.treatments.getAllRecords('location-1', {
        limit: null,
        dateFrom: '2026-08-06',
        dateTo: '2026-08-06',
        includeCommissionEntries: false
      }),
      api.appointments.getAll('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' }),
      api.finance.getPayments('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' }),
      api.appointmentRescheduleLogs.getAll('location-1', { dateFrom: '2026-08-06', dateTo: '2026-08-06' })
    ]);

    expect(supabaseMock.filtersByTable.treatments).toEqual(expect.arrayContaining([
      ['eq', 'location_id', 'location-1'],
      ['gte', 'date', '2026-08-06'],
      ['lte', 'date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.appointments).toEqual(expect.arrayContaining([
      ['gte', 'date', '2026-08-06'],
      ['lte', 'date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.payments).toEqual(expect.arrayContaining([
      ['gte', 'payment_date', '2026-08-06'],
      ['lte', 'payment_date', '2026-08-06']
    ]));
    expect(supabaseMock.filtersByTable.appointment_reschedule_logs).toEqual(expect.arrayContaining([
      ['gte', 'created_at', expect.any(String)],
      ['lt', 'created_at', expect.any(String)]
    ]));
    expect(supabaseMock.from).not.toHaveBeenCalledWith('doctor_commission_entries');
  });

  it('filters Clinical Focus payment history by patient at the database', async () => {
    await api.finance.getPayments('location-1', { patientId: 'patient-1' });

    expect(supabaseMock.filtersByTable.payments).toEqual(expect.arrayContaining([
      ['eq', 'location_id', 'location-1'],
      ['eq', 'patient_id', 'patient-1']
    ]));
  });

  it('loads all matching overview registrations without directory/account maintenance', async () => {
    supabaseMock.rowsByTable.patients = rows('patients');
    const patients = await api.patients.getCreatedInRange('location-1', '2026-08-01', '2026-08-31');
    expect(patients).toHaveLength(1001);
    expect(supabaseMock.rangesByTable.patients).toEqual([[0, 999], [1000, 1999]]);
    const filters = [
      ['eq', 'location_id', 'location-1'],
      ['gte', 'created_at', '2026-08-01T00:00:00Z'],
      ['lt', 'created_at', '2026-09-01T00:00:00.000Z']
    ];
    expect(supabaseMock.filtersByTable.patients).toEqual([...filters.slice(1), filters[0], ...filters.slice(1), filters[0]]);
    expect([...new Set(supabaseMock.from.mock.calls.map(call => call[0]))]).toEqual(['patients']);
  });

  it('queries all branches without adding a location restriction for overview registrations', async () => {
    await api.patients.getCreatedInRange(undefined, '2026-12-31', '2026-12-31');
    expect(supabaseMock.filtersByTable.patients).toEqual([
      ['gte', 'created_at', '2026-12-31T00:00:00Z'],
      ['lt', 'created_at', '2027-01-01T00:00:00.000Z']
    ]);
  });

  it('paginates the complete payment-date ledger and bounds older-treatment lookups for Overview', async () => {
    supabaseMock.rowsByTable.doctor_commission_entries = Array.from({ length: 1001 }, (_, i) => ({
      id: `entry-${i}`, treatment_id: `treatment-${i}`, payment_id: `payment-${i}`,
      doctor_id: 'doctor-1', payment_date: '2026-08-05', earnings: 10
    }));
    const records = vi.spyOn(api.treatments, 'getAllRecords').mockImplementation(async (_scope, options) => (
      (options?.treatmentIds || []).map(id => ({
        id, location_id: 'location-1', date: '2025-01-01', cost: 100, patient_id: 'patient-1', teeth: [], description: 'Synthetic'
      }))
    ));
    try {
      const result = await api.treatments.getOverviewRecords('location-1', { dateFrom: '2026-08-05', dateTo: '2026-08-05' });
      expect(result).toHaveLength(1001);
      expect(result.reduce((sum, record) => sum + record.doctorEarningEntries!.length, 0)).toBe(1001);
      expect(supabaseMock.rangesByTable.doctor_commission_entries).toEqual([[0, 999], [1000, 1999]]);
      expect(supabaseMock.filtersByTable.doctor_commission_entries).toContainEqual(['eq', 'location_id', 'location-1']);
      expect(records.mock.calls.slice(1).every(([, options]) => options!.treatmentIds!.length <= 50)).toBe(true);
    } finally {
      records.mockRestore();
    }
  });
});

// Reuse the mock query recorder above: no real Supabase/backend access.
describe('patient appointment history pagination', () => {
  it('keeps patient, date and branch filters on every getAll page', async () => {
    supabaseMock.rowsByTable = { appointments: rows('appointments') };
    supabaseMock.rangesByTable = {};
    supabaseMock.filtersByTable = {};
    supabaseMock.from.mockClear();

    const appointments = await api.appointments.getAll('location-1', {
      patientId: 'patient-1',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      throwOnError: true
    });

    expect(appointments).toHaveLength(1001);
    expect(appointments[0].id).toBe('appointments-0000');
    expect(appointments[1000].id).toBe('appointments-1000');
    expect(new Set(appointments.map((appointment) => appointment.id)).size).toBe(1001);
    expect(supabaseMock.rangesByTable.appointments).toEqual([[0, 999], [1000, 1999]]);
    const pageFilters = [
      ['eq', 'location_id', 'location-1'],
      ['gte', 'date', '2026-08-01'],
      ['lte', 'date', '2026-08-31'],
      ['eq', 'patient_id', 'patient-1']
    ];
    expect(supabaseMock.filtersByTable.appointments).toEqual([...pageFilters, ...pageFilters]);
    expect(supabaseMock.from.mock.calls).toEqual([['appointments'], ['appointments']]);
  });
});
