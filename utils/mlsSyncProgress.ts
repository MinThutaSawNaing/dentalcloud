export type MlsEnrichmentStage = 'commission' | 'cost-audits' | 'cost-items';
export type MlsEnrichmentProgress = (stage: MlsEnrichmentStage, completed: number, total: number) => void;

// Equal weight for six measurable stages, not elapsed time. Unknown work is 0;
// empty stages finish immediately. Publication alone is allowed to reach 100%.
export const getMlsSyncPercentage = (fractions: number[]): number =>
  Math.min(99, Math.floor(fractions.reduce((sum, value) =>
    sum + Math.max(0, Math.min(1, value)), 0) / fractions.length * 100));

export const getMlsStageFraction = (completed: number, total: number | null): number =>
  total === null ? 0 : total === 0 ? 1 : Math.min(1, completed / total);