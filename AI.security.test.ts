import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');

const aiView = read('./components/AIAssistantView.tsx');
const settingsView = read('./components/SettingsView.tsx');
const settingsPanel = read('./components/AIAssistantSettings.tsx');
const service = read('./services/aiAssistant.ts');
const edgeFunction = read('./supabase/functions/ai-assistant/index.ts');
const viteConfig = read('./vite.config.ts');
const migration = read('./database/ai_assistant_secure_settings.sql');
const supabaseMigration = read('./supabase/migrations/20261115000000_ai_assistant_secure_settings.sql');

describe('AI assistant credential security guards', () => {
  it('never injects an AI provider key into the frontend bundle', () => {
    expect(viteConfig).not.toContain('AI_API_KEY');
    expect(viteConfig).not.toContain('loadEnv');
    expect(aiView).not.toContain('process.env.AI_API_KEY');
    expect(aiView).not.toContain('MOCK_API_KEY');
    expect(aiView).not.toContain('api.apifree.ai');
    expect(aiView).not.toContain('Bearer ${apiKey}');
  });

  it('routes every browser AI completion through the backend function', () => {
    expect(service).toContain("supabase.functions.invoke('ai-assistant'");
    expect(service).toContain("invoke<AiAssistantStatus>('status')");
    expect(service).toContain("invoke<AiAssistantStatus>('save'");
    expect(service).toContain("invoke<{ success: boolean; model: string }>('test')");
    expect(service).toContain("invoke<AiCompletionResponse>('complete'");
    const completions = aiView.match(/aiAssistant\.createCompletion\(/g) || [];
    expect(completions.length).toBeGreaterThanOrEqual(3);
    expect(aiView).not.toMatch(/fetch\(\s*`https:\/\/api\./);
  });

  it('exposes AI settings only to administrators', () => {
    expect(settingsView).toContain("id: 'ai', label: 'AI Assistant'");
    expect(settingsView).toMatch(/id: 'ai'[^\n]*adminOnly: true/);
    expect(settingsView).toContain("{activeTab === 'ai' && <AIAssistantSettings />}");
    expect(settingsPanel).toContain("type=\"password\"");
    expect(settingsPanel).toContain('autoComplete="new-password"');
    expect(settingsPanel).not.toContain('status.apiKey');
  });

  it('encrypts on the server and restricts configuration actions to admins', () => {
    expect(edgeFunction).toContain("name: 'AES-GCM'");
    expect(edgeFunction).toContain('crypto.subtle.encrypt');
    expect(edgeFunction).toContain('crypto.subtle.decrypt');
    expect(edgeFunction).toContain("if (actor.role !== 'admin')");
    expect(edgeFunction).toContain("action === 'save'");
    expect(edgeFunction).toContain("action === 'remove'");
    expect(edgeFunction).toContain("action === 'test'");
    expect(edgeFunction).toContain('ai_assistant_rate_limit');
    expect(edgeFunction).not.toMatch(/reply\(\{[^}]*apiKey/);
    expect(edgeFunction).not.toMatch(/console\.(log|error)\([^)]*(token|apiKey|ciphertext)/i);
  });

  it('keeps the stored key private to the service role', () => {
    for (const sql of [migration, supabaseMigration]) {
      expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS private_ai');
      expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
      expect(sql).toContain('REVOKE ALL ON private_ai.ai_assistant_config FROM anon, authenticated');
      expect(sql).toContain('FROM PUBLIC');
      expect(sql).toContain('TO service_role');
      expect(sql).not.toMatch(/GRANT[^;]*ai_assistant_config[^;]*TO (anon|authenticated)/);
      expect(sql).not.toContain('api_key_plaintext');
    }
  });
});
