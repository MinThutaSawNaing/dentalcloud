import { describe, expect, it } from 'vitest';
import { getMlsStageFraction, getMlsSyncPercentage } from './mlsSyncProgress';

describe('MLS measured stage progress', () => {
  it('reserves space for financial checks instead of stalling at 99 after download', () => {
    expect(getMlsSyncPercentage([0, 0, 0, 0, 0, 0])).toBe(0);
    expect(getMlsSyncPercentage([1, 1, 0, 0, 0, 0])).toBe(33);
    expect(getMlsSyncPercentage([1, 1, 0.5, 0.5, 1, 0.5])).toBe(75);
    expect(getMlsSyncPercentage([1, 1, 1, 1, 1, 1])).toBe(99);
  });

  it('uses exact completed/total units and handles empty or unknown stages', () => {
    expect(getMlsStageFraction(3, 6)).toBe(0.5);
    expect(getMlsStageFraction(0, 0)).toBe(1);
    expect(getMlsStageFraction(10, null)).toBe(0);
    expect(getMlsStageFraction(101, 100)).toBe(1);
  });
});