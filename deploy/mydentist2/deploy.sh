#!/bin/bash
set -Eeuo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 027
[[ $# == 1 && $1 =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
sha=$1
base=/opt/mydentist2
exec 9>"$base/deploy.lock"
flock -w 180 9
work=$(mktemp -d "$base/incoming/release.XXXXXXXX")
switched=0
committed=0
candidate_started=0
old_slot=
old_sha=
slot=blue
port=18083
if [[ -s $base/current-release ]]; then
    read -r old_slot old_sha < "$base/current-release"
    [[ $old_slot =~ ^(blue|green)$ && $old_sha =~ ^[a-f0-9]{40}$ ]]
    if [[ $old_slot == blue ]]; then slot=green; port=18084; fi
fi
compose() {
    IMAGE_TAG="$sha" SLOT="$slot" APP_PORT="$port" \
        docker compose -p "mydentist2-$slot" -f "$base/compose.yml" "$@"
}
cleanup() {
    rc=$?
    trap - EXIT
    if (( ! committed )); then
        if (( switched )); then
            cp "$work/previous-upstream.conf" /etc/nginx/snippets/mydentist2-upstream.conf
            if ! { nginx -t && systemctl reload nginx; }; then
                echo 'ROLLBACK RELOAD FAILED: leaving candidate running to avoid an outage.' >&2
                candidate_started=0
            fi
        fi
        if (( candidate_started )); then compose down --timeout 10 || true; fi
    fi
    rm -rf -- "$work"
    exit "$rc"
}
trap cleanup EXIT

# Read a bounded artifact stream and extract only regular files/directories.
# Never trust tar paths, links, device files, or unbounded decompression as root.
python3 -c '
import sys, tarfile, pathlib, shutil, resource, signal, gzip
resource.setrlimit(resource.RLIMIT_AS, (192 * 1024 * 1024, 192 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024 * 1024, 128 * 1024 * 1024))
signal.alarm(120)
root = pathlib.Path(sys.argv[1])
archive = root / "artifact.tar.gz"
limit = 64 * 1024 * 1024
total = 0
with archive.open("wb") as output:
    while True:
        chunk = sys.stdin.buffer.read(1024 * 1024)
        if not chunk: break
        total += len(chunk)
        if total > limit: raise SystemExit("Compressed artifact exceeds 64 MiB")
        output.write(chunk)
dest = root / "dist"
dest.mkdir()
class BoundedReader:
    def __init__(self, stream): self.stream, self.total = stream, 0
    def read(self, size=-1):
        data = self.stream.read(min(size if size >= 0 else 65536, 65536))
        self.total += len(data)
        if self.total > 144 * 1024 * 1024: raise SystemExit("Tar stream exceeds 144 MiB")
        return data
count, expanded = 0, 0
with gzip.open(archive, "rb") as raw, tarfile.open(fileobj=BoundedReader(raw), mode="r|") as tar:
    for member in tar:
        count += 1
        expanded += member.size
        if count > 10000 or expanded > 128 * 1024 * 1024:
            raise SystemExit("Too many entries or expanded artifact exceeds 128 MiB")
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
            raise SystemExit("Unsafe artifact entry")
        target = dest.joinpath(*path.parts)
        if member.isdir():
            target.mkdir(parents=True, exist_ok=True)
            target.chmod(0o755)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(member) as src, target.open("wb") as output:
                shutil.copyfileobj(src, output)
            target.chmod(0o644)
if not (dest / "index.html").is_file() or not (dest / "assets").is_dir():
    raise SystemExit("Missing Vite production output")
' "$work"
printf '%s\n' "$sha" > "$work/dist/release.txt"
chmod 644 "$work/dist/release.txt"

# Preserve two previous releases' hashed assets for already-open lazy-loaded
# sessions. Store only each release's own assets, not the merged image output.
mkdir -p "$base/assets/$sha"
cp -a "$work/dist/assets/." "$base/assets/$sha/"
for retained_sha in "$old_sha" "$(cat "$base/previous-sha" 2>/dev/null || true)"; do
    if [[ $retained_sha =~ ^[a-f0-9]{40}$ && -d $base/assets/$retained_sha ]]; then
        cp -an "$base/assets/$retained_sha/." "$work/dist/assets/"
    fi
done
cp "$base/Dockerfile" "$base/nginx.conf" "$work/"
chmod 644 "$work/Dockerfile" "$work/nginx.conf"
docker build --label asia.dentalcloud.app=mydentist2 -t "mydentist2:$sha" "$work"
candidate_started=1
if ! compose up -d --wait --wait-timeout 90; then
    docker logs --tail 50 "mydentist2-$slot" >&2 || true
    exit 1
fi
[[ $(curl --fail --silent --max-time 5 "http://127.0.0.1:$port/health") == ok ]]
curl --fail --silent --max-time 5 "http://127.0.0.1:$port/" | grep -q '<div id="root">'

cp /etc/nginx/snippets/mydentist2-upstream.conf "$work/previous-upstream.conf"
printf 'proxy_pass http://127.0.0.1:%s;\n' "$port" > "$work/new-upstream.conf"
install -m 644 "$work/new-upstream.conf" /etc/nginx/snippets/mydentist2-upstream.conf
switched=1
nginx -t
systemctl reload nginx
if [[ -f /etc/letsencrypt/live/mydentist2.dentalcloud.asia/fullchain.pem ]]; then
    [[ $(curl --fail --silent --max-time 10 --resolve mydentist2.dentalcloud.asia:443:127.0.0.1 \
        https://mydentist2.dentalcloud.asia/health) == ok ]]
    [[ $(curl --fail --silent --max-time 10 --resolve mydentist2.dentalcloud.asia:443:127.0.0.1 \
        https://mydentist2.dentalcloud.asia/release.txt) == "$sha" ]]
fi
printf '%s %s\n' "$slot" "$sha" > "$base/current-release.new"
mv "$base/current-release.new" "$base/current-release"
committed=1
printf '%s\n' "$old_sha" > "$base/previous-sha"

# Keep the previous container available but stopped for operator rollback.
# Allow more than the proxy read timeout for old requests to drain.
if [[ -n $old_slot ]]; then
    sleep 35
    docker stop --time 15 "mydentist2-$old_slot" || true
fi
# Prune only this app's release tags, keeping the newest five plus any in use.
docker image ls mydentist2 --format '{{.Repository}}:{{.Tag}}' | tail -n +6 | \
    while read -r image; do docker image rm "$image" || true; done
find "$base/assets" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 | \
    cut -d ' ' -f2- | while read -r directory; do rm -rf -- "$directory"; done
echo "Deployed $sha to $slot on 127.0.0.1:$port"