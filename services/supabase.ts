import { createClient } from '@supabase/supabase-js';
import { createCredentialFetch } from './credentialTransport';

// Configuration with hardcoded keys to ensure immediate connectivity
const SUPABASE_URL = 'https://supabasemydentist.dentalcloud.asia';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzgwOTc2NzQ3LCJleHAiOjE5Mzg2NTY3NDd9.TjyBqYBFs0QhJBTEMdJ-FkoxxHuOHSfbRzVC9356l64';

// Create client with proper configuration for Supabase Auth
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  global: { fetch: createCredentialFetch(SUPABASE_URL, SUPABASE_ANON_KEY, (input, init) => fetch(input, init)) },
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'dental_supabase_auth'
  },
  db: {
    schema: 'public'
  }
});

// Export URL and key for reference
export const supabaseUrl = SUPABASE_URL;
export const supabaseAnonKey = SUPABASE_ANON_KEY;