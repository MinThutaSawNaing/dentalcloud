import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Checked-in excerpts from ae49495 keep this guard usable in shallow CI clones.
const original = JSON.parse(readFileSync(new URL('./test/fixtures/legacyDirectorySources.json', import.meta.url), 'utf8')) as Record<string, string>;
const section = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('directory rollout source guards', () => {
  it('retains the exact original audit loader and cost-save refresh', () => {
    expect(section(app, '  const loadAuditLog =', '  const loadDatabaseAuditLog =')).toBe(original.audit);
    expect(section(app, '  const refreshMlsAfterCostSave =', '  const refreshDatabaseMlsAfterCostSave =')).toBe(original.refresh);
  });
  it('retains the original MLS effect with only the legacy marker and gate added', () => {
    const legacy = original.mls
      .replace('// MLS reads are owned by the branch/session, never by navigation cleanup.', '// Legacy MLS loader (ae49495): default production path.')
      .replace('if (!leanStaffStartup', 'if (databaseFilteredDirectories || !leanStaffStartup');
    expect(section(app, '  // Legacy MLS loader', '  // MLS reads are owned')).toBe(legacy);
    expect(section(app, '  // MLS reads are owned', '  // Fetch only the selected screen')).toContain('if (!databaseFilteredDirectories || !isAuthenticated');
  });
  it('routes callbacks and new-only audit props through the gate', () => {
    expect(app).toContain('onQueryChange={databaseFilteredDirectories ? loadDatabaseAuditLog : loadAuditLog}');
    expect(app).toContain('onExportAll={databaseFilteredDirectories ? exportAuditLog : undefined}');
    expect(app).toContain('&& (databaseFilteredDirectories ? <MaterialCostView');
  });
  it('rejects exports after branch, startup or auth changes', () => {
    const afterAwait = section(app, '    const bundle = await getAllFilteredAuditRows(locationId', '  const fetchInitialData =');
    expect(afterAwait).toContain('currentLocationIdRef.current !== locationId');
    expect(afterAwait).toContain('initialDataFetchRequestRef.current !== startupRef');
    expect(afterAwait).toContain('!isSameAuthSession(session, auth.getSession())');
  });
});
