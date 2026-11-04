import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Checked-in excerpts from ae49495 keep this guard usable in shallow CI clones.
const original = JSON.parse(readFileSync(new URL('./test/fixtures/legacyDirectorySources.json', import.meta.url), 'utf8')) as Record<string, string>;
const section = (source: string, start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('directory rollout source guards', () => {
  it('retains the exact original audit loader', () => {
    expect(section(app, '  const loadAuditLog =', '  const loadDatabaseAuditLog =')).toBe(original.audit);
  });
  it('uses date-scoped MLS without changing the audit RPC opt-in', () => {
    const loader = section(app, '  // Date-scoped MLS:', '  // MLS reads are owned');
    expect(loader).toContain('loadMlsDateRange(scope, mlsDateRange');
    expect(loader).toContain('if (databaseFilteredDirectories || !isAuthenticated');
    expect(loader).not.toContain('getAllRecords(');
    expect(loader).not.toContain('setGlobalRecords(');
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
