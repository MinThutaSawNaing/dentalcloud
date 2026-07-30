import { describe, expect, it } from 'vitest';
import { EXCEL_HEADER_ROW_HEIGHT_POINTS, RECALLS_CANCELS_EXCEL_COLUMN_WIDTHS, RECALLS_CANCELS_EXCEL_HEADERS } from './excelExport';
import { RECALLS_CANCELS_PDF_COLUMN_WIDTHS, RECALLS_CANCELS_PDF_HEADERS, RECALLS_CANCELS_PDF_TABLE_WIDTH } from './pdfExport';

describe('recalls and cancels export layout', () => {
  it('gives every PDF column an explicit width within the A4 landscape table area', () => {
    expect(RECALLS_CANCELS_PDF_COLUMN_WIDTHS).toHaveLength(RECALLS_CANCELS_PDF_HEADERS.length);
    expect(RECALLS_CANCELS_PDF_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)).toBe(RECALLS_CANCELS_PDF_TABLE_WIDTH);
    expect(RECALLS_CANCELS_PDF_TABLE_WIDTH).toBeLessThanOrEqual(269);
    expect(RECALLS_CANCELS_PDF_HEADERS).toEqual(expect.arrayContaining(['Status', 'Done date']));
  });

  it('uses concise, non-wrapping Excel headers with fixed compact dimensions', () => {
    expect(RECALLS_CANCELS_EXCEL_HEADERS).toEqual(RECALLS_CANCELS_PDF_HEADERS);
    expect(RECALLS_CANCELS_EXCEL_COLUMN_WIDTHS).toHaveLength(RECALLS_CANCELS_EXCEL_HEADERS.length);
    expect(EXCEL_HEADER_ROW_HEIGHT_POINTS).toBe(20);
  });
});