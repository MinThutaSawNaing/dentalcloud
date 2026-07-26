-- ============================================================================
-- Material & Lab Cost Presets
-- ============================================================================
-- Additive migration. Existing treatment costs, expenses, and commission RPCs
-- are not modified. Presets are global clinic settings and are accessible only
-- through staff-session-authorized SECURITY DEFINER functions.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.staff_auth_sessions') IS NULL THEN
    RAISE EXCEPTION 'Staff authentication prerequisites are missing; preset migration was not applied.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.material_lab_cost_preset_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.material_lab_cost_preset_settings (id, revision)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.material_lab_cost_presets (
  id UUID PRIMARY KEY,
  cost_type VARCHAR(20) NOT NULL CHECK (cost_type IN ('material', 'lab')),
  label VARCHAR(255) NOT NULL CHECK (btrim(label) <> ''),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0 AND sort_order < 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT material_lab_cost_presets_sort_order_key UNIQUE (sort_order)
);

ALTER TABLE public.material_lab_cost_preset_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_lab_cost_presets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.material_lab_cost_preset_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.material_lab_cost_presets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_material_lab_cost_presets(
  p_user_id UUID,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_revision BIGINT;
  v_presets JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS u
    JOIN public.staff_auth_sessions AS s ON s.user_id = u.id
    WHERE u.id = p_user_id
      AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND (
        u.role = 'admin'
        OR (
          u.role = 'normal'
          AND u.doctor_id IS NULL
          AND jsonb_typeof(u.allowed_tabs) = 'array'
          AND u.allowed_tabs ? 'material-cost'
        )
      )
  ) THEN
    RAISE EXCEPTION 'A valid staff session with Material & Lab permission is required.';
  END IF;

  SELECT settings.revision
  INTO v_revision
  FROM public.material_lab_cost_preset_settings AS settings
  WHERE settings.id = 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', presets.id,
        'cost_type', presets.cost_type,
        'label', presets.label,
        'amount', presets.amount,
        'sort_order', presets.sort_order,
        'created_at', presets.created_at,
        'updated_at', presets.updated_at
      ) ORDER BY presets.sort_order, presets.label
    ),
    '[]'::JSONB
  )
  INTO v_presets
  FROM public.material_lab_cost_presets AS presets;

  RETURN jsonb_build_object(
    'revision', COALESCE(v_revision, 0),
    'presets', v_presets
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_material_lab_cost_presets(
  p_items JSONB,
  p_expected_revision BIGINT,
  p_user_id UUID,
  p_session_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_current_revision BIGINT;
  v_next_revision BIGINT;
  v_presets JSONB;
  v_created_at_by_id JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users AS u
    JOIN public.staff_auth_sessions AS s ON s.user_id = u.id
    WHERE u.id = p_user_id
      AND s.session_token::TEXT = btrim(COALESCE(p_session_token, ''))
      AND s.revoked_at IS NULL
      AND s.expires_at > NOW()
      AND (
        u.role = 'admin'
        OR (
          u.role = 'normal'
          AND u.doctor_id IS NULL
          AND jsonb_typeof(u.allowed_tabs) = 'array'
          AND u.allowed_tabs ? 'material-cost'
        )
      )
  ) THEN
    RAISE EXCEPTION 'A valid staff session with Material & Lab permission is required.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Presets must be a JSON array.';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'A maximum of 100 presets is allowed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS raw(item)
    WHERE jsonb_typeof(raw.item) <> 'object'
  ) THEN
    RAISE EXCEPTION 'Every preset must be an object.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      id UUID, cost_type TEXT, label TEXT, amount NUMERIC, sort_order INTEGER
    )
    WHERE item.id IS NULL
      OR item.cost_type NOT IN ('material', 'lab')
      OR btrim(COALESCE(item.label, '')) = ''
      OR char_length(btrim(item.label)) > 255
      OR item.amount IS NULL OR item.amount <= 0 OR item.amount > 9999999999.99
      OR item.sort_order IS NULL OR item.sort_order < 0 OR item.sort_order >= 100
  ) THEN
    RAISE EXCEPTION 'Each preset needs a unique id, category, label, positive amount, and valid order.';
  END IF;

  IF EXISTS (
    SELECT item.id
    FROM jsonb_to_recordset(p_items) AS item(id UUID)
    GROUP BY item.id HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT item.sort_order
    FROM jsonb_to_recordset(p_items) AS item(sort_order INTEGER)
    GROUP BY item.sort_order HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Preset identifiers and order values must be unique.';
  END IF;

  SELECT settings.revision
  INTO v_current_revision
  FROM public.material_lab_cost_preset_settings AS settings
  WHERE settings.id = 1
  FOR UPDATE;

  IF v_current_revision IS NULL THEN
    RAISE EXCEPTION 'Preset settings are not initialized.';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision <> v_current_revision THEN
    RAISE EXCEPTION 'Preset list changed on another device.';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(presets.id::TEXT, to_jsonb(presets.created_at)),
    '{}'::JSONB
  )
  INTO v_created_at_by_id
  FROM public.material_lab_cost_presets AS presets;

  DELETE FROM public.material_lab_cost_presets
  WHERE id IS NOT NULL;
  INSERT INTO public.material_lab_cost_presets (
    id, cost_type, label, amount, sort_order, created_at, updated_at
  )
  SELECT
    item.id,
    item.cost_type,
    btrim(item.label),
    item.amount,
    item.sort_order,
    COALESCE((v_created_at_by_id ->> item.id::TEXT)::TIMESTAMPTZ, NOW()),
    NOW()
  FROM jsonb_to_recordset(p_items) AS item(
    id UUID, cost_type TEXT, label TEXT, amount NUMERIC, sort_order INTEGER
  );

  v_next_revision := v_current_revision + 1;
  UPDATE public.material_lab_cost_preset_settings
  SET revision = v_next_revision, updated_by = p_user_id, updated_at = NOW()
  WHERE id = 1;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', presets.id,
        'cost_type', presets.cost_type,
        'label', presets.label,
        'amount', presets.amount,
        'sort_order', presets.sort_order,
        'created_at', presets.created_at,
        'updated_at', presets.updated_at
      ) ORDER BY presets.sort_order, presets.label
    ),
    '[]'::JSONB
  )
  INTO v_presets
  FROM public.material_lab_cost_presets AS presets;

  RETURN jsonb_build_object('revision', v_next_revision, 'presets', v_presets);
END;
$$;

REVOKE ALL ON FUNCTION public.get_material_lab_cost_presets(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_material_lab_cost_presets(UUID, TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_material_lab_cost_presets(JSONB, BIGINT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_material_lab_cost_presets(JSONB, BIGINT, UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  to_regclass('public.material_lab_cost_presets') IS NOT NULL AS preset_table_ready,
  to_regclass('public.material_lab_cost_preset_settings') IS NOT NULL AS preset_revision_ready,
  to_regprocedure('public.get_material_lab_cost_presets(uuid,text)') IS NOT NULL AS preset_read_rpc_ready,
  to_regprocedure('public.replace_material_lab_cost_presets(jsonb,bigint,uuid,text)') IS NOT NULL AS preset_write_rpc_ready;
