import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);
const migration = read('./20260904000000_branch_receipt_identity.sql');
const completeSetup = read('../../database/complete_database_setup.sql');
const productionChecks = read('../../database/post_setup_production_checks.sql');

describe('branch receipt identity migration contract', () => {
  it('is additive, transactional, and reloads PostgREST after creation', () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.branch_receipt_settings');
    expect(migration).not.toMatch(/DROP TABLE\s+(?:IF EXISTS\s+)?public\.branch_receipt_settings/i);
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\r?\n\r?\nCOMMIT;/);
  });

  it('keys settings to locations and records update metadata', () => {
    expect(migration).toContain('location_id UUID PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE');
    expect(migration).toContain('receipt_header_title TEXT');
    expect(migration).toContain('receipt_email TEXT');
    expect(migration).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migration).toContain('updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL');
  });

  it('blocks direct client table access and exposes only explicitly granted RPCs', () => {
    expect(migration).toContain('ALTER TABLE public.branch_receipt_settings ENABLE ROW LEVEL SECURITY;');
    expect(migration).toContain('REVOKE ALL ON TABLE public.branch_receipt_settings FROM PUBLIC, anon, authenticated;');
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(4);
    expect(migration.match(/SET search_path = public, pg_temp/g)).toHaveLength(4);
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.require_branch_receipt_admin(UUID, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_branch_receipt_identity(UUID) TO anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_branch_receipt_identity_for_admin(UUID, TEXT) TO anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.save_branch_receipt_identity(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO anon, authenticated;');
  });

  it('keeps public reads minimal and uses only the location phone', () => {
    expect(migration).toMatch(/get_branch_receipt_identity\(p_location_id UUID\)[\s\S]*?RETURNS TABLE \([\s\S]*?receipt_header_title TEXT, receipt_email TEXT\s*\)/);
    expect(migration).toContain("NULLIF(btrim(location.phone), '')");
    expect(migration).not.toContain('global_settings.receipt_phone');
    const publicRead = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_branch_receipt_identity(p_location_id UUID)'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_branch_receipt_identity_for_admin'),
    );
    expect(publicRead).not.toContain('custom_receipt_header_title');
    expect(publicRead).not.toContain('settings_updated_at');
  });

  it('secures detailed admin reads with live admin session and branch scope', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_branch_receipt_identity_for_admin');
    expect(migration).toContain('PERFORM public.require_branch_receipt_admin(p_location_id, p_session_token);');
    expect(migration).toContain('custom_receipt_header_title TEXT');
    expect(migration).toContain('custom_receipt_email TEXT');
    expect(migration).toContain('settings_updated_at TIMESTAMPTZ');
  });

  it('validates admin access and applies optimistic concurrency to saves', () => {
    expect(migration).toContain("staff_user.role = 'admin'");
    expect(migration).toContain('(staff_user.location_id IS NULL OR staff_user.location_id = p_location_id)');
    expect(migration).toContain('session.revoked_at IS NULL');
    expect(migration).toContain('session.expires_at > NOW()');
    expect(migration).toContain('p_expected_updated_at TIMESTAMPTZ DEFAULT NULL');
    expect(migration).toContain('ON CONFLICT (location_id) DO NOTHING');
    expect(migration).toContain('settings.updated_at IS NOT DISTINCT FROM p_expected_updated_at');
    expect(migration).toContain("USING ERRCODE = '40001'");
    expect(migration).toContain('char_length(v_header) > 255');
    expect(migration).toContain('char_length(v_email) > 320');
    expect(migration).toContain("v_email !~* '");
  });

  it('keeps clean setup and production checks in contract', () => {
    for (const sql of [completeSetup, productionChecks]) {
      expect(sql).toContain('branch_receipt_settings');
      expect(sql).toContain('get_branch_receipt_identity');
      expect(sql).toContain('get_branch_receipt_identity_for_admin');
      expect(sql).toContain('save_branch_receipt_identity');
    }
    expect(completeSetup).toContain('REVOKE ALL ON branch_receipt_settings FROM PUBLIC, anon, authenticated;');
    expect(productionChecks).toContain("'branch_receipt_security' AS check_group");
    expect(productionChecks).toContain("'branch_receipt_rpc_security' AS check_group");
    expect(productionChecks).toContain("'public.require_branch_receipt_admin(uuid,text)'::TEXT");
    expect(productionChecks).toContain("'public.get_branch_receipt_identity(uuid)'::TEXT");
    expect(productionChecks).toContain("'public.get_branch_receipt_identity_for_admin(uuid,text)'::TEXT");
    expect(productionChecks).toContain("'public.save_branch_receipt_identity(uuid,text,text,text,timestamp with time zone)'::TEXT");
    expect(productionChecks).toContain("'PUBLIC_EXECUTE_NOT_REVOKED'");
  });
});
