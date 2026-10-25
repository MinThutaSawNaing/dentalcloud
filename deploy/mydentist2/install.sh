#!/bin/bash
# Run as root from the uploaded deploy/mydentist2 directory. This does not
# install any keys; provisioning must supply a unique restricted public key.
set -euo pipefail
[[ $EUID == 0 ]]
cd -- "$(dirname -- "$0")"
command -v docker nginx certbot python3 curl sudo flock visudo >/dev/null
docker compose version
nginx -t
base=/opt/mydentist2
install -d -m 755 "$base" "$base/incoming" "$base/assets"
for file in Dockerfile nginx.conf compose.yml site-http.conf site-https.conf; do
    install -m 644 "$file" "$base/$file"
done
install -m 755 deploy.sh /usr/local/sbin/mydentist2-deploy
install -m 755 ensure-tls.sh /usr/local/sbin/mydentist2-ensure-tls
install -m 755 healthcheck.sh /usr/local/sbin/mydentist2-healthcheck
install -m 755 ssh-command.sh /usr/local/sbin/mydentist2-ssh-command
for script in /usr/local/sbin/mydentist2-*; do bash -n "$script"; done

id mydentist2deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash mydentist2deploy
install -d -o mydentist2deploy -g mydentist2deploy -m 700 /home/mydentist2deploy/.ssh
printf 'mydentist2deploy ALL=(root) NOPASSWD: /usr/local/sbin/mydentist2-deploy *\n' > /etc/sudoers.d/mydentist2
chmod 440 /etc/sudoers.d/mydentist2
visudo -cf /etc/sudoers.d/mydentist2
# Deployment inputs are read-only to the SSH account. It is NOT a docker-group
# member and cannot change the root-owned script or deployment templates.
chown -R root:root "$base"
chmod 700 "$base/incoming"

install -d -m 755 /var/www/mydentist2-acme/.well-known/acme-challenge /etc/nginx/snippets
if [[ ! -f /etc/nginx/snippets/mydentist2-upstream.conf ]]; then
    printf 'proxy_pass http://127.0.0.1:18083;\n' > /etc/nginx/snippets/mydentist2-upstream.conf
fi
if [[ ! -f /etc/nginx/sites-available/mydentist2.dentalcloud.asia ]]; then
    install -m 644 site-http.conf /etc/nginx/sites-available/mydentist2.dentalcloud.asia
fi
ln -sfn /etc/nginx/sites-available/mydentist2.dentalcloud.asia /etc/nginx/sites-enabled/mydentist2.dentalcloud.asia
nginx -t
systemctl reload nginx
for file in mydentist2-tls.service mydentist2-tls.timer mydentist2-health.service mydentist2-health.timer; do
    install -m 644 "$file" "/etc/systemd/system/$file"
done
systemctl daemon-reload
systemctl enable --now mydentist2-tls.timer mydentist2-health.timer certbot.timer
echo 'mydentist2 provisioning installed; supply the restricted deployment key next.'