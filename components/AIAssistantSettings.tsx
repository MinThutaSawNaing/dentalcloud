import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
  PlugZap,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2
} from 'lucide-react';
import {
  AI_ASSISTANT_SETTINGS_EVENT,
  DEFAULT_AI_MODEL,
  aiAssistant,
  notifyAiSettingsUpdated,
  type AiAssistantStatus
} from '../services/aiAssistant';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

const formatUpdatedAt = (value: string | null): string => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
};

const AIAssistantSettings: React.FC = () => {
  const [status, setStatus] = useState<AiAssistantStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(DEFAULT_AI_MODEL);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await aiAssistant.getStatus();
      setStatus(next);
      setModel(next.model || DEFAULT_AI_MODEL);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load AI settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const handleUpdate = () => { void loadStatus(); };
    window.addEventListener(AI_ASSISTANT_SETTINGS_EVENT, handleUpdate);
    return () => window.removeEventListener(AI_ASSISTANT_SETTINGS_EVENT, handleUpdate);
  }, [loadStatus]);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback(null);
    if (!apiKey.trim() && !status?.configured) {
      setFeedback({ tone: 'error', text: 'Enter an AI API key.' });
      return;
    }
    setSaving(true);
    try {
      const next = await aiAssistant.saveSettings(apiKey.trim(), model.trim() || DEFAULT_AI_MODEL);
      setStatus(next);
      setModel(next.model || DEFAULT_AI_MODEL);
      setApiKey('');
      setFeedback({ tone: 'success', text: 'Saved. All users can now use the AI Assistant.' });
      notifyAiSettingsUpdated();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to save AI settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setFeedback(null);
    setTesting(true);
    try {
      await aiAssistant.testConnection();
      setFeedback({ tone: 'success', text: 'Connection successful. The saved key works.' });
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Connection test failed.' });
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    if (!window.confirm('Remove the shared AI API key? The AI Assistant will return to mock mode for everyone.')) {
      return;
    }
    setFeedback(null);
    setRemoving(true);
    try {
      const next = await aiAssistant.removeSettings();
      setStatus(next);
      setModel(next.model || DEFAULT_AI_MODEL);
      setApiKey('');
      setFeedback({ tone: 'success', text: 'The shared AI API key was removed.' });
      notifyAiSettingsUpdated();
    } catch (error) {
      setFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to remove AI settings.' });
    } finally {
      setRemoving(false);
    }
  };

  const updatedAt = formatUpdatedAt(status?.updated_at || null);
  return (
    <div className="space-y-6">
      <div className="border border-gray-200 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-800">AI Assistant</h3>
        </div>
        <p className="text-sm text-gray-600">
          One shared AI configuration applies to every user, device and branch. Users never see or enter the API key.
        </p>

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> Loading current configuration...
          </div>
        )}

        {loadError && !loading && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex items-start gap-2">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p>{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadStatus()}
                  className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {status && !loading && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Status</div>
              <div className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${status.configured ? 'text-emerald-700' : 'text-amber-700'}`}>
                {status.configured ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {status.configured ? 'Configured' : 'Not configured'}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Model</div>
              <div className="mt-1 break-all text-sm font-semibold text-gray-800">{status.model}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Last updated</div>
              <div className="mt-1 text-sm font-semibold text-gray-800">{updatedAt || 'Never'}</div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-800">Shared API Key</h3>
        </div>

        <div>
          <label htmlFor="ai-assistant-api-key" className="block text-sm font-medium text-gray-700 mb-1">
            AI provider API key
          </label>
          <input
            id="ai-assistant-api-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={status?.configured ? 'Saved key is hidden. Enter a new key to replace it.' : 'Enter the API key'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            The key is encrypted before storage and is never displayed again. Leave this blank to keep the saved key and only update the model.
          </p>
        </div>

        <div>
          <label htmlFor="ai-assistant-model" className="block text-sm font-medium text-gray-700 mb-1">
            AI model
          </label>
          <input
            id="ai-assistant-model"
            type="text"
            spellCheck={false}
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder={DEFAULT_AI_MODEL}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>


        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || testing || removing}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={!status?.configured || testing || saving || removing}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing ? <Loader2 size={16} className="animate-spin" /> : <PlugZap size={16} />}
            {testing ? 'Testing...' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={() => void handleRemove()}
            disabled={!status?.configured || removing || saving || testing}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {removing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {removing ? 'Removing...' : 'Remove key'}
          </button>
        </div>

        {feedback && (
          <p
            role="status"
            className={`text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}
          >
            {feedback.text}
          </p>
        )}
      </form>

      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-700 mt-0.5" />
          <div className="text-sm text-emerald-900">
            <p className="font-semibold">How the key is protected</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-emerald-800">
              <li>Encrypted with AES-256-GCM before it is written to the database.</li>
              <li>Only the backend AI service can decrypt it; browsers and ordinary API reads never receive it.</li>
              <li>Every AI request requires a valid staff session, AI Assistant permission, and a server-side rate limit.</li>
              <li>Only administrators can save, test or remove the shared key.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIAssistantSettings;

