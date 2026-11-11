import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('./SettingsView.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

describe('saved automation state', () => {
  it.each(['Onp', 'Opt'])('publishes Auto %s state only after persistence succeeds', (kind) => {
    const start = app.indexOf(`const handleAuto${kind}PatientTypeChange =`);
    const handler = app.slice(start, app.indexOf('\n  };', start));
    const persistence = handler.indexOf(`await api.appSettings.saveAuto${kind}PatientTypeEnabled(enabled)`);
    const publish = handler.indexOf(`setAuto${kind}PatientTypeEnabled(enabled)`);
    expect(persistence).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(persistence);
    expect(handler).not.toContain('previousValue');
  });
});

// Execute the actual save handlers with controlled state, without a DOM dependency.
function harness(kind: 'Onp' | 'Opt', saved = false, draft = true, saving = false, isAdmin = true) {
  const start = source.indexOf(`  const handleSaveAuto${kind} =`);
  const end = source.indexOf('\n  };', start) + '\n  };'.length;
  const callback = vi.fn<(enabled: boolean) => Promise<void>>().mockResolvedValue(undefined);
  const setSaving = vi.fn();
  const setMessage = vi.fn();
  const bindings = {
    isAdmin,
    [`isSavingAuto${kind}`]: saving,
    [`auto${kind}Draft`]: draft,
    [`auto${kind}PatientTypeEnabled`]: saved,
    [`onAuto${kind}PatientTypeChange`]: callback,
    [`setIsSavingAuto${kind}`]: setSaving,
    [`setAuto${kind}Message`]: setMessage,
  };
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const save = new Function(...Object.keys(bindings), `${code}; return handleSaveAuto${kind};`)(...Object.values(bindings));
  return { save, callback, setSaving, setMessage };
}

describe.each(['Onp', 'Opt'] as const)('Auto %s explicit save', (kind) => {
  it('stages checkbox changes locally without calling persistence', () => {
    const input = source.match(new RegExp(`<input[^>]*checked=\\{auto${kind}Draft\\}[\\s\\S]*?\\/>`))?.[0];
    expect(input).toBeDefined();
    expect(input).toContain(`setAuto${kind}Draft(event.target.checked)`);
    expect(input).not.toContain('handleSave');
    expect(input).not.toContain('PatientTypeChange');
    expect(source).toContain(`onClick={() => void handleSaveAuto${kind}()}`);
    expect(source).toContain(`disabled={isSavingAuto${kind} || auto${kind}Draft === auto${kind}PatientTypeEnabled}`);
    expect(source).toContain(`setAuto${kind}Draft(auto${kind}PatientTypeEnabled);`);
  });

  it.each([true, false])('persists the draft %s only on explicit save', async (draft) => {
    const h = harness(kind, !draft, draft);
    expect(h.callback).not.toHaveBeenCalled();
    await h.save();
    expect(h.callback).toHaveBeenCalledExactlyOnceWith(draft);
    expect(h.setSaving.mock.calls).toEqual([[true], [false]]);
  });

  it('ignores unchanged, saving, and unauthorized submissions', async () => {
    for (const h of [harness(kind, false, false), harness(kind, false, true, true), harness(kind, false, true, false, false)]) {
      await h.save();
      expect(h.callback).not.toHaveBeenCalled();
    }
  });

  it('reports failure, releases the saving state and permits retry', async () => {
    const h = harness(kind);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      h.callback.mockRejectedValueOnce(new Error('Permission denied'));
      await h.save();
      expect(h.setMessage).toHaveBeenLastCalledWith('Permission denied');
      expect(h.setSaving).toHaveBeenLastCalledWith(false);
      await h.save();
      expect(h.callback).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });
});