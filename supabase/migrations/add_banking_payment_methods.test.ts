import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(__dirname, '20260905000000_add_banking_payment_methods.sql'),
  'utf8'
).replace(/\r\n/g, '\n');

const functions = [
  'CREATE OR REPLACE FUNCTION process_patient_payment(',
  'CREATE OR REPLACE FUNCTION public.process_patient_split_payment(',
  'CREATE OR REPLACE FUNCTION public.correct_payment_record(',
  'CREATE OR REPLACE FUNCTION public.correct_split_payment_record('
];

describe('add_banking_payment_methods migration', () => {
  it('extends both payment method constraints with the banking methods', () => {
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS payments_payment_method_check');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS payment_allocations_payment_method_check');
    const paymentsConstraint = migration.slice(
      migration.indexOf('ADD CONSTRAINT payments_payment_method_check'),
      migration.indexOf('payment_allocations_payment_method_check;')
    );
    expect(paymentsConstraint).toContain("'AYA_BANKING'");
    expect(paymentsConstraint).toContain("'KBZ_BANKING'");
    expect(paymentsConstraint).toContain("'CB_BANKING'");
    expect(paymentsConstraint).toContain("'MIXED'");
    const allocationsConstraint = migration.slice(
      migration.indexOf('ADD CONSTRAINT payment_allocations_payment_method_check'),
      migration.indexOf('-- 1) process_patient_payment')
    );
    expect(allocationsConstraint).toContain("'CB_BANKING'");
    expect(allocationsConstraint).not.toContain('MIXED');
  });

  it('redefines every payment function with the banking methods allowed', () => {
    functions.forEach((signature) => {
      expect(migration).toContain(signature);
    });
    const body = migration.slice(migration.indexOf(functions[0]));
    functions.slice(1).forEach((signature) => {
      expect(body.indexOf(signature)).toBeGreaterThan(-1);
    });
    ["'AYA_BANKING', 'KBZ_BANKING', 'CB_BANKING'", "'AYA_BANKING','KBZ_BANKING','CB_BANKING'", "    'AYA_BANKING',"].forEach((variant) => {
      expect(body).toContain(variant);
    });
  });

  it('reloads PostgREST and keeps the change transactional and additive', () => {
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';");
    expect(migration).toContain('\nBEGIN;\n');
    expect(migration).toContain('COMMIT;');
    expect(migration).not.toMatch(/DROP TABLE/i);
  });
});
