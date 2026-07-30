import { describe, expect, it } from 'vitest';
import { isReceiptItemRecent } from './receiptItemRecency';

describe('isReceiptItemRecent', () => {
  const today = new Date(2025, 9, 12, 15, 30, 0);

  it('returns true only for items recorded on the same local calendar day', () => {
    expect(isReceiptItemRecent('2025-10-12', today)).toBe(true);
    expect(isReceiptItemRecent('2025-10-12T08:45:00', today)).toBe(true);
  });

  it('returns false for earlier or later dates', () => {
    expect(isReceiptItemRecent('2025-10-11', today)).toBe(false);
    expect(isReceiptItemRecent('2025-10-13', today)).toBe(false);
  });

  it('returns false for empty or invalid dates', () => {
    expect(isReceiptItemRecent('', today)).toBe(false);
    expect(isReceiptItemRecent('not-a-date', today)).toBe(false);
    expect(isReceiptItemRecent('2025-02-30', today)).toBe(false);
  });
});

