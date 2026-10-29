-- Fast patient-directory summaries for the visible page only. This keeps list
-- filtering useful without downloading the branch's complete history.
BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.patient_directory_summaries(
  p_location_id UUID,
  p_patient_ids UUID[]
)
RETURNS TABLE (
  patient_id UUID,
  last_visit DATE,
  next_appointment JSONB,
  treatments JSONB,
  doctor_names TEXT[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH requested AS (
    SELECT DISTINCT unnest(p_patient_ids) AS id
  ),
  allowed AS (
    SELECT patient.id, patient.location_id
    FROM public.patients patient
    JOIN requested ON requested.id = patient.id
    WHERE p_location_id IS NULL OR patient.location_id = p_location_id
  )
  SELECT
    allowed.id AS patient_id,
    (
      SELECT MAX(appointment.date)
      FROM public.appointments appointment
      WHERE appointment.patient_id = allowed.id
        AND (allowed.location_id IS NULL OR appointment.location_id = allowed.location_id)
    ) AS last_visit,
    (
      SELECT jsonb_build_object(
        'id', appointment.id,
        'date', appointment.date,
        'time', appointment.time,
        'status', appointment.status
      )
      FROM public.appointments appointment
      WHERE appointment.patient_id = allowed.id
        AND (allowed.location_id IS NULL OR appointment.location_id = allowed.location_id)
        AND appointment.status = 'Scheduled'
        AND (appointment.date > CURRENT_DATE
          OR (appointment.date = CURRENT_DATE AND appointment.time >= LOCALTIME))
      ORDER BY appointment.date, appointment.time, appointment.id
      LIMIT 1
    ) AS next_appointment,
    COALESCE((
      SELECT jsonb_agg(to_jsonb(preview) ORDER BY preview.date DESC NULLS LAST, preview.id DESC)
      FROM (
        SELECT treatment.id,
               treatment.date,
               treatment.description,
               treatment.doctor_id,
               doctor.name AS doctor_name
        FROM public.treatments treatment
        LEFT JOIN public.doctors doctor ON doctor.id = treatment.doctor_id
        WHERE treatment.patient_id = allowed.id
          AND (allowed.location_id IS NULL OR treatment.location_id = allowed.location_id)
        ORDER BY treatment.date DESC NULLS LAST, treatment.id DESC
        LIMIT 4
      ) preview
    ), '[]'::jsonb) AS treatments,
    COALESCE((
      SELECT array_agg(DISTINCT doctor.name ORDER BY doctor.name)
      FROM public.treatments treatment
      JOIN public.doctors doctor ON doctor.id = treatment.doctor_id
      WHERE treatment.patient_id = allowed.id
        AND (allowed.location_id IS NULL OR treatment.location_id = allowed.location_id)
        AND NULLIF(BTRIM(doctor.name), '') IS NOT NULL
    ), ARRAY[]::TEXT[]) AS doctor_names
  FROM allowed;
$$;

REVOKE ALL ON FUNCTION public.patient_directory_summaries(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.patient_directory_summaries(UUID, UUID[]) TO anon, authenticated;

ANALYZE public.appointments;
ANALYZE public.treatments;

NOTIFY pgrst, 'reload schema';
COMMIT;
