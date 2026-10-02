import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCredentialFetch } from './credentialTransport';

describe('credential transport', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ staffAuthToken: 'trusted-token' }) });
  });
  it('routes credential writes to the backend with the server session token', async () => {
    const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
    const wrapped = createCredentialFetch('https://example.test', 'anon', native);
    await wrapped('https://example.test/rest/v1/users?id=eq.user-id', {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ password: ' exact password ' }),
    });
    expect(native.mock.calls[0][0]).toBe('https://example.test/functions/v1/credential-auth');
    const body = JSON.parse((native.mock.calls[0] as any)[1].body);
    expect(body.token).toBe('trusted-token');
    expect(body.payload.password).toBe(' exact password ');
    expect(body.query).toBe('?id=eq.user-id');
  });
  it('does not change ordinary patient reads or clinical writes', async () => {
    const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
    const wrapped = createCredentialFetch('https://example.test', 'anon', native);
    await wrapped('https://example.test/rest/v1/patients?select=id');
    expect(native.mock.calls[0][0]).toBeInstanceOf(Request);
  });
  it('loads doctor profiles and relations without requesting restricted credentials', async () => {
    const native = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
    const wrapped = createCredentialFetch('https://example.test', 'anon', native);
    await wrapped('https://example.test/rest/v1/doctors?select=*,doctor_schedules(*),doctor_locations(location_id)&order=name.asc', {
      headers: { apikey: 'anon', Authorization: 'Bearer anon' },
    });
    const request = native.mock.calls[0][0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.get('select')).toContain('doctor_schedules(*),doctor_locations(location_id)');
    expect(url.searchParams.get('select')).not.toMatch(/^\*/);
    expect(url.searchParams.get('select')).not.toContain('password');
    expect(url.searchParams.get('order')).toBe('name.asc');
    expect(request.headers.get('apikey')).toBe('anon');
  });
});