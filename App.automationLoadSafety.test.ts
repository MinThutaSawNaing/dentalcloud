import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const sharedSettings = app.slice(app.indexOf('let sharedSettingsRefreshInFlight'), app.indexOf('const settingsChannel ='));

describe('shared settings request budget', () => {
  it('uses one automation read and does not poll the two flags separately', () => {
    expect(sharedSettings).toContain('api.appSettings.getPatientTypeAutomationSettings()');
    expect(sharedSettings).not.toContain('getAutoOnpPatientTypeEnabled()');
    expect(sharedSettings).not.toContain('getAutoOptPatientTypeEnabled()');
  });
  it('skips hidden tabs and overlapping refreshes, and releases the guard on failure', () => {
    expect(sharedSettings).toContain("if (sharedSettingsRefreshInFlight || document.visibilityState === 'hidden') return;");
    expect(sharedSettings).toMatch(/finally\s*\{\s*sharedSettingsRefreshInFlight = false/);
  });
});