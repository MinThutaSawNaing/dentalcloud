import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadStaffStartup, type StaffStartupSource } from './staffStartup';

// No api/Supabase import: every read, including forbidden history reads, is a mock.
const makeSource = () => ({
  patients: { getPage: vi.fn<StaffStartupSource['patients']['getPage']>().mockResolvedValue([]), getAll: vi.fn() },
  appointments: { getAll: vi.fn<StaffStartupSource['appointments']['getAll']>().mockResolvedValue([]) },
  doctors: { getAll: vi.fn<StaffStartupSource['doctors']['getAll']>().mockResolvedValue([]) },
  treatments: {
    getTypes: vi.fn<StaffStartupSource['treatments']['getTypes']>().mockResolvedValue([]),
    getAllRecords: vi.fn()
  },
  loyalty: { getRules: vi.fn<StaffStartupSource['loyalty']['getRules']>().mockResolvedValue([]), getTransactions: vi.fn() },
  finance: { getPayments: vi.fn() },
  expenses: { getAll: vi.fn() },
  medicines: { getAll: vi.fn(), getSales: vi.fn() },
  appointmentRescheduleLogs: { getAll: vi.fn() },
  messages: { getMessages: vi.fn() }
});

const expectNoHistory = (source: ReturnType<typeof makeSource>) => {
  for (const read of [source.patients.getAll, source.treatments.getAllRecords,
    source.loyalty.getTransactions, source.finance.getPayments, source.expenses.getAll,
    source.medicines.getAll, source.medicines.getSales,
    source.appointmentRescheduleLogs.getAll, source.messages.getMessages]) {
    expect(read).not.toHaveBeenCalled();
  }
};

afterEach(() => vi.useRealTimers());

describe('loadStaffStartup', () => {
  it.each(['branch-1', 'branch-2'])('requests only the first 100 patients and scopes every read to %s', async (branch) => {
    const source = makeSource();
    const patients = Array.from({ length: 100 }, (_, index) => ({ id: `patient-${index}` })) as Awaited<ReturnType<StaffStartupSource['patients']['getPage']>>;
    source.patients.getPage.mockResolvedValue(patients);
    const result = await loadStaffStartup(source, branch, new Date(2026, 7, 5, 23, 30));

    expect(source.patients.getPage).toHaveBeenCalledExactlyOnceWith(branch, 0, 100);
    expect(source.appointments.getAll).toHaveBeenCalledExactlyOnceWith(branch, {
      dateFrom: '2026-08-05', dateTo: '2026-08-06', throwOnError: true
    });
    expect(source.doctors.getAll).toHaveBeenCalledExactlyOnceWith(branch, { throwOnError: true });
    expect(source.treatments.getTypes).toHaveBeenCalledExactlyOnceWith(branch, { throwOnError: true });
    expect(source.loyalty.getRules).toHaveBeenCalledExactlyOnceWith(branch, { throwOnError: true });
    expect(result.patients).toBe(patients);
    expect(result.appointments).toBe(await source.appointments.getAll.mock.results[0].value);
    expect(result.doctors).toBe(await source.doctors.getAll.mock.results[0].value);
    expect(result.treatmentTypes).toBe(await source.treatments.getTypes.mock.results[0].value);
    expect(result.loyaltyRules).toBe(await source.loyalty.getRules.mock.results[0].value);
    expectNoHistory(source);
  });

  it.each([
    [2026, 0, 31, 23, 30, '2026-01-31', '2026-02-01'],
    [2026, 11, 31, 23, 30, '2026-12-31', '2027-01-01'],
    [2028, 1, 28, 23, 30, '2028-02-28', '2028-02-29'],
    [2028, 1, 29, 23, 30, '2028-02-29', '2028-03-01'],
    // Late spring-forward eve and early fall-back day catch fixed 24-hour addition.
    [2026, 2, 7, 23, 30, '2026-03-07', '2026-03-08'],
    [2026, 10, 1, 0, 30, '2026-11-01', '2026-11-02']
  ] as const)('uses local calendar dates for %s/%s/%s at %s:%s', async (year, month, day, hour, minute, dateFrom, dateTo) => {
    const source = makeSource();
    const now = new Date(year, month, day, hour, minute);
    const timestamp = now.getTime();
    await loadStaffStartup(source, 'branch-1', now);
    expect(source.appointments.getAll).toHaveBeenCalledExactlyOnceWith('branch-1', {
      dateFrom, dateTo, throwOnError: true
    });
    expect(now.getTime()).toBe(timestamp);
  });

  it('uses the current local date when now is omitted and accepts genuinely empty success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 31, 23, 30));
    const source = makeSource();
    await expect(loadStaffStartup(source, 'empty-branch')).resolves.toEqual({
      patients: [], appointments: [], doctors: [], treatmentTypes: [], loyaltyRules: []
    });
    expect(source.appointments.getAll).toHaveBeenCalledExactlyOnceWith('empty-branch', {
      dateFrom: '2026-12-31', dateTo: '2027-01-01', throwOnError: true
    });
    expectNoHistory(source);
  });

  it.each(['patients', 'appointments', 'doctors', 'treatments', 'loyalty'] as const)(
    'preserves the original %s rejection instead of returning empty/partial success', async (key) => {
      const source = makeSource();
      const error = { message: `${key} unavailable`, code: 'XX000' };
      const read = key === 'patients' ? source.patients.getPage
        : key === 'treatments' ? source.treatments.getTypes
        : key === 'loyalty' ? source.loyalty.getRules : source[key].getAll;
      read.mockRejectedValueOnce(error);
      await expect(loadStaffStartup(source, 'branch-1')).rejects.toBe(error);
      expectNoHistory(source);
    }
  );
});
