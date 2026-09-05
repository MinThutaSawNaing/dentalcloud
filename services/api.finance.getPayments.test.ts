import { describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn((table: string) => {
    if (table === 'payments') {
      const query: any = {
        select: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn(async () => ({
          data: [{
            id: 'payment-1', patient_id: 'patient-1', amount: 100_000,
            cleared_amount: 100_000, remaining_balance: 200_000,
            payment_status: 'PARTIAL', payment_date: '2026-07-01',
            created_at: '2026-07-01T08:00:00Z'
          }],
          error: null
        }))
      };
      return query;
    }

    const query: any = {
      select: vi.fn(() => query),
      in: vi.fn(async () => ({
        data: [{
          id: 'entry-1', payment_id: 'payment-1', treatment_id: 'treatment-1',
          doctor_id: 'doctor-1', payment_date: '2026-07-01', treatment_date: '2026-06-30',
          calculation_mode: 'percentage', allocated_payment: 100_000,
          commission_rate: 10, earnings: 9_000
        }],
        error: null
      }))
    };
    return query;
  })
}));

vi.mock('./supabase', () => ({
  supabase: supabaseMock,
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('finance.getPayments', () => {
  it('enriches each payment with commission ledger rows keyed by that payment id', async () => {
    const [payment] = await api.finance.getPayments();

    expect(payment.doctorEarningEntries).toEqual([
      expect.objectContaining({ paymentId: 'payment-1', paymentDate: '2026-07-01', earnings: 9_000 })
    ]);
    expect(supabaseMock.from).toHaveBeenCalledWith('doctor_commission_entries');
  });
});
