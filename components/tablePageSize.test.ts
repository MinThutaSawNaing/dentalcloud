import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const directory = fileURLToPath(new URL('.', import.meta.url));

describe('table page sizes', () => {
  it('shows up to 100 rows per page in every paginated data table', () => {
    const configured = readdirSync(directory)
      .filter((name) => name.endsWith('.tsx') && !name.includes('.test.'))
      .flatMap((name) => {
        const source = readFileSync(new URL(name, import.meta.url), 'utf8');
        const match = source.match(/const itemsPerPage = (\d+);/);
        return match ? [{ name, rows: Number(match[1]) }] : [];
      });

    expect(configured.length).toBeGreaterThanOrEqual(9);
    expect(configured.filter(({ rows }) => rows !== 100)).toEqual([]);
  });
});
