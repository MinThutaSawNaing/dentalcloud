import { describe, expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({ config: null as any }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((_url, _key, config) => { captured.config = config; return {}; }),
}));
import './supabase';

describe('production Supabase credential transport wiring', () => {
  it('installs safe doctor reads on the actual client configuration', async () => {
    const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
    vi.stubGlobal('fetch', native);
    expect(captured.config.global?.fetch).toBeTypeOf('function');
    await captured.config.global.fetch('https://supabasemydentist.dentalcloud.asia/rest/v1/doctors?select=*');
    const request = native.mock.calls[0]?.[0] as unknown as Request;
    expect(new URL(request.url).searchParams.get('select')).toContain('name');
    expect(new URL(request.url).searchParams.get('select')).not.toContain('password');
    expect(new URL(request.url).searchParams.get('select')).not.toBe('*');
  });
});