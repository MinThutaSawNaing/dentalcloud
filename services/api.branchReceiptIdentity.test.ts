import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn()
}));

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc, from: supabaseMock.from },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const identityRow = {
  location_id: 'branch-1',
  location_name: 'Downtown Clinic',
  location_address: '10 Main Road',
  location_phone: '09-111',
  receipt_header_title: 'Official Receipt',
  receipt_email: 'downtown@example.com',
  custom_receipt_header_title: 'Official Receipt',
  custom_receipt_email: 'downtown@example.com',
  settings_updated_at: '2026-09-04T00:00:00Z'
};

const tableChain = (data: unknown, error: unknown = null) => ({
  select: () => ({
    eq: () => ({
      maybeSingle: async () => ({ data, error })
    })
  })
});

describe('branchReceiptIdentity API', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.from.mockReset();
  });

  it('loads and normalizes the resolved identity for one branch', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [identityRow], error: null });

    await expect(api.branchReceiptIdentity.get('branch-1')).resolves.toMatchObject({
      locationId: 'branch-1',
      branchName: 'Downtown Clinic'
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_branch_receipt_identity', { p_location_id: 'branch-1' });
  });

  it('loads the detailed admin identity with the staff session token', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [identityRow], error: null });

    const identity = await api.branchReceiptIdentity.getForAdmin('branch-1', { authToken: 'session-token' });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_branch_receipt_identity_for_admin', {
      p_location_id: 'branch-1',
      p_session_token: 'session-token'
    });
    expect(identity).toMatchObject({
      customHeaderTitle: 'Official Receipt',
      customEmail: 'downtown@example.com',
      usesGlobalTitle: false,
      usesGlobalEmail: false,
      settingsUpdatedAt: '2026-09-04T00:00:00Z'
    });
  });

  it('fails the admin read before making a request when the session token is missing', async () => {
    await expect(api.branchReceiptIdentity.getForAdmin('branch-1', { authToken: '  ' }))
      .rejects.toThrow(/administrator session/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('saves through the secured RPC with the staff session token and expected timestamp', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [identityRow], error: null });

    await api.branchReceiptIdentity.save(
      'branch-1',
      { headerTitle: ' Official Receipt ', email: ' Downtown@Example.com ' },
      { userId: 'admin-1', authToken: 'session-token' },
      '2026-09-04T00:00:00Z'
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith('save_branch_receipt_identity', {
      p_location_id: 'branch-1',
      p_receipt_header_title: 'Official Receipt',
      p_receipt_email: 'downtown@example.com',
      p_session_token: 'session-token',
      p_expected_updated_at: '2026-09-04T00:00:00Z'
    });
  });

  it('sends a null expected timestamp on the first save for a branch', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [identityRow], error: null });

    await api.branchReceiptIdentity.save(
      'branch-1',
      { headerTitle: 'Official Receipt', email: '' },
      { userId: 'admin-1', authToken: 'session-token' },
      null
    );

    expect(supabaseMock.rpc).toHaveBeenCalledWith('save_branch_receipt_identity', expect.objectContaining({
      p_expected_updated_at: null
    }));
  });

  it('fails before making a request when the administrator session is missing', async () => {
    await expect(api.branchReceiptIdentity.save(
      'branch-1',
      { headerTitle: '', email: '' },
      { userId: 'admin-1', authToken: '' }
    )).rejects.toThrow(/administrator session/i);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('falls back to canonical location plus legacy global settings for reads when the RPC is unavailable', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === 'locations') {
        return tableChain({ id: 'branch-9', name: ' Mandalar Clinic ', address: ' 12 Hill Rd ', phone: '09-888' });
      }
      return tableChain({ app_name: 'DentalCloud', receipt_header_title: 'Global Receipt', receipt_email: 'global@example.com' });
    });

    const identity = await api.branchReceiptIdentity.get('branch-9');

    expect(identity).toEqual({
      locationId: 'branch-9',
      branchName: 'Mandalar Clinic',
      address: '12 Hill Rd',
      phone: '09-888',
      headerTitle: 'Global Receipt',
      email: 'global@example.com',
      customHeaderTitle: '',
      customEmail: '',
      usesGlobalTitle: true,
      usesGlobalEmail: true,
      settingsUpdatedAt: null
    });
  });

  it('keeps save writes failing closed when the RPC is unavailable', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function not found' } });

    await expect(api.branchReceiptIdentity.save(
      'branch-1',
      { headerTitle: 'Official Receipt', email: '' },
      { userId: 'admin-1', authToken: 'session-token' }
    )).rejects.toThrow(/migration/i);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });
});