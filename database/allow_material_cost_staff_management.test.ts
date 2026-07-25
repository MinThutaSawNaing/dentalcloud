import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('./allow_material_cost_staff_management.sql', import.meta.url));
const migration = readFileSync(migrationPath, 'utf8');

describe('Material & Lab staff authorization migration', () => {
  it('keeps the deployed RPC signatures stable', () => {
    expect(migration).toContain('public.replace_treatment_costs(\n  p_audit_log_id UUID,\n  p_items JSONB,\n  p_admin_user_id UUID,\n  p_admin_password TEXT,\n  p_request_token UUID');
    expect(migration).toContain('public.acknowledge_commission_recalculation(\n  p_patient_id UUID, p_request_token UUID, p_admin_user_id UUID, p_admin_password TEXT');
  });

  it('requires normal staff to have the exact permission and their own valid token', () => {
    expect(migration.match(/u\.role = 'normal'/g)).toHaveLength(2);
    expect(migration.match(/u\.allowed_tabs \? 'material-cost'/g)).toHaveLength(2);
    expect(migration.match(/s\.user_id = u\.id/g)).toHaveLength(4);
    expect(migration.match(/s\.revoked_at IS NULL/g)).toHaveLength(4);
    expect(migration.match(/s\.expires_at > NOW\(\)/g)).toHaveLength(4);
  });

  it('rejects doctor-linked and cross-branch staff while preserving admins', () => {
    expect(migration.match(/u\.doctor_id IS NULL/g)).toHaveLength(2);
    expect(migration.match(/u\.role = 'admin'/g)).toHaveLength(2);
    expect(migration).toContain('(u.location_id IS NULL OR u.location_id = v_location_id)');
    expect(migration).toContain('(u.location_id IS NULL OR u.location_id = v_patient_location_id)');
    expect(migration).toContain('FOR UPDATE OF a, t;');
    expect(migration).toContain('FOR SHARE OF p;');
  });

  it('is transactional and reloads the API schema only after secured functions exist', () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.replace_treatment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;");
  });
});