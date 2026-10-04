export interface HistoryReadProgress {
  loaded: number;
  total: number | null;
  done: boolean;
}

// Equal weight per dataset. This is row-download progress, not elapsed time.
// Mapping/enrichment must finish before the overall sync can reach 100%.
export const getHistorySyncPercentage = (reads: HistoryReadProgress[]): number | null => {
  if (reads.every((read) => read.done)) return 100;
  if (reads.some((read) => !read.done && read.total === null)) return null;
  const fraction = reads.reduce((sum, read) => sum + (read.done ? 1
    : read.total === 0 ? 1 : Math.min(1, read.loaded / Math.max(1, read.total!))), 0) / reads.length;
  return Math.min(99, Math.floor(fraction * 100));
};