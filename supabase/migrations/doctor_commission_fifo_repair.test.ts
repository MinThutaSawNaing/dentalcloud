import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./manual_20260902_recalculate_percentage_commissions_fifo.sql', import.meta.url),
  'utf8'
);

describe('historical FIFO doctor commission repair', () => {
  it('backs up rows, orders payments deterministically, and leaves flat rows untouched', () => {
    expect(migration).toContain('doctor_commission_entries_fifo_backup_20260902');
    expect(migration).toContain('COUNT(DISTINCT base.commission_rate) AS rate_count');
    expect(migration).not.toContain('COUNT(DISTINCT entry.commission_rate) OVER');
    expect(migration).toContain('ORDER BY payment.payment_date, payment.payment_created_at, payment.payment_id');
    expect(migration).toContain("WHERE entry.calculation_mode = 'percentage'");
    expect(migration).toContain('PARTITION BY source.pool_key, source.payment_id');
  });
});
