import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const sql = readFileSync(new URL('./20261103000002_audit_directory.sql', import.meta.url), 'utf8');
describe('audit directory migration', () => {
  it('hydrates cross-date linked service fees and searches displayed payment method labels', () => {
    expect(sql).toContain('linked.id = ANY(p.treatment_ids)');
    expect(sql).toContain('linked.date = v.date');
    expect(sql).toContain("replace(pay.payment_method, '_', ' ')");
    expect(sql).toContain("replace(pa.payment_method, '_', ' ')");
    expect(sql).toContain("THEN 'Mixed Payment'");
  });
  it('retains RLS, branch scoping, grouping before filtering and bounded stable pagination', () => {
    expect(sql).toContain('SECURITY INVOKER');
    expect(sql).not.toContain('SECURITY DEFINER');
    for (const alias of ['t', 'a', 'pay', 'r']) expect(sql).toContain(`${alias}.location_id = p_location_id`);
    expect(sql.indexOf('GROUP BY t.patient_id, t.date')).toBeLessThan(sql.indexOf('), filtered AS'));
    expect(sql).toContain('ORDER BY sort_date DESC, kind, id');
    expect(sql).toContain('least(greatest(p_limit, 1), 100)');
    expect(sql).toContain('p_doctor_id IS NULL');
  });
});