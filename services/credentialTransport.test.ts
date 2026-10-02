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
});