import type { Patient } from '../types';

/**
 * Merge background patient batches into the currently loaded list without
 * duplicating records. Incoming records (which arrive in deterministic
 * `created_at DESC, id` order) are appended, except any that are already
 * present by id.
 */
export const mergePatientsById = (
  existing: Patient[],
  incoming: Patient[]
): Patient[] => {
  if (incoming.length === 0) return existing;
  const existingIds = new Set(existing.map((patient) => patient.id));
  const merged = [...existing];
  for (const patient of incoming) {
    if (!patient || !patient.id || existingIds.has(patient.id)) continue;
    existingIds.add(patient.id);
    merged.push(patient);
  }
  return merged;
};
