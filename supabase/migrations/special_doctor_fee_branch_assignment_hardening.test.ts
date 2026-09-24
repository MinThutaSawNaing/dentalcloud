import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(fileURLToPath(new URL('./20260924000000_harden_special_doctor_fee_branch_assignment.sql', import.meta.url)), 'utf8');

describe('Special doctor fee branch-assignment hardening migration', () => {
  it('requires payment, doctor, and multi-branch assignment prerequisites', () => {
    expect(sql).toContain("to_regclass('public.payments')");
    expect(sql).toContain("to_regclass('public.doctor_locations')");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.replace_payment_costs(');
  });

  it('rejects a special doctor who is not assigned to the payment branch', () => {
    expect(sql).toContain("Selected special doctor is not assigned to the payment branch.");
    expect(sql).toContain('Existing Special Doctor MLS rows contain branch-mismatched assignments; correct them before applying this migration.');
    expect(sql).toContain('doctor.location_id IS DISTINCT FROM v_payment.location_id');
    expect(sql).toContain('assignment.location_id = v_payment.location_id');
  });

  it('preserves the existing payment MLS RPC security and refresh behavior', () => {
    expect(sql).toContain('staff_auth_sessions');
    expect(sql).toContain('pending_commission_recalculations');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.replace_payment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});