-- Assign payment-bound Special Doctor MLS costs to a doctor without changing
-- commission rates, commission entries, or percentage calculations.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.patient_material_costs') IS NULL
     OR to_regclass('public.doctors') IS NULL
     OR to_regprocedure('public.replace_payment_costs(uuid,jsonb,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Special doctor fee assignment prerequisites are missing.';
  END IF;
END;
$$;

ALTER TABLE public.patient_material_costs
  ADD COLUMN IF NOT EXISTS doctor_id UUID;

ALTER TABLE public.patient_material_costs
  DROP CONSTRAINT IF EXISTS patient_material_costs_special_doctor_assignment_fkey;
ALTER TABLE public.patient_material_costs
  ADD CONSTRAINT patient_material_costs_special_doctor_assignment_fkey
  FOREIGN KEY (doctor_id) REFERENCES public.doctors(id) ON DELETE SET NULL
  NOT VALID;
ALTER TABLE public.patient_material_costs
  VALIDATE CONSTRAINT patient_material_costs_special_doctor_assignment_fkey;

ALTER TABLE public.patient_material_costs
  DROP CONSTRAINT IF EXISTS patient_material_costs_doctor_id_cost_type_check;
ALTER TABLE public.patient_material_costs
  ADD CONSTRAINT patient_material_costs_doctor_id_cost_type_check
  CHECK (doctor_id IS NULL OR cost_type = 'special_doctor') NOT VALID;
ALTER TABLE public.patient_material_costs
  VALIDATE CONSTRAINT patient_material_costs_doctor_id_cost_type_check;

CREATE INDEX IF NOT EXISTS idx_patient_material_costs_special_doctor_dashboard
  ON public.patient_material_costs (doctor_id, payment_id)
  WHERE cost_type = 'special_doctor' AND doctor_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.replace_payment_costs(
  p_payment_id UUID,
  p_items JSONB,
  p_user_id UUID,
  p_session_token TEXT,
  p_request_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_audit_log_id UUID;
  v_actor_username TEXT;
  v_total NUMERIC(12,2);
  v_material_total NUMERIC(12,2);
  v_lab_total NUMERIC(12,2);
  v_special_doctor_total NUMERIC(12,2);
  v_material_names TEXT;
  v_lab_names TEXT;
  v_special_doctor_names TEXT;
  v_patient_name TEXT;
  v_treatment_label TEXT;
  v_items JSONB;
BEGIN
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment was not found.'; END IF;

  SELECT u.username INTO v_actor_username
  FROM public.users u JOIN public.staff_auth_sessions s ON s.user_id = u.id
  WHERE u.id = p_user_id AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
    AND s.revoked_at IS NULL AND s.expires_at > NOW()
    AND (u.role = 'admin' OR (u.role = 'normal' AND u.doctor_id IS NULL
      AND jsonb_typeof(u.allowed_tabs) = 'array' AND u.allowed_tabs ? 'material-cost'
      AND (u.location_id IS NULL OR u.location_id = v_payment.location_id)));
  IF NOT FOUND THEN RAISE EXCEPTION 'A valid staff session with Treatment Costs permission is required.'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RAISE EXCEPTION 'Cost items must be a JSON array.'; END IF;
  IF jsonb_array_length(p_items) > 100 THEN RAISE EXCEPTION 'A maximum of 100 MLS cost items is allowed.'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) raw(item) WHERE jsonb_typeof(raw.item) <> 'object')
    OR EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_items)
        item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID)
      WHERE btrim(COALESCE(item.material_name, '')) = '' OR char_length(btrim(item.material_name)) > 255
        OR item.cost_type NOT IN ('material', 'lab', 'special_doctor')
        OR item.cost_amount IS NULL OR item.cost_amount <= 0 OR item.quantity IS NULL OR item.quantity <= 0
        OR (item.doctor_id IS NOT NULL AND item.cost_type <> 'special_doctor')
    ) THEN RAISE EXCEPTION 'Every MLS item requires a valid name, type, positive cost, and positive quantity. Doctor assignment is only allowed for Special Doctor costs.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_items) item(doctor_id UUID, cost_type TEXT)
    LEFT JOIN public.doctors doctor ON doctor.id = item.doctor_id
    WHERE item.cost_type = 'special_doctor' AND item.doctor_id IS NOT NULL AND doctor.id IS NULL
  ) THEN RAISE EXCEPTION 'Selected special doctor was not found.'; END IF;

  SELECT COALESCE(round(SUM(item.cost_amount * item.quantity), 2), 0) INTO v_total
  FROM jsonb_to_recordset(p_items) item(cost_amount NUMERIC, quantity NUMERIC);
  IF v_total > COALESCE(v_payment.cleared_amount, v_payment.amount) THEN RAISE EXCEPTION 'Payment MLS costs cannot exceed the amount collected in this payment.'; END IF;

  INSERT INTO public.audit_logs (source_type, source_id, location_id, patient_id, payment_id)
  VALUES ('payment', v_payment.id, v_payment.location_id, v_payment.patient_id, v_payment.id)
  ON CONFLICT (source_type, source_id) DO UPDATE SET location_id = EXCLUDED.location_id, patient_id = EXCLUDED.patient_id,
    payment_id = EXCLUDED.payment_id, doctor_id = NULL, treatment_id = NULL, updated_at = NOW()
  RETURNING id INTO v_audit_log_id;

  DELETE FROM public.patient_material_costs WHERE audit_log_id = v_audit_log_id;
  INSERT INTO public.patient_material_costs (audit_log_id, payment_id, material_name, cost_type, cost_amount, quantity, doctor_id, created_by, created_by_name)
  SELECT v_audit_log_id, v_payment.id, btrim(item.material_name), item.cost_type, round(item.cost_amount, 2), item.quantity,
    CASE WHEN item.cost_type = 'special_doctor' THEN item.doctor_id ELSE NULL END, p_user_id, v_actor_username
  FROM jsonb_to_recordset(p_items) item(material_name TEXT, cost_type TEXT, cost_amount NUMERIC, quantity NUMERIC, doctor_id UUID);

  SELECT COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'material'), 0),
    COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'lab'), 0),
    COALESCE(SUM(total_amount) FILTER (WHERE cost_type = 'special_doctor'), 0),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'material'), ''),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'lab'), ''),
    COALESCE(string_agg(material_name, ', ' ORDER BY created_at) FILTER (WHERE cost_type = 'special_doctor'), '')
  INTO v_material_total, v_lab_total, v_special_doctor_total, v_material_names, v_lab_names, v_special_doctor_names
  FROM public.patient_material_costs WHERE audit_log_id = v_audit_log_id;

  SELECT COALESCE(name, 'Unknown patient') INTO v_patient_name FROM public.patients WHERE id = v_payment.patient_id;
  SELECT COALESCE(string_agg(description, ' + ' ORDER BY date, id), 'Payment') INTO v_treatment_label
  FROM public.treatments WHERE id = ANY(COALESCE(v_payment.treatment_ids, '{}'::UUID[]));
  DELETE FROM public.expenses WHERE source_id = v_audit_log_id AND source_type IN ('material_cost', 'lab_cost', 'special_doctor_cost');
  IF v_material_total > 0 THEN INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_payment.location_id, 'Material cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_material_names <> '' THEN ' (' || v_material_names || ')' ELSE '' END, v_material_total, 'Material Cost', v_payment.payment_date, 'material_cost', v_audit_log_id, true); END IF;
  IF v_lab_total > 0 THEN INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_payment.location_id, 'Lab cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_lab_names <> '' THEN ' (' || v_lab_names || ')' ELSE '' END, v_lab_total, 'Lab Cost', v_payment.payment_date, 'lab_cost', v_audit_log_id, true); END IF;
  IF v_special_doctor_total > 0 THEN INSERT INTO public.expenses (location_id, description, amount, category, date, source_type, source_id, is_system_generated)
    VALUES (v_payment.location_id, 'Special doctor cost - ' || v_patient_name || ' - ' || v_treatment_label || CASE WHEN v_special_doctor_names <> '' THEN ' (' || v_special_doctor_names || ')' ELSE '' END, v_special_doctor_total, 'Special Doctor Cost', v_payment.payment_date, 'special_doctor_cost', v_audit_log_id, true); END IF;

  INSERT INTO public.pending_commission_recalculations (patient_id, request_token, requested_at)
  VALUES (v_payment.patient_id, p_request_token, NOW()) ON CONFLICT (patient_id) DO UPDATE
  SET request_token = EXCLUDED.request_token, requested_at = EXCLUDED.requested_at;
  SELECT COALESCE(jsonb_agg(to_jsonb(costs) ORDER BY costs.created_at, costs.id), '[]'::JSONB) INTO v_items
  FROM public.patient_material_costs costs WHERE costs.audit_log_id = v_audit_log_id;
  RETURN jsonb_build_object('audit_log_id', v_audit_log_id, 'payment_id', v_payment.id, 'material_total', v_material_total,
    'lab_total', v_lab_total, 'special_doctor_total', v_special_doctor_total,
    'total_amount', v_material_total + v_lab_total + v_special_doctor_total, 'items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_payment_costs(UUID, JSONB, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_payment_costs(UUID, JSONB, UUID, TEXT, UUID) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;