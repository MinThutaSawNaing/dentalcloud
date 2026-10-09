import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const assistant = readFileSync(new URL('./AIAssistantView.tsx', import.meta.url), 'utf8');

describe('Assistant progressive startup integration', () => {
  it('loads the workspace module concurrently with the complete data bundle', () => {
    expect(app).toContain('React.lazy(loadAIAssistantView)');
    expect(app).toContain('void loadAIAssistantView().catch');
    expect(app).toContain("currentView !== 'material-cost' && currentView !== 'ai-assistant'");
  });

  it('keeps complete-data publication and branch/session guards', () => {
    const load = app.slice(app.indexOf("} else if (view === 'ai-assistant')"), app.indexOf("} else if (view === 'users')"));
    expect(load).toContain('await cached(() => Promise.all([');
    expect(load).toContain('if (!isCurrent()) return;');
    expect(load).toContain('setAssistantPaymentRecords(mergeLegacyPaymentRecords(payments, queryScope))');
    expect(app).toContain('dataReady={assistantDataReady}');
    expect(app).toContain('patients={assistantDataReady ? assistantPatients : []}');
    expect(app).toContain('paymentRecords={assistantDataReady ? assistantPaymentRecords : []}');
  });

  it('blocks all message entry paths before complete data is ready, without discarding drafts', () => {
    const send = assistant.slice(assistant.indexOf('const handleSendMessage ='), assistant.indexOf('// Check if this is a confirmation response'));
    expect(send).toContain('!dataReady');
    expect(assistant).toContain('disabled={!inputMessage.trim() || isLoading || !dataReady}');
    expect(assistant).toContain('<AssistantDataStatus');
    expect(app).toContain('onRetryData={() => setLazyViewRevision((value) => value + 1)}');
  });
});