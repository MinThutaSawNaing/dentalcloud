import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

// The provider credential is decrypted only inside this function. It is never
// sent to the browser, returned in a response body, or written to logs.
const providerUrl = Deno.env.get('AI_PROVIDER_URL') || 'https://api.apifree.ai/v1/chat/completions';
const defaultModel = 'deepseek-ai/deepseek-v3.2';
const maxBodyBytes = 220_000;
const maxMessages = 60;
const maxMessageChars = 24_000;
const maxTotalChars = 120_000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function rest(path: string, method = 'GET', body?: unknown): Promise<Response> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Database operation failed');
  return response;
}

async function rpc(name: string, body: unknown): Promise<unknown> {
  const text = await (await rest(`rpc/${name}`, 'POST', body)).text();
  return text ? JSON.parse(text) : null;
}

type Actor = {
  kind?: string;
  id?: string;
  role?: string;
  allowed_tabs?: string[];
};

async function authenticate(token: unknown): Promise<Actor | null> {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/.test(token)) return null;
  const actor = await rpc('secure_auth_validate', { p_token: token }) as Actor | null;
  return actor && actor.kind === 'staff' ? actor : null;
}

function staffMayUseAi(actor: Actor): boolean {
  if (actor.role === 'admin') return true;
  return Array.isArray(actor.allowed_tabs) && actor.allowed_tabs.includes('ai-assistant');
}

const encoder = new TextEncoder();

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// key_version 2 uses a dedicated 32-byte AI_SETTINGS_ENCRYPTION_KEY when the
// deployment provides one. Version 1 is an HKDF-derived subkey of the service
// role secret so existing deployments remain functional without a new secret.
async function encryptionKey(version: number): Promise<CryptoKey> {
  let material: Uint8Array;
  if (version === 2) {
    const dedicated = Deno.env.get('AI_SETTINGS_ENCRYPTION_KEY') || '';
    material = decodeBase64(dedicated);
    if (material.length !== 32) throw new Error('Invalid encryption key');
  } else {
    const source = await crypto.subtle.importKey(
      'raw', encoder.encode(serviceRoleKey), 'HKDF', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('dentalcloud-ai-settings'),
      info: encoder.encode('ai-assistant-settings-v1')
    }, source, 256);
    material = new Uint8Array(bits);
  }
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function activeKeyVersion(): number {
  return Deno.env.get('AI_SETTINGS_ENCRYPTION_KEY') ? 2 : 1;
}

const additionalData = encoder.encode('ai-assistant-config:v1');

async function encryptSecret(value: string): Promise<{ ciphertext: string; iv: string; keyVersion: number }> {
  const keyVersion = activeKeyVersion();
  const key = await encryptionKey(keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    encoder.encode(value)
  );
  return { ciphertext: encodeBase64(new Uint8Array(ciphertext)), iv: encodeBase64(iv), keyVersion };
}

async function decryptSecret(ciphertext: string, iv: string, keyVersion: number): Promise<string> {
  const key = await encryptionKey(keyVersion);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(iv), additionalData },
    key,
    decodeBase64(ciphertext)
  );
  return new TextDecoder().decode(plaintext);
}

type StoredConfig = {
  api_key_ciphertext: string;
  api_key_iv: string;
  key_version: number;
  model: string;
  updated_at: string;
};

async function loadConfig(): Promise<StoredConfig | null> {
  return await rpc('ai_assistant_config_get', {}) as StoredConfig | null;
}

class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

function normalizeApiKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 8 || key.length > 4096 || /\s/.test(key)) {
    throw new RequestError('Enter a valid AI API key.');
  }
  return key;
}

function normalizeModel(value: unknown): string {
  const model = typeof value === 'string' && value.trim() ? value.trim() : defaultModel;
  if (model.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]*$/.test(model)) {
    throw new RequestError('Enter a valid AI model name.');
  }
  return model;
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxMessages) {
    throw new RequestError('Invalid AI conversation.');
  }
  const roles = new Set(['system', 'user', 'assistant']);
  const messages: ChatMessage[] = [];
  let total = 0;
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new RequestError('Invalid AI conversation.');
    const record = item as Record<string, unknown>;
    const role = typeof record.role === 'string' ? record.role : '';
    const content = typeof record.content === 'string' ? record.content : '';
    if (!roles.has(role) || content.length === 0 || content.length > maxMessageChars) {
      throw new RequestError('Invalid AI conversation.');
    }
    total += content.length;
    if (total > maxTotalChars) throw new RequestError('AI conversation is too long.');
    messages.push({ role: role as ChatMessage['role'], content });
  }
  if (!messages.some(message => message.role === 'user')) {
    throw new RequestError('Invalid AI conversation.');
  }
  return messages;
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

async function callProvider(apiKey: string, payload: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  data: any;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(providerUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

type ProviderFailure = { status: number; message: string };

// The provider can return HTTP 200 with a JSON error envelope. Treat that as a
// failure instead of reporting a broken key as healthy.
function providerFailure(data: any, httpStatus: number): ProviderFailure | null {
  const code = typeof data?.code === 'number' ? data.code : null;
  if (data && data.error) {
    const authenticationError = code === 401 || code === 403 || data.error?.type === 'authentication_error';
    return {
      status: authenticationError ? 401 : code && code >= 400 ? code : httpStatus,
      message: authenticationError
        ? 'The AI provider rejected the saved key.'
        : 'The AI provider rejected the request.'
    };
  }
  if (code && code >= 400) {
    return { status: code, message: 'The AI provider rejected the request.' };
  }
  return null;
}

async function readSecret(config: StoredConfig): Promise<string> {
  try {
    return await decryptSecret(config.api_key_ciphertext, config.api_key_iv, config.key_version);
  } catch {
    throw new RequestError('The saved AI key could not be read. Save it again in Settings.', 409);
  }
}

async function statusPayload(): Promise<Record<string, unknown>> {
  const config = await loadConfig();
  return config
    ? { configured: true, model: config.model, updated_at: config.updated_at }
    : { configured: false, model: defaultModel, updated_at: null };
}


async function handleSave(actor: Actor, body: Record<string, unknown>): Promise<Response> {
  let apiKey: string;
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    apiKey = normalizeApiKey(body.apiKey);
  } else {
    const existing = await loadConfig();
    if (!existing) throw new RequestError('Enter an AI API key.');
    apiKey = await readSecret(existing);
  }
  const model = normalizeModel(body.model);
  const encrypted = await encryptSecret(apiKey);
  const result = await rpc('ai_assistant_config_put', {
    p_ciphertext: encrypted.ciphertext,
    p_iv: encrypted.iv,
    p_key_version: encrypted.keyVersion,
    p_model: model,
    p_actor: actor.id
  }) as { model?: string; updated_at?: string } | null;
  return reply({
    configured: true,
    model: result?.model || model,
    updated_at: result?.updated_at || null
  });
}

async function handleRemove(actor: Actor): Promise<Response> {
  await rpc('ai_assistant_config_delete', { p_actor: actor.id });
  return reply({ configured: false, model: defaultModel, updated_at: null });
}

async function handleTest(actor: Actor): Promise<Response> {
  const config = await loadConfig();
  if (!config) throw new RequestError('AI Assistant is not configured yet.', 409);
  const allowed = await rpc('ai_assistant_rate_limit', {
    p_key: `test:${actor.id}`,
    p_limit: 5,
    p_seconds: 60
  });
  if (!allowed) throw new RequestError('Too many connection tests. Please wait a moment.', 429);
  const apiKey = await readSecret(config);
  const result = await callProvider(apiKey, {
    model: config.model,
    messages: [{ role: 'user', content: 'Reply with OK.' }],
    temperature: 0,
    max_tokens: 8,
    top_p: 1,
    stream: false
  });
  const failure = result.ok ? providerFailure(result.data, result.status) : {
    status: result.status,
    message: result.status === 401 || result.status === 403
      ? 'The AI provider rejected the saved key.'
      : 'The AI provider could not complete this request.'
  };
  if (failure) {
    return reply({ error: failure.message, providerStatus: failure.status }, 502);
  }
  const content = result.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return reply({ error: 'The AI provider returned an invalid response.' }, 502);
  }
  return reply({ success: true, model: config.model });
}

async function handleComplete(actor: Actor, body: Record<string, unknown>): Promise<Response> {
  const config = await loadConfig();
  if (!config) {
    throw new RequestError('AI Assistant is not configured. Ask an administrator to add the API key in Settings.', 409);
  }
  const allowed = await rpc('ai_assistant_rate_limit', {
    p_key: `complete:${actor.id}`,
    p_limit: 30,
    p_seconds: 60
  });
  if (!allowed) throw new RequestError('Too many AI requests. Please wait a moment and try again.', 429);

  const messages = normalizeMessages(body.messages);
  const apiKey = await readSecret(config);
  const result = await callProvider(apiKey, {
    model: config.model,
    messages,
    temperature: numberInRange(body.temperature, 0, 2, 0.7),
    max_tokens: Math.round(numberInRange(body.max_tokens, 1, 12_000, 2_000)),
    top_p: numberInRange(body.top_p, 0, 1, 0.9),
    stream: false
  });

  const failure = result.ok ? providerFailure(result.data, result.status) : {
    status: result.status,
    message: 'The AI provider could not complete this request.'
  };
  if (failure) {
    return reply({ error: failure.message, providerStatus: failure.status }, 502);
  }
  const content = result.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return reply({ error: 'The AI provider returned an invalid response.' }, 502);
  }
  return reply(result.data);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);

  try {
    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (declaredLength > maxBodyBytes) return reply({ error: 'Request is too large.' }, 413);
    const raw = await req.text();
    if (raw.length > maxBodyBytes) return reply({ error: 'Request is too large.' }, 413);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply({ error: 'Invalid request.' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return reply({ error: 'Invalid request.' }, 400);
    }

    const actor = await authenticate(body.token);
    if (!actor) return reply({ error: 'Sign in required.' }, 401);
    if (!staffMayUseAi(actor)) {
      return reply({ error: 'AI Assistant permission is required.' }, 403);
    }

    const action = typeof body.action === 'string' ? body.action : '';
    if (action === 'status') return reply(await statusPayload());
    if (action === 'complete') return await handleComplete(actor, body);
    if (actor.role !== 'admin') {
      return reply({ error: 'Administrator permission required.' }, 403);
    }
    if (action === 'save') return await handleSave(actor, body);
    if (action === 'remove') return await handleRemove(actor);
    if (action === 'test') return await handleTest(actor);
    return reply({ error: 'Unknown action.' }, 400);
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    // Deliberately suppress error details; runtime errors can contain URLs or tokens.
    console.error('AI assistant request failed.');
    return reply({ error: 'AI service is temporarily unavailable. Please try again.' }, 503);
  }
});
