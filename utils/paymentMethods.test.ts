import { describe, expect, it } from 'vitest';
import { formatPaymentMethod, isSelectablePaymentMethod, normalizePaymentMethod, PAYMENT_METHOD_OPTIONS } from './paymentMethods';

describe('payment methods', () => {
  it('normalizes clinic-facing aliases to stored payment methods', () => {
    expect(normalizePaymentMethod('KBZ Pay')).toBe('KPAY');
    expect(normalizePaymentMethod('Wave Pay')).toBe('WAVEPAY');
    expect(normalizePaymentMethod('debit-card')).toBe('DEBIT_CARD');
    expect(normalizePaymentMethod('AYA Pay')).toBe('AYA_PAY');
    expect(normalizePaymentMethod('UABPay')).toBe('UAB_PAY');
  });

  it('normalizes banking aliases to stored banking methods', () => {
    expect(normalizePaymentMethod('AYA Banking')).toBe('AYA_BANKING');
    expect(normalizePaymentMethod('ayabanking')).toBe('AYA_BANKING');
    expect(normalizePaymentMethod('KBZ Banking')).toBe('KBZ_BANKING');
    expect(normalizePaymentMethod('KBZBANKING')).toBe('KBZ_BANKING');
    expect(normalizePaymentMethod('CB Banking')).toBe('CB_BANKING');
    expect(normalizePaymentMethod('cb-banking')).toBe('CB_BANKING');
  });

  it('offers the three banking methods as selectable checkout options with labels', () => {
    expect(PAYMENT_METHOD_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining(['AYA_BANKING', 'KBZ_BANKING', 'CB_BANKING'])
    );
    expect(formatPaymentMethod('AYA_BANKING')).toBe('AYA Banking');
    expect(formatPaymentMethod('KBZ_BANKING')).toBe('KBZ Banking');
    expect(formatPaymentMethod('CB_BANKING')).toBe('CB Banking');
    PAYMENT_METHOD_OPTIONS.forEach((option) => {
      expect(isSelectablePaymentMethod(option.value)).toBe(true);
    });
    expect(new Set(PAYMENT_METHOD_OPTIONS.map((option) => option.value)).size).toBe(PAYMENT_METHOD_OPTIONS.length);
  });

  it('keeps unknown legacy values visible but not selectable for new payments', () => {
    expect(normalizePaymentMethod('bank transfer')).toBe('UNKNOWN');
    expect(formatPaymentMethod('UNKNOWN')).toBe('Unknown');
    expect(isSelectablePaymentMethod('UNKNOWN')).toBe(false);
    expect(isSelectablePaymentMethod('MMQR')).toBe(true);
  });
});
