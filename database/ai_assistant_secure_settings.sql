-- ============================================================================
-- SECURE AI ASSISTANT SETTINGS
-- Stores the AI provider key encrypted by the `ai-assistant` Edge Function.
-- The plaintext key is never stored in this table and never returned by any
-- RPC or browser-facing API. Only the service role may read the ciphertext.
-- Safe to run multiple times.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private_ai;
REVOKE ALL ON SCHEMA private_ai FROM PUBLIC;
REVOKE ALL ON SCHEMA private_ai FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private_ai.ai_assistant_config (
  singleton boolean PRIMARY KEY DEFAULT true,
  api_key_ciphertext text NOT NULL,
  api_key_iv text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  model text NOT NULL DEFAULT 'deepseek-ai/deepseek-v3.2',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT ai_assistant_config_singleton CHECK (singleton),
  CONSTRAINT ai_assistant_config_key_version CHECK (key_version IN (1, 2)),
  CONSTRAINT ai_assistant_config_ciphertext_length CHECK (length(api_key_ciphertext) BETWEEN 16 AND 16384),
  CONSTRAINT ai_assistant_config_iv_length CHECK (length(api_key_iv) BETWEEN 8 AND 128),
  CONSTRAINT ai_assistant_config_model_length CHECK (length(model) BETWEEN 1 AND 120)
);

ALTER TABLE private_ai.ai_assistant_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_ai.ai_assistant_config FROM PUBLIC;
REVOKE ALL ON private_ai.ai_assistant_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private_ai.ai_assistant_config_audit (
  id bigserial PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('saved', 'removed')),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private_ai.ai_assistant_config_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private_ai.ai_assistant_config_audit FROM PUBLIC;
REVOKE ALL ON private_ai.ai_assistant_config_audit FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS private_ai.ai_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL CHECK (hits >= 0)
);

REVOKE ALL ON private_ai.ai_rate_limits FROM PUBLIC;
REVOKE ALL ON private_ai.ai_rate_limits FROM anon, authenticated;

-- Returns only ciphertext metadata for the service-role Edge Function.
CREATE OR REPLACE FUNCTION public.ai_assistant_config_get()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'api_key_ciphertext', c.api_key_ciphertext,
    'api_key_iv', c.api_key_iv,
    'key_version', c.key_version,
    'model', c.model,
    'updated_at', c.updated_at
  )
  FROM private_ai.ai_assistant_config c
  WHERE c.singleton
$$;

CREATE OR REPLACE FUNCTION public.ai_assistant_config_put(
  p_ciphertext text,
  p_iv text,
  p_key_version integer,
  p_model text,
  p_actor uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_ciphertext IS NULL OR length(p_ciphertext) < 16 THEN
    RAISE EXCEPTION 'Invalid AI configuration';
  END IF;
  IF p_iv IS NULL OR length(p_iv) < 8 THEN
    RAISE EXCEPTION 'Invalid AI configuration';
  END IF;
  IF p_key_version NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Invalid AI configuration';
  END IF;
  IF p_model IS NULL OR length(p_model) < 1 OR length(p_model) > 120 THEN
    RAISE EXCEPTION 'Invalid AI configuration';
  END IF;

  INSERT INTO private_ai.ai_assistant_config AS c (
    singleton, api_key_ciphertext, api_key_iv, key_version, model, updated_at, updated_by
  )
  VALUES (true, p_ciphertext, p_iv, p_key_version, p_model, now(), p_actor)
  ON CONFLICT (singleton) DO UPDATE SET
    api_key_ciphertext = EXCLUDED.api_key_ciphertext,
    api_key_iv = EXCLUDED.api_key_iv,
    key_version = EXCLUDED.key_version,
    model = EXCLUDED.model,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by
  RETURNING jsonb_build_object('model', c.model, 'updated_at', c.updated_at) INTO v_result;

  INSERT INTO private_ai.ai_assistant_config_audit (action, actor_id, model)
  VALUES ('saved', p_actor, p_model);

  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION public.ai_assistant_config_delete(p_actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM private_ai.ai_assistant_config WHERE singleton;

  INSERT INTO private_ai.ai_assistant_config_audit (action, actor_id)
  VALUES ('removed', p_actor);
END
$$;

-- Fixed-window limiter used by the Edge Function for AI calls.
CREATE OR REPLACE FUNCTION public.ai_assistant_rate_limit(
  p_key text,
  p_limit integer,
  p_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hits integer;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR p_limit < 1 OR p_seconds < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO private_ai.ai_rate_limits (key, window_start, hits)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE
      WHEN private_ai.ai_rate_limits.window_start < now() - make_interval(secs => p_seconds)
        THEN 1
      ELSE private_ai.ai_rate_limits.hits + 1
    END,
    window_start = CASE
      WHEN private_ai.ai_rate_limits.window_start < now() - make_interval(secs => p_seconds)
        THEN now()
      ELSE private_ai.ai_rate_limits.window_start
    END
  RETURNING hits INTO v_hits;

  RETURN v_hits <= p_limit;
END
$$;

REVOKE ALL ON FUNCTION public.ai_assistant_config_get() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_config_get() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_assistant_config_put(text, text, integer, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_config_put(text, text, integer, text, uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_assistant_config_delete(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_config_delete(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_assistant_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_assistant_rate_limit(text, integer, integer) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ai_assistant_config_get() TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_assistant_config_put(text, text, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_assistant_config_delete(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_assistant_rate_limit(text, integer, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
