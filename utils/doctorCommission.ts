export const DOCTOR_SPECIALIZATIONS = ['General', 'Ortho', 'Implant', 'Surgery', 'Specialists'] as const;

export const FLAT_VISIT_COMMISSION_SPECIALIZATIONS: readonly string[] = ['Ortho', 'Implant', 'Surgery'];

export const usesFlatVisitCommission = (specialization?: string | null) =>
  FLAT_VISIT_COMMISSION_SPECIALIZATIONS.includes((specialization || '').trim());
