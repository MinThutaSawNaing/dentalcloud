import { supabase } from './supabase';

export async function secureAuthRequest<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('credential-auth', {
    body: { action, ...payload },
  });
  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      const failure = await context.json().catch(() => null);
      if (typeof failure?.error === 'string') throw new Error(failure.error);
    }
    // Never represent backend/network failures as incorrect credentials.
    throw new Error('Unable to contact secure login. Please try again.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}