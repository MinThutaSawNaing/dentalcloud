import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('./material_lab_cost_presets_migration.sql', import.meta.url));
const migration = readFileSync(migrationPath, 'utf8');
const completeSetupPath = fileURLToPath(new URL('./complete_database_setup.sql', import.meta.url));
const completeSetup = readFileSync(completeSetupPath, 'utf8');

describe('Material & Lab preset migration', () => {
  it('is additive, transactional, and does not replace existing cost RPCs', () => {
    expect(migration).toMatch(/^--[\s\S]*\nBEGIN;/);
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\r?\n\r?\nCOMMIT;/);
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.replace_treatment_costs');
    expect(migration).not.toContain('DELETE FROM public.patient_material_costs');
  });

  it('prevents direct table access and exposes only secured RPCs', () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON public.material_lab_cost_presets FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_material_lab_cost_presets(UUID, TEXT) FROM PUBLIC;');
    expect(migration).toContain('SET search_path = pg_catalog');
  });

  it('requires a live staff session and current Material & Lab permission', () => {
    expect(migration.match(/s\.session_token::TEXT = btrim/g)).toHaveLength(2);
    expect(migration.match(/s\.revoked_at IS NULL/g)).toHaveLength(2);
    expect(migration.match(/s\.expires_at > NOW\(\)/g)).toHaveLength(2);
    expect(migration.match(/u\.allowed_tabs \? 'material-cost'/g)).toHaveLength(2);
    expect(migration.match(/u\.doctor_id IS NULL/g)).toHaveLength(2);
  });

  it('validates inputs and protects whole-list updates with a locked revision', () => {
    expect(migration).toContain('jsonb_array_length(p_items) > 100');
    expect(migration).toContain("item.cost_type NOT IN ('material', 'lab')");
    expect(migration).toContain('item.amount IS NULL OR item.amount <= 0');
    expect(migration).toContain('FOR UPDATE;');
    expect(migration).toContain('p_expected_revision <> v_current_revision');
    expect(migration).toContain('v_created_at_by_id');
    expect(migration).toMatch(/DELETE FROM public\.material_lab_cost_presets\r?\n  WHERE id IS NOT NULL;/);
  });

  it('keeps fresh installations aligned with the additive migration', () => {
    expect(completeSetup).toContain('CREATE TABLE material_lab_cost_presets');
    expect(completeSetup).toContain('CREATE OR REPLACE FUNCTION get_material_lab_cost_presets');
    expect(completeSetup).toContain('CREATE OR REPLACE FUNCTION replace_material_lab_cost_presets');
    expect(completeSetup).toContain('REVOKE ALL ON material_lab_cost_presets FROM PUBLIC, anon, authenticated;');
    expect(completeSetup).toMatch(/DELETE FROM public\.material_lab_cost_presets\r?\n  WHERE id IS NOT NULL;/);
    expect(completeSetup).not.toMatch(/tables TEXT\[\][\s\S]{0,1500}'material_lab_cost_presets'/);
  });
});
