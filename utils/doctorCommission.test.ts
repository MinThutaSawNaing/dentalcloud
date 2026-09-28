import { describe, expect, it } from 'vitest';
import {
  resolveDoctorCommissionType,
  usesFlatVisitCommission,
  singleMethodDoctorCommission,
  singleMethodCommissionRule,
  validateDoctorCommissionPercentage,
  validateDoctorCommissionPerVisit,
  validateDoctorCommissionType
} from './doctorCommission';

describe('doctor commission mode', () => {
  it('removes the inactive method at the doctor and rule levels', () => {
    expect(singleMethodDoctorCommission('percentage', 20, 500)).toEqual({ commission_percentage: 20, commission_per_visit: 0 });
    expect(singleMethodDoctorCommission('flat_visit', 20, 500)).toEqual({ commission_percentage: 0, commission_per_visit: 500 });
    expect(singleMethodCommissionRule('percentage', 25, 600)).toEqual({ commission_rate: 25, fixed_amount: null });
    expect(singleMethodCommissionRule('flat_visit', 25, 600)).toEqual({ commission_rate: 0, fixed_amount: 600 });
    expect(singleMethodCommissionRule('flat_visit', 25, null)).toEqual({ commission_rate: 0, fixed_amount: null });
    expect(singleMethodCommissionRule('flat_visit', 25, 0)).toEqual({ commission_rate: 0, fixed_amount: 0 });
  });
  it('uses the explicit percentage mode regardless of specialization', () => {
    expect(resolveDoctorCommissionType({
      commissionType: 'percentage',
      specialization: 'Surgery'
    })).toBe('percentage');
  });

  it('uses the explicit fixed mode for any custom specialization', () => {
    expect(usesFlatVisitCommission({
      commissionType: 'flat_visit',
      specialization: 'Pediatric Dentistry'
    })).toBe(true);
  });

  it('preserves legacy behavior only when commission_type is unavailable', () => {
    expect(resolveDoctorCommissionType({ specialization: 'Ortho' })).toBe('flat_visit');
    expect(resolveDoctorCommissionType({ specialization: 'General' })).toBe('percentage');
  });

  it('does not infer fixed mode from a custom specialization', () => {
    expect(resolveDoctorCommissionType({ specialization: 'Orthodontics' })).toBe('percentage');
  });

  it('rejects invalid supplied methods instead of silently inferring one', () => {
    expect(() => validateDoctorCommissionType('fixed')).toThrow('Commission method');
    expect(validateDoctorCommissionType('flat_visit')).toBe('flat_visit');
  });

  it('validates commission amount boundaries', () => {
    expect(validateDoctorCommissionPercentage(100)).toBe(100);
    expect(() => validateDoctorCommissionPercentage(100.01)).toThrow('between 0 and 100');
    expect(validateDoctorCommissionPerVisit(0)).toBe(0);
    expect(() => validateDoctorCommissionPerVisit(-1)).toThrow('non-negative');
    expect(() => validateDoctorCommissionPerVisit(Number.POSITIVE_INFINITY)).toThrow('non-negative');
  });
});