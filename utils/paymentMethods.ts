import type { PaymentAllocation, PaymentMethod } from '../types';

export const PAYMENT_METHOD_OPTIONS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: 'KPAY', label: 'KPay' },
  { value: 'WAVEPAY', label: 'WavePay' },
  { value: 'CASH', label: 'Cash' },
  { value: 'MMQR', label: 'MMQR' },
  { value: 'DEBIT_CARD', label: 'Debit Card' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'AYA_PAY', label: 'AYA Pay' },
  { value: 'UAB_PAY', label: 'UAB Pay' },
  { value: 'AYA_BANKING', label: 'AYA Banking' },
  { value: 'KBZ_BANKING', label: 'KBZ Banking' },
  { value: 'CB_BANKING', label: 'CB Banking' }
];

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  KPAY: 'KPay',
  WAVEPAY: 'WavePay',
  CASH: 'Cash',
  MMQR: 'MMQR',
  DEBIT_CARD: 'Debit Card',
  CREDIT_CARD: 'Credit Card',
  AYA_PAY: 'AYA Pay',
  UAB_PAY: 'UAB Pay',
  AYA_BANKING: 'AYA Banking',
  KBZ_BANKING: 'KBZ Banking',
  CB_BANKING: 'CB Banking',
  MIXED: 'Mixed Payment',
  UNKNOWN: 'Unknown'
};

const PAYMENT_METHOD_ALIASES: Record<string, PaymentMethod> = {
  KPAY: 'KPAY',
  KBZPAY: 'KPAY',
  KBZ_PAY: 'KPAY',
  WAVEPAY: 'WAVEPAY',
  WAVE_PAY: 'WAVEPAY',
  CASH: 'CASH',
  MMQR: 'MMQR',
  MM_QR: 'MMQR',
  DEBIT: 'DEBIT_CARD',
  DEBIT_CARD: 'DEBIT_CARD',
  CREDIT: 'CREDIT_CARD',
  CREDIT_CARD: 'CREDIT_CARD',
  AYAPAY: 'AYA_PAY',
  AYA_PAY: 'AYA_PAY',
  UABPAY: 'UAB_PAY',
  UAB_PAY: 'UAB_PAY',
  AYABANKING: 'AYA_BANKING',
  AYA_BANKING: 'AYA_BANKING',
  KBZBANKING: 'KBZ_BANKING',
  KBZ_BANKING: 'KBZ_BANKING',
  CBBANKING: 'CB_BANKING',
  CB_BANKING: 'CB_BANKING',
  MIXED: 'MIXED',
  UNKNOWN: 'UNKNOWN'
};

export const formatPaymentMethod = (method?: PaymentMethod | null): string =>
  PAYMENT_METHOD_LABELS[method || 'UNKNOWN'];

export const normalizePaymentMethod = (value: unknown): PaymentMethod => {
  if (typeof value !== 'string') return 'UNKNOWN';
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return PAYMENT_METHOD_ALIASES[normalized] || 'UNKNOWN';
};

export const isSelectablePaymentMethod = (method: PaymentMethod): boolean => method !== 'UNKNOWN' && method !== 'MIXED';

const roundMoney = (amount: number): number => Math.round(amount * 100) / 100;

export const normalizePaymentAllocations = (
  value: unknown,
  fallbackMethod?: PaymentMethod | null,
  fallbackAmount = 0
): PaymentAllocation[] => {
  const rawItems = Array.isArray(value) ? value : [];
  const byMethod = new Map<PaymentMethod, PaymentAllocation>();

  rawItems.forEach((item: any) => {
    const method = normalizePaymentMethod(item?.method ?? item?.payment_method);
    const amount = roundMoney(Number(item?.amount || 0));
    if (!isSelectablePaymentMethod(method) || !Number.isFinite(amount) || amount <= 0) return;
    const existing = byMethod.get(method);
    const id = item?.id || existing?.id;
    const paymentId = item?.paymentId || item?.payment_id || existing?.paymentId;
    const reference = typeof item?.reference === 'string' ? item.reference.trim() || null : existing?.reference || null;
    byMethod.set(method, {
      ...(id ? { id } : {}),
      ...(paymentId ? { paymentId } : {}),
      method,
      amount: roundMoney((existing?.amount || 0) + amount),
      ...(reference ? { reference } : {})
    });
  });

  if (byMethod.size > 0) return Array.from(byMethod.values());
  const method = normalizePaymentMethod(fallbackMethod);
  const amount = roundMoney(Number(fallbackAmount || 0));
  return isSelectablePaymentMethod(method) && amount > 0 ? [{ method, amount }] : [];
};

export const getPaymentAllocationTotal = (allocations: PaymentAllocation[]): number =>
  roundMoney(allocations.reduce((total, allocation) => total + Number(allocation.amount || 0), 0));

export const validatePaymentAllocations = (allocations: PaymentAllocation[], expectedTotal: number): string | null => {
  const normalizedTotal = roundMoney(Number(expectedTotal || 0));
  if (!Number.isFinite(normalizedTotal) || normalizedTotal <= 0) return 'Payment amount must be greater than 0.';
  if (!Array.isArray(allocations) || allocations.length === 0) return 'Select at least one payment method.';
  const seen = new Set<PaymentMethod>();
  for (const allocation of allocations) {
    if (!isSelectablePaymentMethod(allocation.method)) return 'Select a valid payment method for every allocation.';
    if (seen.has(allocation.method)) return 'Each payment method can only be used once.';
    seen.add(allocation.method);
    if (!Number.isFinite(Number(allocation.amount)) || Number(allocation.amount) <= 0) return 'Every allocation amount must be greater than 0.';
  }
  return getPaymentAllocationTotal(allocations) === normalizedTotal
    ? null
    : 'Payment allocations must exactly equal the amount received.';
};

export const getPaymentHeaderMethod = (allocations: PaymentAllocation[]): PaymentMethod =>
  allocations.length === 1 ? allocations[0].method : allocations.length > 1 ? 'MIXED' : 'UNKNOWN';

export const formatPaymentAllocations = (allocations?: PaymentAllocation[] | null): string => {
  if (!allocations?.length) return 'Unknown';
  return allocations.map((allocation) => `${formatPaymentMethod(allocation.method)} ${allocation.amount.toLocaleString()}`).join(' + ');
};
