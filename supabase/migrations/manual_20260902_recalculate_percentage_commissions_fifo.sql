-- One-time repair for percentage commission ledger rows created by the old
-- proportional-across-payments material/lab deduction rule.
-- Review the backup and recalculation tables before COMMIT in production.
-- Flat-per-visit rows and historical commission-rate snapshots are unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS public.doctor_commission_entries_fifo_backup_20260902 AS
SELECT entry.*, NOW() AS backed_up_at
FROM public.doctor_commission_entries AS entry
WITH NO DATA;

INSERT INTO public.doctor_commission_entries_fifo_backup_20260902
SELECT entry.*, NOW()
FROM public.doctor_commission_entries AS entry
WHERE entry.calculation_mode = 'percentage'
  AND NOT EXISTS (
    SELECT 1
    FROM public.doctor_commission_entries_fifo_backup_20260902 AS backup
    WHERE backup.id = entry.id
  );

CREATE TABLE IF NOT EXISTS public.treatment_doctor_earnings_fifo_backup_20260902 AS
SELECT treatment.id AS treatment_id, treatment.doctor_earnings, NOW() AS backed_up_at
FROM public.treatments AS treatment
WITH NO DATA;

INSERT INTO public.treatment_doctor_earnings_fifo_backup_20260902
SELECT treatment.id, treatment.doctor_earnings, NOW()
FROM public.treatments AS treatment
WHERE NOT EXISTS (
  SELECT 1
  FROM public.treatment_doctor_earnings_fifo_backup_20260902 AS backup
  WHERE backup.treatment_id = treatment.id
);

DROP TABLE IF EXISTS public.recalculated_percentage_commissions_fifo_20260902;

CREATE TABLE public.recalculated_percentage_commissions_fifo_20260902 AS
WITH entry_base AS (
  SELECT
    entry.*,
    payment.created_at AS payment_created_at
  FROM public.doctor_commission_entries AS entry
  JOIN public.payments AS payment ON payment.id = entry.payment_id
  WHERE entry.calculation_mode = 'percentage'
), visit_rate_counts AS (
  SELECT base.visit_key, COUNT(DISTINCT base.commission_rate) AS rate_count
  FROM entry_base AS base
  GROUP BY base.visit_key
), entry_source AS (
  SELECT
    base.*,
    CASE
      WHEN rates.rate_count = 1 THEN base.visit_key
      ELSE 'treatment:' || base.treatment_id::TEXT
    END AS pool_key
  FROM entry_base AS base
  JOIN visit_rate_counts AS rates ON rates.visit_key = base.visit_key
), material_costs AS (
  SELECT
    audit.source_id AS treatment_id,
    ROUND(COALESCE(SUM(cost.total_amount), 0), 2) AS material_lab_cost
  FROM public.audit_logs AS audit
  JOIN public.patient_material_costs AS cost ON cost.audit_log_id = audit.id
  WHERE audit.source_type = 'treatment'
  GROUP BY audit.source_id
), pool_members AS (
  SELECT DISTINCT source.pool_key, source.treatment_id
  FROM entry_source AS source
), pool_costs AS (
  SELECT
    member.pool_key,
    ROUND(COALESCE(SUM(cost.material_lab_cost), 0), 2) AS material_lab_cost
  FROM pool_members AS member
  LEFT JOIN material_costs AS cost ON cost.treatment_id = member.treatment_id
  GROUP BY member.pool_key
), payment_totals AS (
  SELECT
    source.pool_key,
    source.payment_id,
    source.payment_date,
    source.payment_created_at,
    MIN(source.commission_rate) AS commission_rate,
    ROUND(SUM(source.allocated_payment), 2) AS allocated_payment
  FROM entry_source AS source
  GROUP BY source.pool_key, source.payment_id, source.payment_date, source.payment_created_at
), ordered_payments AS (
  SELECT
    payment.*,
    COALESCE(
      SUM(payment.allocated_payment) OVER (
        PARTITION BY payment.pool_key
        ORDER BY payment.payment_date, payment.payment_created_at, payment.payment_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS previously_allocated
  FROM payment_totals AS payment
), payment_calculations AS (
  SELECT
    payment.*,
    LEAST(
      payment.allocated_payment,
      GREATEST(0, pool.material_lab_cost - payment.previously_allocated)
    ) AS material_deduction
  FROM ordered_payments AS payment
  JOIN pool_costs AS pool ON pool.pool_key = payment.pool_key
), provisional_rows AS (
  SELECT
    source.id,
    source.pool_key,
    source.payment_id,
    source.treatment_id,
    source.allocated_payment,
    ROUND(
      (payment.allocated_payment - payment.material_deduction)
      * source.allocated_payment / NULLIF(payment.allocated_payment, 0),
      2
    ) AS provisional_base,
    ROUND(
      (payment.allocated_payment - payment.material_deduction)
      * (source.commission_rate / 100.0)
      * source.allocated_payment / NULLIF(payment.allocated_payment, 0),
      2
    ) AS provisional_earnings,
    ROUND((payment.allocated_payment - payment.material_deduction), 2) AS payment_base,
    ROUND(
      (payment.allocated_payment - payment.material_deduction)
      * (source.commission_rate / 100.0),
      2
    ) AS payment_earnings,
    ROW_NUMBER() OVER (
      PARTITION BY source.pool_key, source.payment_id
      ORDER BY source.treatment_id, source.id
    ) AS row_number,
    COUNT(*) OVER (PARTITION BY source.pool_key, source.payment_id) AS row_count
  FROM entry_source AS source
  JOIN payment_calculations AS payment
    ON payment.pool_key = source.pool_key
   AND payment.payment_id = source.payment_id
), final_rows AS (
  SELECT
    provisional.*,
    CASE
      WHEN provisional.row_number = provisional.row_count THEN ROUND(
        provisional.payment_base - COALESCE(
          SUM(provisional.provisional_base) OVER (
            PARTITION BY provisional.pool_key, provisional.payment_id
            ORDER BY provisional.row_number
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        ),
        2
      )
      ELSE provisional.provisional_base
    END AS commission_base,
    CASE
      WHEN provisional.row_number = provisional.row_count THEN ROUND(
        provisional.payment_earnings - COALESCE(
          SUM(provisional.provisional_earnings) OVER (
            PARTITION BY provisional.pool_key, provisional.payment_id
            ORDER BY provisional.row_number
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ),
          0
        ),
        2
      )
      ELSE provisional.provisional_earnings
    END AS earnings
  FROM provisional_rows AS provisional
)
SELECT
  final.id,
  final.payment_id,
  final.treatment_id,
  ROUND(GREATEST(0, final.allocated_payment - final.commission_base), 2) AS material_deduction,
  ROUND(GREATEST(0, final.commission_base), 2) AS commission_base,
  ROUND(GREATEST(0, final.earnings), 2) AS earnings
FROM final_rows AS final;

UPDATE public.doctor_commission_entries AS entry
SET
  material_deduction = recalculated.material_deduction,
  commission_base = recalculated.commission_base,
  earnings = recalculated.earnings
FROM public.recalculated_percentage_commissions_fifo_20260902 AS recalculated
WHERE entry.id = recalculated.id
  AND entry.calculation_mode = 'percentage';

WITH treatment_totals AS (
  SELECT entry.treatment_id, ROUND(SUM(entry.earnings), 2) AS earnings
  FROM public.doctor_commission_entries AS entry
  GROUP BY entry.treatment_id
)
UPDATE public.treatments AS treatment
SET doctor_earnings = totals.earnings
FROM treatment_totals AS totals
WHERE treatment.id = totals.treatment_id;

COMMIT;

SELECT
  payment_id,
  SUM(material_deduction) AS material_deduction,
  SUM(commission_base) AS commission_base,
  SUM(earnings) AS doctor_earned
FROM public.recalculated_percentage_commissions_fifo_20260902
GROUP BY payment_id
ORDER BY payment_id;
