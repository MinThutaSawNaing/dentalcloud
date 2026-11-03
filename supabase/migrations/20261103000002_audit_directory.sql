-- Unified, grouped audit directory. Only page IDs cross the wire; RLS remains active.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.audit_directory(
  p_location_id UUID, p_date_from DATE, p_date_to DATE,
  p_filter TEXT DEFAULT 'all', p_search TEXT DEFAULT '', p_doctor_id UUID DEFAULT NULL,
  p_offset INTEGER DEFAULT 0, p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
WITH events AS (
  -- Group BEFORE matching and pagination: a visit must never be split across pages.
  SELECT 'treatment'::text AS kind, min(t.id::text) AS id,
    array_agg(t.id ORDER BY t.id) AS ids,
    t.date::text || 'T23:59:59' AS sort_date,
    concat_ws(' ', max(p.name), string_agg(d.name, ' '), string_agg(t.description, ' + '),
      t.date::text, string_agg(array_to_string(t.teeth, ' '), ' ')) AS search_text
  FROM public.treatments t
  LEFT JOIN public.patients p ON p.id = t.patient_id
  LEFT JOIN public.doctors d ON d.id = t.doctor_id
  WHERE t.location_id = p_location_id AND t.date BETWEEN p_date_from AND p_date_to
    AND (p_doctor_id IS NULL OR t.doctor_id = p_doctor_id)
    AND p_filter IN ('all', 'treatments')
  GROUP BY t.patient_id, t.date
  UNION ALL
  SELECT 'appointment', a.id::text, ARRAY[a.id],
    COALESCE(to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), a.date::text || 'T' || a.time::text),
    concat_ws(' ', p.name, a.guest_name, d.name, a.created_by_user_name, a.type, a.status, a.date, a.time, a.created_at)
  FROM public.appointments a
  LEFT JOIN public.patients p ON p.id = a.patient_id
  LEFT JOIN public.doctors d ON d.id = a.doctor_id
  WHERE a.location_id = p_location_id AND a.date BETWEEN p_date_from AND p_date_to
    AND p_doctor_id IS NULL AND p_filter IN ('all', 'appointments')
  UNION ALL
  SELECT 'payment', pay.id::text, ARRAY[pay.id],
    COALESCE(to_char(pay.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), pay.payment_date::text || 'T23:59:58'),
    concat_ws(' ', p.name, pay.created_by_user_name, pay.payment_method,
      CASE WHEN pay.payment_method = 'MIXED' THEN 'Mixed Payment' ELSE replace(pay.payment_method, '_', ' ') END,
      pay.receipt_number, pay.payment_date,
      (SELECT string_agg(pa.payment_method || ' ' || replace(pa.payment_method, '_', ' '), ' ') FROM public.payment_allocations pa WHERE pa.payment_id = pay.id))
  FROM public.payments pay LEFT JOIN public.patients p ON p.id = pay.patient_id
  WHERE pay.location_id = p_location_id AND pay.payment_date BETWEEN p_date_from AND p_date_to
    AND p_doctor_id IS NULL AND p_filter IN ('all', 'payments')
  UNION ALL
  SELECT 'reschedule', r.id::text, ARRAY[r.id], to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    concat_ws(' ', r.patient_name, r.doctor_name, r.admin_name, r.reason, r.original_date, r.new_date, r.created_at)
  FROM public.appointment_reschedule_logs r
  WHERE r.location_id = p_location_id
    AND (r.created_at AT TIME ZONE 'UTC')::date BETWEEN p_date_from AND p_date_to
    AND p_doctor_id IS NULL AND p_filter IN ('all', 'reschedules')
), filtered AS (
  SELECT * FROM events
  WHERE strpos(lower(search_text), lower(btrim(COALESCE(p_search, '')))) > 0
), page AS (
  SELECT * FROM filtered ORDER BY sort_date DESC, kind, id
  OFFSET greatest(p_offset, 0) LIMIT least(greatest(p_limit, 1), 100)
), visits AS (
  SELECT DISTINCT t.patient_id, t.date FROM public.treatments t
  WHERE t.id IN (SELECT unnest(ids) FROM page WHERE kind = 'treatment')
), context AS (
  SELECT 'appointment'::text AS kind, a.id FROM public.appointments a
  JOIN visits v ON v.patient_id = a.patient_id AND v.date = a.date
  WHERE a.location_id = p_location_id AND (p_doctor_id IS NULL OR a.doctor_id = p_doctor_id)
  UNION
  SELECT 'payment', p.id FROM public.payments p
  JOIN visits v ON v.patient_id = p.patient_id AND (
    v.date = p.payment_date OR EXISTS (
      SELECT 1 FROM public.treatments linked
      WHERE linked.patient_id = v.patient_id AND linked.date = v.date
        AND linked.location_id = p_location_id AND linked.id = ANY(p.treatment_ids)
    )
  )
  WHERE p.location_id = p_location_id AND p_doctor_id IS NULL
  UNION
  SELECT 'treatment', t.id FROM public.treatments t
  JOIN public.payments p ON t.id = ANY(p.treatment_ids)
  WHERE p.id IN (SELECT unnest(ids) FROM page WHERE kind = 'payment')
    AND t.location_id = p_location_id AND p_doctor_id IS NULL
)
SELECT jsonb_build_object(
  'context', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'ids', ARRAY[id])) FROM context), '[]'::jsonb),
  'total', (SELECT count(*) FROM filtered),
  'counts', (SELECT jsonb_build_object('treatments', count(*) FILTER (WHERE kind = 'treatment'),
    'appointments', count(*) FILTER (WHERE kind IN ('appointment', 'reschedule')),
    'reschedules', count(*) FILTER (WHERE kind = 'reschedule'),
    'payments', count(*) FILTER (WHERE kind = 'payment')) FROM filtered),
  'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', kind, 'ids', ids)
    ORDER BY sort_date DESC, kind, id) FROM page), '[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.audit_directory(UUID, DATE, DATE, TEXT, TEXT, UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_directory(UUID, DATE, DATE, TEXT, TEXT, UUID, INTEGER, INTEGER) TO anon, authenticated;
CREATE INDEX IF NOT EXISTS treatments_audit_directory_idx ON public.treatments(location_id, date, patient_id);
CREATE INDEX IF NOT EXISTS payments_audit_directory_idx ON public.payments(location_id, payment_date, id);
CREATE INDEX IF NOT EXISTS appointments_audit_directory_idx ON public.appointments(location_id, date, id);
CREATE INDEX IF NOT EXISTS reschedules_audit_directory_idx ON public.appointment_reschedule_logs(location_id, created_at, id);
NOTIFY pgrst, 'reload schema';
COMMIT;