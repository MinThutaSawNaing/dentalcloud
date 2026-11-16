import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./AIAssistantView.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// The Agent-mode / action payload builder and the compressed Ask-mode one.
const agentContext = source.slice(source.indexOf('const getContextualData'), source.indexOf('// Helper function to validate JSON'));
const askContext = source.slice(source.indexOf('const getOptimizedContextData'), source.indexOf('const getContextualData'));

describe('Assistant partial-context honesty', () => {
  it('never hands the model placeholder or hardcoded practice data', () => {
    expect(source).not.toContain('sales_7days: 0');
    expect(source).not.toContain('// Would be calculated from sales data');
    expect(source).not.toContain('// Placeholder');
  });

  it('derives medicine sales volume from real sale records', () => {
    expect(agentContext).toContain('const sales7dByMedicine = new Map<string, number>();');
    expect(agentContext).toContain('sales_7days: sales7dByMedicine.get(m.id) || 0');
    expect(agentContext).toContain('sold_7days: sales7dByMedicine.get(m.id) || 0');
  });

  it('marks every sampled collection so the model knows it is partial', () => {
    expect(agentContext).toContain('cov: {');
    expect(askContext).toContain('cov: {');
    for (const key of ['patients', 'appointments', 'appointment_history', 'treatment_records', 'medicines', 'expenses']) {
      expect(agentContext).toContain(`${key}: \`\${Math.min(`);
    }
    expect(agentContext).toContain('doctors: `all ${activeDoctors.length}`');
    expect(askContext).toContain("treatment_records: 'not loaded'");
  });

  it('forbids ranking or totalling from a sample', () => {
    expect(source).toContain('Practice Data "cov"');
    expect(source).toContain('never compute a ranking or total from it');
  });

  it('gives one corrective turn instead of letting a failed action stand', () => {
    expect(source).toContain("let correctionNote = '';");
    expect(source).toContain('const reportedResults');
    expect(source).toContain('${cleanedAiResponse.trim()}\\n\\n${reportedResults}');
    expect(source).not.toContain('${cleanedAiResponse.trim()}\\n\\n${actionResultText}');
  });
});
