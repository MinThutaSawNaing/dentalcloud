#!/bin/bash
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
base=/opt/mydentist2
domain=mydentist2.dentalcloud.asia
exec 9>"$base/tls.lock"
flock -n 9 || exit 0

if [[ ! -f /etc/letsencrypt/live/$domain/fullchain.pem ]]; then
    if ! python3 -c '
import socket
try:
    addresses = {r[4][0] for r in socket.getaddrinfo("mydentist2.dentalcloud.asia", 80, type=socket.SOCK_STREAM)}
except socket.gaierror:
    raise SystemExit("DNS record is not available yet")
if addresses != {"47.79.35.105"}: raise SystemExit("DNS must resolve only to 47.79.35.105 for initial issuance")
'; then
        echo 'Waiting for DNS: A mydentist2.dentalcloud.asia -> 47.79.35.105 (DNS only; no AAAA).'
        exit 0
    fi
    # Avoid hammering the CA if DNS is ready but ingress/firewall is not.
    if [[ -f $base/last-certificate-attempt ]] && \
        (( $(date +%s) - $(stat -c %Y "$base/last-certificate-attempt") < 21600 )); then
        echo 'Next certificate retry is allowed six hours after the last attempt.'
        exit 0
    fi
    touch "$base/last-certificate-attempt"
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
        --webroot -w /var/www/mydentist2-acme --cert-name "$domain" -d "$domain" \
        --deploy-hook 'nginx -t && systemctl reload nginx'
fi

if ! cmp -s "$base/site-https.conf" /etc/nginx/sites-available/mydentist2.dentalcloud.asia; then
    cp /etc/nginx/sites-available/mydentist2.dentalcloud.asia "$base/site-before-tls.conf"
    install -m 644 "$base/site-https.conf" /etc/nginx/sites-available/mydentist2.dentalcloud.asia
    if ! nginx -t; then
        cp "$base/site-before-tls.conf" /etc/nginx/sites-available/mydentist2.dentalcloud.asia
        exit 1
    fi
    if ! systemctl reload nginx; then
        cp "$base/site-before-tls.conf" /etc/nginx/sites-available/mydentist2.dentalcloud.asia
        exit 1
    fi
fi
nginx -t && systemctl reload nginx
systemctl enable --now certbot.timer
curl --fail --silent --max-time 10 --resolve "$domain:443:127.0.0.1" "https://$domain/health"
if [[ ! -f $base/renewal-dry-run-passed ]]; then
    certbot renew --cert-name "$domain" --dry-run --non-interactive
    touch "$base/renewal-dry-run-passed"
fi
echo 'HTTPS and automatic renewal are configured.'