import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('./20260920000000_add_special_doctor_fee_assignment.sql', import.meta.url)), 'utf8');

describe('Special doctor fee assignment migration', () => {
  it('adds only an optional special-doctor assignment and preserves the payment MLS RPC signature', () => {
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS doctor_id UUID');
    expect(sql).toContain("CHECK (doctor_id IS NULL OR cost_type = 'special_doctor')");
    expect(sql).toContain('FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE SET NULL');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.replace_payment_costs(');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.replace_payment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;');
  });

  it('validates doctor assignments without changing commission tables or calculations', () => {
    expect(sql).toContain("Selected special doctor was not found.");
    expect(sql).toContain("item.cost_type <> 'special_doctor'");
    expect(sql).not.toContain('doctor_commission_entries');
    expect(sql).not.toContain('get_applicable_commission_rate');
    expect(sql).not.toContain('commission_percentage');
  });
});