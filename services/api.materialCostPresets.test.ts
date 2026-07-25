import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc };
});

vi.mock('./supabase', () => ({
  supabase: { rpc: supabaseMock.rpc },
  supabaseUrl: '',
  supabaseAnonKey: ''
}));

import { api } from './api';

const actor = { userId: '11111111-1111-4111-8111-111111111111', authToken: 'session-token' };
const presetId = '22222222-2222-4222-8222-222222222222';

describe('api.materialCosts presets', () => {
  beforeEach(() => supabaseMock.rpc.mockReset());

  it('loads, maps, and sorts secured presets with their revision', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        revision: 4,
        presets: [
          { id: presetId, cost_type: 'lab', label: 'Crown Lab', amount: '300.50', sort_order: 1 },
          { id: actor.userId, cost_type: 'material', label: 'Composite', amount: '20', sort_order: 0 }
        ]
      },
      error: null
    });

    const result = await api.materialCosts.getPresets(actor);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_material_lab_cost_presets', {
      p_user_id: actor.userId,
      p_session_token: actor.authToken
    });
    expect(result.revision).toBe(4);
    expect(result.presets.map((preset) => preset.label)).toEqual(['Composite', 'Crown Lab']);
    expect(result.presets[1]).toMatchObject({ costType: 'lab', amount: 300.5 });
  });

  it('normalizes and replaces the complete list with optimistic concurrency', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: { revision: 8, presets: [] }, error: null });

    await api.materialCosts.replacePresets([
      { id: presetId, costType: 'lab', label: ' Crown Lab ', amount: 300.129, sortOrder: 99 }
    ], 7, actor);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('replace_material_lab_cost_presets', {
      p_items: [{ id: presetId, cost_type: 'lab', label: 'Crown Lab', amount: 300.13, sort_order: 0 }],
      p_expected_revision: 7,
      p_user_id: actor.userId,
      p_session_token: actor.authToken
    });
  });

  it('provides actionable missing-migration and concurrency errors', async () => {
    supabaseMock.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find get_material_lab_cost_presets in the schema cache' } });
    await expect(api.materialCosts.getPresets(actor)).rejects.toThrow('material_lab_cost_presets_migration.sql');

    supabaseMock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Preset list changed on another device.' } });
    await expect(api.materialCosts.replacePresets([], 1, actor)).rejects.toThrow('Reload presets');
  });

  it('does not misclassify authorization failures as missing migrations', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'get_material_lab_cost_presets: A valid staff session is required.' }
    });

    await expect(api.materialCosts.getPresets(actor)).rejects.toThrow('valid staff session');
    await expect(api.materialCosts.getPresets(actor)).rejects.not.toThrow('not installed');
  });
});