-- Match the branch filter and deterministic payment-history pagination order.
-- Existing payment_date indexes do not satisfy ORDER BY created_at DESC, id ASC.
-- Fail safely if the table is busy rather than waiting indefinitely for a lock.
SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS idx_payments_location_created_at_id
  ON public.payments (location_id, created_at DESC, id);

-- Refresh planner statistics used by MLS planned-count progress estimates.
ANALYZE public.payments;
ANALYZE public.treatments;

RESET lock_timeout;