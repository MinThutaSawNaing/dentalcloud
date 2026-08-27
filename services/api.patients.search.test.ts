import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const queries: any[] = [];
  const state: any = { queries };

  const createQuery = (table: string) => {
    const query: any = {
      order: vi.fn(() => query),
      range: vi.fn(() => query),
      eq: vi.fn(() => query),
      or: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null }))
    };
    // Awaiting the builder resolves the query result like PostgREST does.
    query.then = (onFulfilled: (result: any) => any) =>
      Promise.resolve({ data: [], error: null }).then(onFulfilled);
    state.queries.push(query);
    return query;
  };

  state.from = vi.fn((table: string) => createQuery(table));

  return state;
});

vi.mock('./supabase', () => ({
  supabase: { from: supabaseMock.from },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

describe('patients.search', () => {
  beforeEach(() => {
    supabaseMock.queries.length = 0;
    supabaseMock.from.mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('builds an OR query across name, phone, email and patient_unique_id with location scoping', async () => {
    await api.patients.search('loc-123', 'aung', 100);

    expect(supabaseMock.from).toHaveBeenCalledWith('patients');
    const query = supabaseMock.queries[0];
    expect(query.eq).toHaveBeenCalledWith('location_id', 'loc-123');
    expect(query.or).toHaveBeenCalledWith(
      'name.ilike.%aung%,phone.ilike.%aung%,email.ilike.%aung%,patient_unique_id.ilike.%aung%',
      { foreignTable: 'patients' }
    );
    expect(query.range).toHaveBeenCalledWith(0, 99);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    await api.patients.search(undefined, '50%_off', 100);
    const query = supabaseMock.queries[0];
    expect(query.or).toHaveBeenCalledWith(
      'name.ilike.%50\\%\\_off%,phone.ilike.%50\\%\\_off%,email.ilike.%50\\%\\_off%,patient_unique_id.ilike.%50\\%\\_off%'
    );
  });

  it('skips the location filter when no location is provided', async () => {
    await api.patients.search(undefined, 'mg', 100);
    const query = supabaseMock.queries[0];
    expect(query.eq).not.toHaveBeenCalled();
    expect(query.or).toHaveBeenCalledWith(
      'name.ilike.%mg%,phone.ilike.%mg%,email.ilike.%mg%,patient_unique_id.ilike.%mg%'
    );
  });

  it('returns an empty array for a blank term without querying', async () => {
    const result = await api.patients.search('loc-123', '   ');
    expect(result).toEqual([]);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});


