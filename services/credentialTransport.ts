// Only credential-bearing table mutations are routed through the trusted backend.
// Reads retain their existing PostgREST interface and never include credentials.
export function createCredentialFetch(baseUrl: string, anonKey: string, nativeFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const table = url.pathname.match(/^\/rest\/v1\/(users|doctors|patient_auth)$/)?.[1];
    if (table === 'doctors' && request.method === 'GET') {
      const select = url.searchParams.get('select');
      if (select?.startsWith('*')) {
        url.searchParams.set('select', 'id,location_id,name,email,phone,specialization,commission_percentage,commission_per_visit,commission_type,created_at' + select.slice(1));
        return nativeFetch(new Request(url, request));
      }
    }
    if (!table || !['POST', 'PATCH', 'DELETE'].includes(request.method)) return nativeFetch(request);
    let token: string | undefined;
    try {
      const session = JSON.parse(localStorage.getItem('dental_auth_session') || 'null');
      token = session?.staffAuthToken || session?.patientAuthToken;
    } catch { /* The server rejects missing/invalid tokens. */ }
    return nativeFetch(`${baseUrl}/functions/v1/credential-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ action: 'mutate', table, method: request.method,
        query: url.search, prefer: request.headers.get('prefer'),
        accept: request.headers.get('accept'), token,
        payload: request.method === 'DELETE' ? null : await request.json() }),
    });
  };
}