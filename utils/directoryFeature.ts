/** Database-filtered MLS/audit directories are pending rollout; only exact opt-in enables them. */
export const parseDatabaseFilteredDirectories = (value: unknown): boolean => value === 'true';

export const databaseFilteredDirectories = parseDatabaseFilteredDirectories(
  import.meta.env.VITE_DATABASE_FILTERED_DIRECTORIES
);
