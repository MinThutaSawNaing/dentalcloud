import { describe, expect, it } from 'vitest';
import type { Patient } from '../types';
import { mergePatientsById } from './patientMerge';

const makePatient = (id: string, created_at: string): Patient => ({
  id,
  name: `Patient ${id}`,
  email: '',
  phone: '',
  location_id: 'loc-1',
  balance: 0,
  loyalty_points: 0,
  created_at
});

describe('mergePatientsById', () => {
  it('appends unique incoming patients', () => {
    const existing = [makePatient('a', '2026-01-01')];
    const incoming = [makePatient('b', '2025-01-01'), makePatient('c', '2025-01-02')];
    expect(mergePatientsById(existing, incoming).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not duplicate patients already present', () => {
    const existing = [makePatient('a', '2026-01-01'), makePatient('b', '2025-01-01')];
    const incoming = [makePatient('b', '2025-01-01'), makePatient('c', '2025-01-02')];
    expect(mergePatientsById(existing, incoming).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves the incoming order for new patients', () => {
    const incoming = [makePatient('b', '2025-01-01'), makePatient('c', '2025-01-02'), makePatient('d', '2025-01-03')];
    expect(mergePatientsById([], incoming).map((p) => p.id)).toEqual(['b', 'c', 'd']);
  });

  it('ignores incoming records without an id', () => {
    const malformed = { name: 'No id', balance: 0 } as unknown as Patient;
    const existing = [makePatient('a', '2026-01-01')];
    expect(mergePatientsById(existing, [malformed]).map((p) => p.id)).toEqual(['a']);
  });

  it('returns the existing array when incoming is empty', () => {
    const existing = [makePatient('a', '2026-01-01')];
    expect(mergePatientsById(existing, [])).toBe(existing);
  });
});
