-- Payment-date MLS directory. Allocation is computed on patient history before
-- filtering/paging, never by independently allocating a truncated payment page.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mls_patient_payment_links(p_location_id uuid, p_patient_id uuid)
RETURNS TABLE(payment_id uuid, treatment_ids uuid[])
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  p record; t record; remaining jsonb := '{}'::jsonb;
  explicit_ids uuid[]; linked uuid[]; amount_left numeric; available numeric;
  total_remaining numeric; allocatable numeric; share numeric; allocated numeric;
  treatment_value numeric; medicine_value numeric; service_fee numeric;
  eligible uuid[]; tid uuid; i integer;
  snapshot jsonb; line jsonb; normalized_lines jsonb; raw_value jsonb;
  numeric_value numeric; line_kind text; numeric_text text;
  -- ECMAScript String.trim whitespace (not just PostgreSQL's default space).
  trim_chars text := E' \t\n\r\f\013' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  FOR t IN SELECT id, cost FROM public.treatments
    WHERE location_id = p_location_id AND patient_id = p_patient_id
  LOOP
    remaining := remaining || jsonb_build_object(t.id::text, greatest(0, coalesce(t.cost, 0)));
  END LOOP;
  FOR p IN SELECT * FROM public.payments
    WHERE location_id = p_location_id AND patient_id = p_patient_id
    ORDER BY payment_date, created_at, id
  LOOP
    -- Only the normalized receipt used by api.mapPayment may affect allocation.
    -- Missing/invalid headers reject the entire snapshot, not just its lines.
    snapshot := p.receipt_snapshot;
    IF NOT coalesce(
      jsonb_typeof(snapshot->'receiptNumber') = 'string' AND btrim(snapshot->>'receiptNumber', trim_chars) <> ''
      AND jsonb_typeof(snapshot->'receiptDate') = 'string' AND btrim(snapshot->>'receiptDate', trim_chars) <> ''
      AND snapshot->>'currency' IN ('USD', 'MMK')
      AND snapshot->'payment'->>'status' IN ('FULL', 'PARTIAL'), false) THEN
      snapshot := '{}'::jsonb;
    END IF;
    service_fee := 0; treatment_value := 0; medicine_value := 0;
    -- Normalize only allocation-relevant fields. Nonarrays are empty, and invalid
    -- lines are discarded just like normalizeTreatmentLine/normalizeMedicineLine.
    FOREACH line_kind IN ARRAY ARRAY['treatments', 'medicines', 'payment'] LOOP
      normalized_lines := '[]'::jsonb;
      FOR line IN SELECT value FROM jsonb_array_elements(
        CASE WHEN line_kind = 'payment' THEN jsonb_build_array(snapshot->'payment')
          WHEN jsonb_typeof(snapshot->line_kind) = 'array' THEN snapshot->line_kind
          ELSE '[]'::jsonb END)
      LOOP
        IF line_kind <> 'payment' THEN
          CONTINUE WHEN NOT coalesce(
            jsonb_typeof(line->'id') = 'string' AND btrim(line->>'id', trim_chars) <> ''
            AND jsonb_typeof(line->'date') = 'string' AND btrim(line->>'date', trim_chars) <> ''
            AND CASE WHEN line_kind = 'treatments' THEN
              jsonb_typeof(line->'description') = 'string' AND btrim(line->>'description', trim_chars) <> ''
            ELSE
              jsonb_typeof(coalesce(nullif(line->'medicineName', 'null'::jsonb), line->'medicine_name')) = 'string'
              AND btrim(coalesce(nullif(line->'medicineName', 'null'::jsonb), line->'medicine_name') #>> '{}', trim_chars) <> ''
            END, false);
        END IF;
        raw_value := CASE line_kind
          WHEN 'treatments' THEN coalesce(nullif(line->'finalCost', 'null'::jsonb),
            nullif(line->'final_cost', 'null'::jsonb), line->'cost')
          WHEN 'medicines' THEN coalesce(nullif(line->'total_price', 'null'::jsonb), line->'totalPrice')
          ELSE line->'serviceFeeAmount' END;
        -- Number(value) failures/nonfinite values become zero. Catch bad text and
        -- overflow locally so one legacy receipt cannot abort the directory RPC.
        BEGIN
          -- Number([x]) coerces through its string form; multi-element arrays
          -- cannot be numbers. Repeated singleton arrays behave the same way.
          IF jsonb_typeof(raw_value) = 'array' THEN
            WHILE jsonb_typeof(raw_value) = 'array' LOOP
              IF jsonb_array_length(raw_value) = 1 THEN raw_value := raw_value->0;
              ELSE raw_value := 'null'::jsonb; EXIT; END IF;
            END LOOP;
            IF jsonb_typeof(raw_value) = 'boolean' THEN raw_value := 'null'::jsonb; END IF;
          END IF;
          numeric_text := btrim(raw_value #>> '{}', trim_chars);
          IF numeric_text ~* '^0(x[0-9a-f]+|b[01]+|o[0-7]+)$' THEN
            numeric_value := 0;
            FOR i IN 3..length(numeric_text) LOOP
              numeric_value := numeric_value * CASE lower(substr(numeric_text, 2, 1))
                WHEN 'x' THEN 16 WHEN 'b' THEN 2 ELSE 8 END
                + strpos('0123456789abcdef', lower(substr(numeric_text, i, 1))) - 1;
            END LOOP;
          ELSE
            numeric_value := CASE WHEN raw_value = 'true'::jsonb THEN 1
              WHEN raw_value = 'false'::jsonb THEN 0
              ELSE coalesce(nullif(numeric_text, '')::numeric, 0) END;
          END IF;
          IF numeric_value::double precision IN ('NaN'::double precision,
            'Infinity'::double precision, '-Infinity'::double precision) THEN
            numeric_value := 0;
          END IF;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          numeric_value := 0;
        END;
        numeric_value := greatest(0, numeric_value);
        IF line_kind = 'treatments' THEN
          treatment_value := treatment_value + numeric_value;
          normalized_lines := normalized_lines || jsonb_build_array(jsonb_build_object('id', btrim(line->>'id', trim_chars)));
        ELSIF line_kind = 'medicines' THEN
          medicine_value := medicine_value + (floor(numeric_value::double precision * 100 + 0.5) / 100)::numeric;
        ELSE
          service_fee := numeric_value;
        END IF;
      END LOOP;
      IF line_kind = 'treatments' THEN
        snapshot := jsonb_set(snapshot, '{treatments}', normalized_lines);
      END IF;
    END LOOP;
    -- Match JS Set insertion order, including the residual-cent recipient.
    SELECT coalesce(array_agg(x.id ORDER BY x.first_ord), '{}'::uuid[]) INTO explicit_ids FROM (
      SELECT id, min(ord) AS first_ord FROM (
        SELECT id, ord FROM unnest(p.treatment_ids) WITH ORDINALITY a(id, ord)
        UNION ALL
        SELECT (a.receipt_line->>'id')::uuid, coalesce(cardinality(p.treatment_ids), 0) + ord
          FROM jsonb_array_elements(snapshot->'treatments') WITH ORDINALITY a(receipt_line, ord)
          WHERE a.receipt_line->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) ordered_ids GROUP BY id
    ) x;
    linked := explicit_ids;
    amount_left := round(greatest(0, coalesce(p.cleared_amount, p.amount) - service_fee), 2);
    -- getPaymentTreatmentShare retains the service-fee-only fallback when
    -- normalized receipt lines have no positive prices (including empty arrays).
    IF treatment_value + medicine_value > 0 THEN
      amount_left := round(least(treatment_value, greatest(0, coalesce(p.cleared_amount, p.amount) - service_fee - medicine_value)), 2);
    END IF;
    -- Missing/out-of-branch explicit links must not turn into FIFO allocations.
    IF NOT EXISTS (SELECT 1 FROM unnest(explicit_ids) x WHERE NOT remaining ? x::text) THEN
      SELECT coalesce(array_agg(x ORDER BY ord), '{}'::uuid[]), coalesce(sum((remaining->>x::text)::numeric), 0)
        INTO eligible, total_remaining FROM unnest(explicit_ids) WITH ORDINALITY a(x, ord)
        WHERE (remaining->>x::text)::numeric > 0;
      allocatable := least(amount_left, total_remaining); allocated := 0;
      IF cardinality(eligible) > 0 THEN
        FOR i IN 1..cardinality(eligible) LOOP
          tid := eligible[i]; available := (remaining->>tid::text)::numeric;
          share := least(available, CASE WHEN i = cardinality(eligible) THEN allocatable - allocated
            ELSE round(allocatable * available / total_remaining, 2) END);
          -- Match the client allocator: rounded residuals must never reopen debt.
          CONTINUE WHEN share <= 0;
          remaining := jsonb_set(remaining, ARRAY[tid::text], to_jsonb(round(available - share, 2)));
          allocated := allocated + share;
        END LOOP;
      END IF;
      amount_left := round(amount_left - allocatable, 2);
      FOR t IN SELECT id FROM public.treatments WHERE location_id = p_location_id
        AND patient_id = p_patient_id AND date <= p.payment_date ORDER BY date, id
      LOOP
        EXIT WHEN amount_left <= 0;
        available := (remaining->>t.id::text)::numeric;
        share := least(available, amount_left);
        IF share > 0 THEN
          linked := array_append(linked, t.id);
          remaining := jsonb_set(remaining, ARRAY[t.id::text], to_jsonb(round(available - share, 2)));
          amount_left := round(amount_left - share, 2);
        END IF;
      END LOOP;
    END IF;
    payment_id := p.id;
    SELECT coalesce(array_agg(DISTINCT x), '{}'::uuid[]) INTO treatment_ids FROM unnest(linked) x;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.mls_directory_page(
  p_location_id uuid, p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
  p_patient_search text DEFAULT '', p_doctor_search text DEFAULT '', p_treatment_search text DEFAULT '',
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 100
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH candidates AS MATERIALIZED (
    SELECT p.* FROM public.payments p JOIN public.patients patient ON patient.id = p.patient_id
    WHERE p.location_id = p_location_id
      AND (p_date_from IS NULL OR p.payment_date >= p_date_from)
      AND (p_date_to IS NULL OR p.payment_date <= p_date_to)
      AND (nullif(btrim(p_patient_search), '') IS NULL OR
        strpos(lower(concat_ws(' ', patient.name, patient.patient_unique_id, patient.id::text)), lower(btrim(p_patient_search))) > 0)
  ), patients AS (
    SELECT DISTINCT patient_id FROM candidates
    -- Patient/date-only browsing must count and page directly on payments.
    WHERE nullif(btrim(p_doctor_search), '') IS NOT NULL
       OR nullif(btrim(p_treatment_search), '') IS NOT NULL
  ),
  links AS MATERIALIZED (
    SELECT l.* FROM patients CROSS JOIN LATERAL public.mls_patient_payment_links(p_location_id, patients.patient_id) l
  ), filtered AS MATERIALIZED (
    SELECT p.*, coalesce(l.treatment_ids, p.treatment_ids) AS linked_ids
    FROM candidates p LEFT JOIN links l ON l.payment_id = p.id
    WHERE (nullif(btrim(p_doctor_search), '') IS NULL OR EXISTS (
      SELECT 1 FROM public.treatments t JOIN public.doctors d ON d.id = t.doctor_id
      WHERE t.id = ANY(l.treatment_ids) AND t.patient_id = p.patient_id AND t.location_id = p_location_id
        AND strpos(lower(d.name), lower(btrim(p_doctor_search))) > 0))
      AND (nullif(btrim(p_treatment_search), '') IS NULL OR EXISTS (
      SELECT 1 FROM public.treatments t WHERE t.id = ANY(l.treatment_ids)
        AND t.patient_id = p.patient_id AND t.location_id = p_location_id
        AND strpos(lower(coalesce(t.description, '')), lower(btrim(p_treatment_search))) > 0))
  ), page AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY payment_date DESC, created_at DESC, id DESC
    LIMIT least(500, greatest(1, coalesce(p_page_size, 100)))
    OFFSET (greatest(1, coalesce(p_page, 1))::bigint - 1) * least(500, greatest(1, coalesce(p_page_size, 100)))
  ) SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtered),
    'payment_ids', coalesce((SELECT jsonb_agg(id ORDER BY payment_date DESC, created_at DESC, id DESC) FROM page), '[]'::jsonb),
    'patient_ids', coalesce((SELECT jsonb_agg(DISTINCT patient_id) FROM page), '[]'::jsonb),
    'treatment_ids', coalesce((
      SELECT jsonb_agg(DISTINCT x) FROM (
        SELECT DISTINCT patient_id FROM page
      ) selected_patients
      CROSS JOIN LATERAL public.mls_patient_payment_links(p_location_id, selected_patients.patient_id) selected_links
      JOIN page ON page.id = selected_links.payment_id
      CROSS JOIN LATERAL unnest(selected_links.treatment_ids) x
    ), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.mls_patient_payment_links(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mls_directory_page(uuid, date, date, text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mls_patient_payment_links(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mls_directory_page(uuid, date, date, text, text, text, integer, integer) TO anon, authenticated;
CREATE INDEX IF NOT EXISTS payments_mls_directory_idx ON public.payments(location_id, payment_date DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS treatments_mls_patient_history_idx ON public.treatments(location_id, patient_id, date, id);
NOTIFY pgrst, 'reload schema';
COMMIT;