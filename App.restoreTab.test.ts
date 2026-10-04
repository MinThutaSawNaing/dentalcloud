import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transpileModule, ScriptTarget } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
const start = source.indexOf('if (!startupNavigationDoneRef.current && session) {');
const end = source.indexOf('const startup = await loadStaffStartup', start);
if (start < 0 || end <= start) throw new Error('Missing startup navigation block');
const code = transpileModule(source.slice(start, end), {
  compilerOptions: { target: ScriptTarget.ES2022 }, fileName: 'navigation.ts'
}).outputText;

function harness(savedView: string | null, tabs: string[]) {
  const setCurrentView = vi.fn();
  const done = { current: false };
  const run = () => new Function('startupNavigationDoneRef', 'session', 'resolveAllowedTabs',
    'restoredStartupViewRef', 'setCurrentView', code)(done, { role: 'staff', allowed_tabs: tabs },
    () => tabs, { current: savedView }, setCurrentView);
  return { run, setCurrentView, done };
}

describe('page-refresh tab restoration executes startup navigation', () => {
  it.each(['inventory', 'expenses', 'appointments', 'material-cost', 'records', 'doctors',
    'patients', 'dashboard', 'settings', 'users', 'ai-assistant', 'treatments'])('restores permitted %s instead of Patients', (tab) => {
    const h = harness(tab, ['patients', 'appointments', tab]);
    h.run();
    expect(h.setCurrentView).toHaveBeenCalledExactlyOnceWith(tab);
    expect(h.done.current).toBe(true);
    h.run();
    expect(h.setCurrentView).toHaveBeenCalledTimes(1);
  });
  it.each([null, 'invalid-tab', 'users', 'branch-switching'])('falls back safely for absent, invalid or forbidden saved tab %s', (tab) => {
    const h = harness(tab, ['patients', 'appointments', 'branch-switching']);
    h.run();
    expect(h.setCurrentView).toHaveBeenCalledExactlyOnceWith('patients');
  });
  it('falls back to Appointments when Patients is forbidden', () => {
    const h = harness('inventory', ['appointments']);
    h.run();
    expect(h.setCurrentView).toHaveBeenCalledExactlyOnceWith('appointments');
  });
  it('leaves other permission fallback logic in charge when neither default is permitted', () => {
    const h = harness(null, ['inventory']);
    h.run();
    expect(h.setCurrentView).not.toHaveBeenCalled();
  });
  it('captures stored view before authentication and clears restoration on logout/session reset', () => {
    expect(source).toContain("const restoredStartupViewRef = useRef(localStorage.getItem('currentView'));");
    const reset = source.slice(source.indexOf('const resetStaffSession ='), source.indexOf('const canAccessView ='));
    expect(reset).toContain('restoredStartupViewRef.current = null;');
  });
});