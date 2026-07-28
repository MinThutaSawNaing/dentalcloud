import type { ReceiptSize } from '../types';

const CSS_PIXELS_PER_INCH = 96;
const MILLIMETRES_PER_INCH = 25.4;

// Leave enough paper for browser rounding and the printer cutter without
// recreating the large fixed-height tail that roll printers previously fed.
export const THERMAL_PAGE_SAFETY_MM = 2;

export const getThermalPaperWidthMm = (receiptSize: ReceiptSize): 58 | 80 =>
  receiptSize === 'THERMAL_80MM' ? 80 : 58;

export interface ThermalReceiptTypography {
  base: number;
  line: number;
  small: number;
  header: number;
  amount: number;
  weight: 600;
}

// Thermal printers need larger, heavier glyphs than screen layouts. Keep the
// two paper profiles together so invoice and payment receipts cannot drift.
export const getThermalReceiptTypography = (receiptSize: ReceiptSize): ThermalReceiptTypography =>
  receiptSize === 'THERMAL_80MM'
    ? { base: 12, line: 11, small: 10, header: 16, amount: 18, weight: 600 }
    : { base: 11, line: 10, small: 9, header: 14, amount: 16, weight: 600 };

// Once non-receipt body children are removed from print layout, normal flow is
// the most reliable way to put page one at the physical print origin. Absolute
// and fixed elements can be offset, centred, or repeated by paged-media engines.
export const getReceiptPrintPosition = (_receiptSize: ReceiptSize): 'static' => 'static';

export const getThermalPageHeightMm = (contentHeightPx: number): number => {
  const safeHeightPx = Number.isFinite(contentHeightPx) ? Math.max(0, contentHeightPx) : 0;
  const contentHeightMm = (safeHeightPx / CSS_PIXELS_PER_INCH) * MILLIMETRES_PER_INCH;

  return Math.max(20, Math.ceil(contentHeightMm + THERMAL_PAGE_SAFETY_MM));
};

export const getReceiptPageSize = (receiptSize: ReceiptSize, thermalPageHeightMm: number): string => {
  if (receiptSize === 'A4') return 'A4';

  const safeHeightMm = Number.isFinite(thermalPageHeightMm)
    ? Math.max(20, Math.ceil(thermalPageHeightMm))
    : 20;

  return `${getThermalPaperWidthMm(receiptSize)}mm ${safeHeightMm}mm`;
};