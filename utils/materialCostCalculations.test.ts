import { describe, expect, it } from 'vitest';

import type { ClinicalRecord } from '../types';
import {
  calculateMaterialAdjustedDoctorEarnings,
  calculateMaterialNetProfit
} from './materialCostCalculations';

const treatment = (overrides: Partial<ClinicalRecord> = {}): ClinicalRecord => ({
  id: 'treatment-1',
  location_id: 'location-1',
  patient_id: 'patient-1',
  teeth: [],
  description: 'Scaling',
  cost: 100_000,
  date: '2026-07-13',
  doctorEarnings: 40_000,
  ...overrides
});

describe('material cost calculations', () => {
  it('uses persisted payment-based doctor earnings for material cost reporting', () => {
    const record = treatment({
      doctor_specialization: 'General',
      doctor_commission_percentage: 40,
      doctorEarnings: 18_000
    });
    const materialCost = () => 10_000;

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(18_000);
    expect(calculateMaterialNetProfit([record], materialCost)).toBe(72_000);
  });

  it('keeps flat per-visit commission unchanged', () => {
    const record = treatment({
      doctor_specialization: 'Ortho',
      doctor_commission_percentage: 40,
      doctor_commission_per_visit: 15_000
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(40_000);
    expect(calculateMaterialNetProfit([record], () => 10_000)).toBe(50_000);
  });

  it('uses the stored flat earning after payment recalculation', () => {
    const record = treatment({
      doctor_specialization: 'Ortho',
      doctor_commission_percentage: 40,
      doctor_commission_per_visit: 15_000,
      doctorEarnings: 15_000
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(15_000);
    expect(calculateMaterialNetProfit([record], () => 10_000)).toBe(75_000);
  });

  it('uses stored earnings even when commission settings are unavailable', () => {
    const record = treatment({ doctor_commission_percentage: null });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(40_000);
    expect(calculateMaterialNetProfit([record], () => 25_000)).toBe(35_000);
  });

  it('supports zero stored earnings after core recalculation clamps a negative commission base', () => {
    const record = treatment({
      doctor_specialization: 'General',
      doctor_commission_percentage: 40,
      doctorEarnings: 0
    });

    expect(calculateMaterialAdjustedDoctorEarnings([record])).toBe(0);
    expect(calculateMaterialNetProfit([record], () => 120_000)).toBe(-20_000);
  });
});
