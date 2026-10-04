import { describe, expect, it } from 'vitest';
import { getHistorySyncPercentage } from './historySyncProgress';

describe('history sync percentage', () => {
  it('stays indeterminate until unfinished reads have real totals', () => {
    expect(getHistorySyncPercentage([
      { loaded: 1000, total: 2000, done: false },
      { loaded: 0, total: null, done: false }
    ])).toBeNull();
  });
  it('uses completed rows equally weighted across the two datasets', () => {
    expect(getHistorySyncPercentage([
      { loaded: 1000, total: 2000, done: false },
      { loaded: 200, total: 1000, done: false }
    ])).toBe(35);
  });
  it('never reaches 100 before mapping and enrichment finish', () => {
    expect(getHistorySyncPercentage([
      { loaded: 1000, total: 1000, done: false },
      { loaded: 0, total: 0, done: true }
    ])).toBe(99);
  });
  it('handles empty datasets, unknown completed totals, and concurrent inserts', () => {
    expect(getHistorySyncPercentage([
      { loaded: 0, total: 0, done: false },
      { loaded: 1100, total: 1000, done: false }
    ])).toBe(99);
    expect(getHistorySyncPercentage([
      { loaded: 0, total: null, done: true },
      { loaded: 10, total: null, done: true }
    ])).toBe(100);
  });
});