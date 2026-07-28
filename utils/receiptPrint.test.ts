import { describe, expect, it } from 'vitest';

import {
  getReceiptPageSize,
  getReceiptPrintPosition,
  getThermalReceiptTypography,
  getThermalPageHeightMm,
  getThermalPaperWidthMm,
  THERMAL_PAGE_SAFETY_MM
} from './receiptPrint';

describe('receipt print sizing', () => {
  it('keeps A4 printing on A4 paper', () => {
    expect(getReceiptPageSize('A4', 400)).toBe('A4');
  });

  it('uses the physical roll width for both thermal formats', () => {
    expect(getThermalPaperWidthMm('THERMAL_55MM')).toBe(58);
    expect(getThermalPaperWidthMm('THERMAL_80MM')).toBe(80);
  });

  it('keeps every receipt in normal flow at the first page origin', () => {
    expect(getReceiptPrintPosition('THERMAL_55MM')).toBe('static');
    expect(getReceiptPrintPosition('THERMAL_80MM')).toBe('static');
    expect(getReceiptPrintPosition('A4')).toBe('static');
  });

  it('uses larger, semibold thermal typography for both roll widths', () => {
    expect(getThermalReceiptTypography('THERMAL_55MM')).toEqual({
      base: 11,
      line: 10,
      small: 9,
      header: 14,
      amount: 16,
      weight: 600
    });
    expect(getThermalReceiptTypography('THERMAL_80MM')).toEqual({
      base: 12,
      line: 11,
      small: 10,
      header: 16,
      amount: 18,
      weight: 600
    });
  });

  it('sizes a thermal page to its rendered content instead of a fixed A4 height', () => {
    // 960 CSS px is 10 inches / 254 mm. The result includes only cutter safety.
    expect(getThermalPageHeightMm(960)).toBe(254 + THERMAL_PAGE_SAFETY_MM);
    expect(getReceiptPageSize('THERMAL_80MM', getThermalPageHeightMm(960))).toBe('80mm 256mm');
  });

  it('guards invalid or empty measurements with a small valid page', () => {
    expect(getThermalPageHeightMm(Number.NaN)).toBe(20);
    expect(getReceiptPageSize('THERMAL_55MM', Number.POSITIVE_INFINITY)).toBe('58mm 20mm');
  });
});