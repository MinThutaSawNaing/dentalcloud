import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(new URL('./cancellation_follow_up_outcomes_migration.sql', import.meta.url));
const migration = readFileSync(migrationPath, 'utf8');

describe('cancellation follow-up outcomes migration', () => {
  it('adds constrained follow-up fields without changing appointment lifecycle status', () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS cancellation_outcome VARCHAR(20)");
    expect(migration).toContain("'NO_SHOW', 'RESCHEDULED', 'COMPLETED_LATER'");
    expect(migration).toContain('completed_later_appointment_id UUID');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).not.toContain("UPDATE appointments SET status = 'Completed'");
  });

  it('enforces a same-patient later completed visit for the traceable outcome', () => {
    expect(migration).toContain('validate_appointment_cancellation_follow_up()');
    expect(migration).toContain("NEW.status <> 'Cancelled'");
    expect(migration).toContain("v_completed_appointment.status <> 'Completed'");
    expect(migration).toContain('v_completed_appointment.patient_id IS DISTINCT FROM NEW.patient_id');
    expect(migration).toContain('preserve_linked_completed_later_appointment()');
    expect(migration).toContain("NEW.patient_id IS NULL AND NEW.cancellation_outcome = 'COMPLETED_LATER'");
    expect(migration).toMatch(/NOTIFY pgrst, 'reload schema';\r?\n\r?\nCOMMIT;/);
  });

  it('clears a follow-up outcome when an appointment is reopened from Cancelled', () => {
    expect(migration).toContain("NEW.status <> 'Cancelled' AND NEW.cancellation_outcome IS NOT NULL");
    expect(migration).toContain('NEW.completed_later_appointment_id := NULL;');
  });
});