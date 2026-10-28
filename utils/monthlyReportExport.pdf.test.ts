import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMonthlyReport } from './monthlyReport';

const pdf = vi.hoisted(() => ({
  internal: { pageSize: { width: 420, height: 297 } },
  setFillColor: vi.fn(), rect: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(),
  text: vi.fn(), setDrawColor: vi.fn(), roundedRect: vi.fn(), addPage: vi.fn(),
  getNumberOfPages: vi.fn(() => 2), setPage: vi.fn(), line: vi.fn(), save: vi.fn()
}));

vi.mock('jspdf', () => ({ default: class { constructor() { return pdf; } } }));
vi.mock('jspdf-autotable', () => ({ default: vi.fn() }));

import autoTable from 'jspdf-autotable';
import { exportMonthlyReportToPDF } from './monthlyReportExport';

const metadata = {
  dateFrom: '2026-07-01', dateTo: '2026-07-31', locationName: 'Main', currency: 'MMK' as const
};

describe('monthly report PDF collection labels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows full period receipts separately from the treatment collection rate', () => {
    const report = buildMonthlyReport({
      records: [{ id: 'treatment-1', location_id: 'location-1', patient_id: 'patient-1',
        patient_name: 'Test Patient', teeth: [], description: 'Crown', cost: 270000, date: '2026-07-10' }],
      payments: [170000, 50000, 100000].map((amount, index) => ({
        id: `payment-${index}`, patientId: 'patient-1', amount, treatmentIds: ['treatment-1'],
        date: `2026-07-${10 + index}`, type: 'PARTIAL' as const, remainingBalance: 0
      })),
      costSummaries: {}, dateFrom: metadata.dateFrom, dateTo: metadata.dateTo
    });

    exportMonthlyReportToPDF(report, metadata);

    const text = pdf.text.mock.calls.map(call => call[0]);
    expect(text).toContain('PERIOD RECEIPTS');
    expect(text).toContain('TREATMENT COLLECTION RATE');
    expect(text.some(value => value.includes('not period receipts / charges'))).toBe(true);
    const detail = vi.mocked(autoTable).mock.calls[0][1];
    expect(detail.head[0][10]).toBe('Period Receipts');
    expect(detail.body.map(row => row[10])).toEqual(['170,000Ks', '50,000Ks', '100,000Ks']);
    const headers = detail.head[0];
    expect(Array.isArray(headers)).toBe(true);
    if (!Array.isArray(headers)) throw new Error('Expected an array of detail headers');
    expect(new Set(headers).size).toBe(headers.length);
    expect(pdf.save).toHaveBeenCalledOnce();
  });
});