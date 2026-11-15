import { supabase } from './supabase';
import { auth } from './auth';

export const DEFAULT_AI_MODEL = 'deepseek-ai/deepseek-v3.2';
export const AI_ASSISTANT_SETTINGS_EVENT = 'ai-assistant-settings-updated';

export interface AiAssistantStatus {
  configured: boolean;
  model: string;
  updated_at: string | null;
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  messages: AiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
}

export interface AiCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  [key: string]: unknown;
}

type AiAction = 'status' | 'save' | 'remove' | 'test' | 'complete';

const invoke = async <T>(action: AiAction, payload: Record<string, unknown> = {}): Promise<T> => {
  const token = auth.getSession()?.staffAuthToken;
  if (!token) throw new Error('Sign in required.');

  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: { action, token, ...payload }
  });

  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      const failure = await context.json().catch(() => null);
      if (typeof failure?.error === 'string') throw new Error(failure.error);
    }
    throw new Error('Unable to contact the AI service. Please try again.');
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
};

export const notifyAiSettingsUpdated = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AI_ASSISTANT_SETTINGS_EVENT));
  }
};

export const aiAssistant = {
  // Status never contains the API key or its ciphertext.
  getStatus: (): Promise<AiAssistantStatus> => invoke<AiAssistantStatus>('status'),

  // An empty apiKey keeps the currently saved key and only updates the model.
  saveSettings: (apiKey: string, model: string = DEFAULT_AI_MODEL): Promise<AiAssistantStatus> =>
    invoke<AiAssistantStatus>('save', { apiKey, model }),

  removeSettings: (): Promise<AiAssistantStatus> => invoke<AiAssistantStatus>('remove'),

  testConnection: (): Promise<{ success: boolean; model: string }> =>
    invoke<{ success: boolean; model: string }>('test'),

  // All provider traffic is proxied by the backend; the browser never holds a key.
  createCompletion: (request: AiCompletionRequest): Promise<AiCompletionResponse> =>
    invoke<AiCompletionResponse>('complete', { ...request })
};
