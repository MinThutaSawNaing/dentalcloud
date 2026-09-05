import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(fileURLToPath(new URL('./20260905000001_add_branch_receipt_contact_fields.sql', import.meta.url)), 'utf8');

describe('branch receipt contact fields migration contract', () => {
  it('atomically secures and saves canonical contact fields for future receipts', () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(migration).toContain('p_location_address TEXT');
    expect(migration).toContain('p_location_phone TEXT');
    expect(migration).toContain('public.require_branch_receipt_admin(p_location_id, p_session_token)');
    expect(migration).toContain('UPDATE public.locations');
    expect(migration).toContain('SET address = v_address, phone = v_phone');
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration).toMatch(/COMMIT;\s*$/);
  });
});