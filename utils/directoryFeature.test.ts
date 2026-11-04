import { describe, expect, it } from 'vitest';
import { parseDatabaseFilteredDirectories } from './directoryFeature';

describe('database-filtered directory opt-in', () => {
  it.each([undefined, null, '', 'false', 'TRUE', 'True', ' true', 'true ', '1', true, false, 1])(
    'safely disables the pending feature for %s', (value) => {
      expect(parseDatabaseFilteredDirectories(value)).toBe(false);
    }
  );
  it('enables only the exact string true', () => {
    expect(parseDatabaseFilteredDirectories('true')).toBe(true);
  });
});
