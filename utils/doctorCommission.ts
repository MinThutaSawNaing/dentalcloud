export type DoctorCommissionType = 'percentage' | 'flat_visit';

const LEGACY_FLAT_VISIT_SPECIALIZATIONS: readonly string[] = ['Ortho', 'Implant', 'Surgery'];

interface DoctorCommissionModeInput {
  commissionType?: string | null;
  specialization?: string | null;
}

/**
 * Explicit commission_type always wins. The specialization fallback only
 * preserves behavior while older rows/databases are being migrated.
 */
export const resolveDoctorCommissionType = ({
  commissionType,
  specialization
}: DoctorCommissionModeInput): DoctorCommissionType => {
  if (commissionType === 'flat_visit') return 'flat_visit';
  if (commissionType === 'percentage') return 'percentage';

  return LEGACY_FLAT_VISIT_SPECIALIZATIONS.includes((specialization || '').trim())
    ? 'flat_visit'
    : 'percentage';
};

export const usesFlatVisitCommission = (input: DoctorCommissionModeInput): boolean =>
  resolveDoctorCommissionType(input) === 'flat_visit';

export const validateDoctorCommissionType = (commissionType: unknown): DoctorCommissionType => {
  if (commissionType === 'percentage' || commissionType === 'flat_visit') return commissionType;
  throw new Error('Commission method must be percentage or flat_visit.');
};

export const validateDoctorCommissionPercentage = (value: unknown): number => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 100) {
    throw new Error('Commission percentage must be between 0 and 100.');
  }
  return numericValue;
};

export const validateDoctorCommissionPerVisit = (value: unknown): number => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error('Per-visit commission must be a valid non-negative amount.');
  }
  return numericValue;
};
