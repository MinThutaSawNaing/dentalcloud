# AI Assistant Edge Function

The browser never receives the AI provider key. An administrator saves it once
under **Settings → AI Assistant**. This function encrypts it with AES-256-GCM
before writing it to the private database schema, then decrypts it only while
proxying a request to the AI provider.

## Required database migration

Apply `supabase/migrations/20261115000000_ai_assistant_secure_settings.sql`
(or `database/ai_assistant_secure_settings.sql`) before deploying this function.

## Optional dedicated encryption key

Without extra configuration, the function derives its encryption subkey with
HKDF-SHA256 from `SUPABASE_SERVICE_ROLE_KEY`. That keeps the ciphertext useless
in a database-only leak and requires no new deployment secret.

For stronger key separation, provision a dedicated 32-byte key and store it as
a base64 value in the function environment:

```bash
openssl rand -base64 32
```

Set the result as `AI_SETTINGS_ENCRYPTION_KEY` in the Edge Function secrets and
redeploy the function. New saves use the dedicated key; previously saved values
remain readable through their stored key version. Never commit this value.

If `SUPABASE_SERVICE_ROLE_KEY` is rotated without a dedicated encryption key,
an administrator must save the AI key again.

## Authorization

- `status`: signed-in staff with the `ai-assistant` tab (admins always allowed).
- `complete`: same rule, rate limited per staff user.
- `save`, `remove`, `test`: administrators only.
- Patient sessions and staff without the tab are rejected.

The function never returns the API key, ciphertext, or provider headers.
