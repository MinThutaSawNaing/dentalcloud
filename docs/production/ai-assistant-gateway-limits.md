# AI assistant request limits and Supabase gateway buffers

Production host: `13.140.149.162` (self-hosted Supabase, `supabasemydentist.dentalcloud.asia`).
The browser calls the `ai-assistant` Edge Function through Kong behind host nginx.

## 1. Edge Function request limits

`supabase/functions/ai-assistant/index.ts` is deployed to
`/root/supabasemydentist/supabase-project/volumes/functions/ai-assistant/index.ts`.
The edge runtime reads that file at request time, so replacing it is enough.

The assistant sends its instructions, product knowledge and practice data as one
`system` message of roughly 30k characters. The previous single 24k per-message
cap rejected every chat with `Invalid AI conversation.` while "Test connection"
still passed (it sends `Reply with OK.`).

| Constant | Before | After | Reason |
| --- | --- | --- | --- |
| `maxBodyBytes` | 220,000 | 500,000 | Covers JSON escaping/Unicode of the allowed payload |
| `maxMessages` | 60 | 90 | Client sends system + up to 80 history entries + user |
| `maxMessageChars` | 24,000 | 24,000 | Unchanged for user/assistant turns |
| `maxSystemChars` | — | 64,000 | Large system prompt only |
| `maxTotalChars` | 120,000 | 220,000 | System prompt + maximum compacted history + user turn |

Per-message validation is now role aware and returns `AI message is too long.`
instead of the generic conversation error. Authentication, the `ai-assistant`
permission check, the 30 requests/minute rate limit and the 12,000 `max_tokens`
clamp are unchanged.

## 2. Host nginx response-header buffers

`/etc/nginx/sites-available/supabasemydentist.dentalcloud.asia` proxies to Kong.
`proxy_buffer_size` was not configured, so nginx used its 4k default. PostgREST
returns the request URI in `content-location` (exposed by Kong's CORS plugin);
long PostgREST queries therefore produce response headers larger than 4k:

```
[error] upstream sent too big header while reading response header from upstream,
        request: "GET /rest/v1/treatments?...&date=in.(...)"
```

nginx answers 502 without `Access-Control-Allow-Origin`, which the browser reports
as a CORS failure. Only `/rest/v1/treatments` hit this (34 in one day, 128 in the
rotated logs) because that query embeds patient UUIDs plus every clinic date.

Add inside the `server { listen 443 ssl; ... }` block:

```nginx
proxy_buffer_size 16k;
proxy_buffers 8 16k;
```

Apply and verify:

```bash
cp -a /etc/nginx/sites-available/supabasemydentist.dentalcloud.asia \
      /etc/nginx/sites-available/supabasemydentist.dentalcloud.asia.bak.$(date +%Y%m%d%H%M%S)
nginx -t && systemctl reload nginx
grep -c "upstream sent too big header" /var/log/nginx/error.log
```

`large_client_header_buffers 4 16k` in the same vhost only covers request
headers; it does not affect this failure.

## 3. Assistant bundle latency

The assistant still downloads the complete clinic bundle before enabling send.
`commissionRequestConcurrency: 3` now matches the MLS loaders, so payment and
treatment commission enrichment no longer runs one 50-id batch at a time. Full
scoping of the assistant bundle (date windows, progress, abort) remains a larger
follow-up; this document only covers the two production fixes above.

## Rollback

- Function: restore the previous `index.ts` backup and send a request; no
  container restart is required.
- nginx: restore the `*.bak.*` vhost, run `nginx -t`, then reload.
