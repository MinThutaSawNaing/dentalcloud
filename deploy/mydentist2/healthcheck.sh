#!/bin/bash
set -euo pipefail
[[ -s /opt/mydentist2/current-release ]] || exit 0
read -r slot sha < /opt/mydentist2/current-release
[[ $slot =~ ^(blue|green)$ && $sha =~ ^[a-f0-9]{40}$ ]]
status=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "mydentist2-$slot")
case "$status" in
    'running unhealthy'|'exited '*|'dead '*)
        logger -t mydentist2 "Recovering active container mydentist2-$slot ($status)"
        docker restart "mydentist2-$slot"
        ;;
esac