# mydentist2 production operations

This deploys only the Vite frontend. The existing Supabase backend and database
are not copied, migrated, or modified. Do not inject private API keys into Vite:
frontend build-time values are visible in the browser. The AI assistant remains
in its existing fallback mode when no frontend AI key is configured.

## Live layout

- Host: `47.79.35.105` (Debian 12, existing nginx and Docker).
- Domain: `mydentist2.dentalcloud.asia`.
- Root-owned runtime templates/state: `/opt/mydentist2`.
- Blue/green containers: `mydentist2-blue`, `mydentist2-green`.
- Loopback upstreams: `127.0.0.1:18083`, `127.0.0.1:18084`.
- Restricted SSH account: `mydentist2deploy` (not in the Docker group).
- Deployment entrypoint: `/usr/local/sbin/mydentist2-deploy`.
- Host nginx site: `/etc/nginx/sites-available/mydentist2.dentalcloud.asia`.
- Active upstream: `/etc/nginx/snippets/mydentist2-upstream.conf`.

The container is unprivileged, read-only, limited to 64 MiB RAM / 0.25 CPU /
64 processes, with bounded logs and a small writable tmpfs. A health timer
recovers the active container if unhealthy. The previous slot remains stopped
for manual rollback; three releases of hashed assets are retained for open tabs.
This is still a single shared host, not a high-availability cluster. Monitor host
memory, disk, certificate expiry and uptime independently.

## GitHub Actions

Workflow: `.github/workflows/deploy-mydentist2.yml`.

Pull requests run tests and a production build without deploying. Pushes to
`main` and manual runs on `main` test, build, then stream the static artifact to
the forced SSH command. Builds run on GitHub, not this small production host.

Repository Actions secrets:

- `MYDENTIST2_HOST`
- `MYDENTIST2_SSH_KEY` (unique Ed25519 key, not the root password)
- `MYDENTIST2_KNOWN_HOSTS` (pinned server host key)

The SSH authorized key uses `restrict` and a root-owned forced-command wrapper.
Only `deploy <40-character SHA>` is accepted. Uploaded artifacts have bounded
size, extraction memory, CPU and execution time; symlinks and traversal are
rejected. No source-controlled server-side script is executed from the artifact.

Infrastructure files are deliberately root-managed. Workflow releases update
only static frontend artifacts. To apply infrastructure changes, upload this
directory as an administrator and run `bash install.sh`, then review nginx and
systemd status. This separation prevents a leaked deploy key from replacing
privileged host scripts. Keep the base image digest maintained deliberately.

## DNS and SSL activation

In Cloudflare, create **DNS-only A record `mydentist2` -> `47.79.35.105`**.
Do not add an AAAA record unless IPv6 and the activation check are configured.
Keep inbound TCP 80/443 reachable. No DNS-provider API credentials are stored.

The `mydentist2-tls.timer` checks every 15 minutes. Once DNS is ready it obtains
a webroot certificate, activates HTTPS, and performs a renewal dry run. Failed
issuance attempts are rate-limited to once per six hours. Before HTTPS is ready,
HTTP serves a 503 maintenance response, not the clinical application.

Certbot's existing `certbot.timer` handles subsequent renewal with an nginx
reload deploy hook. No contact email was supplied for this setup; add an
administrator email to the Certbot account separately. Do not use Cloudflare
Flexible SSL. Retaining DNS-only avoids changing the initial issuance check.

```bash
systemctl start mydentist2-tls.service
journalctl -u mydentist2-tls.service -n 80 --no-pager
systemctl list-timers certbot.timer mydentist2-tls.timer mydentist2-health.timer
certbot renew --cert-name mydentist2.dentalcloud.asia --dry-run
```

## Verify a release

```bash
cat /opt/mydentist2/current-release
docker ps --filter name=mydentist2
docker stats --no-stream --filter name=mydentist2
nginx -t
curl --fail https://mydentist2.dentalcloud.asia/health
curl --fail https://mydentist2.dentalcloud.asia/release.txt
```

An authenticated clinic workflow was not exercised by deployment automation.
Validate login, branch selection, uploads, camera scanning and printing with an
authorized test account. Existing Supabase redirect/CORS settings may need the
new origin if authentication providers enforce an allowlist.

## Emergency rollback (root)

Prefer reverting the application commit on `main`, which re-runs CI and the
health-gated deployment. For immediate rollback, read the active slot from
`current-release`, identify the **other** stopped container and its image, and:

1. Start the previous container and confirm its `/health` and `/release.txt`
   on its loopback port (blue 18083 / green 18084).
2. Back up the upstream snippet. Point it to the previous port, run `nginx -t`,
   and reload nginx only if validation passes.
3. Verify HTTPS and write the previous slot/SHA to `current-release` so the
   recovery timer and next deployment track the correct container.
4. Allow at least 35 seconds for requests to drain before stopping the bad slot.

Never stop a live upstream after an unsuccessful nginx reload. Never globally
prune Docker images or volumes on this shared server. Existing websites,
containers and database volumes must be preserved.