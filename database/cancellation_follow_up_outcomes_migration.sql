-- ============================================================================
-- MIGRATION: Track follow-up outcomes for cancelled appointments
-- Safe to run multiple times. The original appointment status remains Cancelled.
-- ============================================================================

BEGIN;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS cancellation_outcome VARCHAR(20),
  ADD COLUMN IF NOT EXISTS completed_later_appointment_id UUID;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_cancellation_outcome_check,
  DROP CONSTRAINT IF EXISTS appointments_completed_later_appointment_id_fkey,
  DROP CONSTRAINT IF EXISTS appointments_cancellation_outcome_link_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_cancellation_outcome_check
    CHECK (cancellation_outcome IS NULL OR cancellation_outcome IN ('NO_SHOW', 'RESCHEDULED', 'COMPLETED_LATER')),
  ADD CONSTRAINT appointments_completed_later_appointment_id_fkey
    FOREIGN KEY (completed_later_appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT,
  ADD CONSTRAINT appointments_cancellation_outcome_link_check
    CHECK (
      (cancellation_outcome = 'COMPLETED_LATER' AND completed_later_appointment_id IS NOT NULL)
      OR (cancellation_outcome IS DISTINCT FROM 'COMPLETED_LATER' AND completed_later_appointment_id IS NULL)
    );

CREATE INDEX IF NOT EXISTS idx_appointments_cancelled_follow_up
  ON appointments (location_id, cancellation_outcome, date DESC, time DESC)
  WHERE status = 'Cancelled';

CREATE OR REPLACE FUNCTION validate_appointment_cancellation_follow_up()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_completed_appointment appointments%ROWTYPE;
BEGIN
  -- Reopening a cancelled appointment makes its cancellation follow-up outcome
  -- inapplicable. Preserve normal status changes by clearing it atomically.
  IF NEW.status <> 'Cancelled' AND NEW.cancellation_outcome IS NOT NULL THEN
    NEW.cancellation_outcome := NULL;
    NEW.completed_later_appointment_id := NULL;
    RETURN NEW;
  END IF;

  -- Patient deletion preserves appointment history by clearing patient_id. A traceable
  -- completed-later relationship cannot survive that unlink, so clear it atomically.
  IF NEW.patient_id IS NULL AND NEW.cancellation_outcome = 'COMPLETED_LATER' THEN
    NEW.cancellation_outcome := NULL;
    NEW.completed_later_appointment_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.cancellation_outcome IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'Cancelled' THEN
    RAISE EXCEPTION 'Only cancelled appointments can have a follow-up outcome.';
  END IF;

  IF NEW.cancellation_outcome = 'COMPLETED_LATER' THEN
    SELECT * INTO v_completed_appointment
    FROM appointments
    WHERE id = NEW.completed_later_appointment_id;

    IF NOT FOUND
       OR NEW.patient_id IS NULL
       OR v_completed_appointment.status <> 'Completed'
       OR v_completed_appointment.patient_id IS DISTINCT FROM NEW.patient_id
       OR (v_completed_appointment.date, v_completed_appointment.time) <= (NEW.date, NEW.time) THEN
      RAISE EXCEPTION 'Completed Later must link to a later completed appointment for the same patient.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_appointment_cancellation_follow_up ON appointments;
CREATE TRIGGER trg_validate_appointment_cancellation_follow_up
  BEFORE INSERT OR UPDATE OF status, cancellation_outcome, completed_later_appointment_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION validate_appointment_cancellation_follow_up();

CREATE OR REPLACE FUNCTION preserve_linked_completed_later_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Patient deletion clears patient_id on historical appointments. The source
  -- cancellation trigger clears its relationship in the same operation.
  IF NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM appointments cancelled_appointment
    WHERE cancelled_appointment.completed_later_appointment_id = NEW.id
      AND (
        NEW.status <> 'Completed'
        OR NEW.patient_id IS DISTINCT FROM cancelled_appointment.patient_id
        OR (NEW.date, NEW.time) <= (cancelled_appointment.date, cancelled_appointment.time)
      )
  ) THEN
    RAISE EXCEPTION 'This completed appointment is linked to a cancelled visit and must remain a later completed appointment for the same patient.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preserve_linked_completed_later_appointment ON appointments;
CREATE TRIGGER trg_preserve_linked_completed_later_appointment
  BEFORE UPDATE OF status, patient_id, date, time ON appointments
  FOR EACH ROW EXECUTE FUNCTION preserve_linked_completed_later_appointment();

NOTIFY pgrst, 'reload schema';

COMMIT;