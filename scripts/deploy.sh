#!/usr/bin/env bash
# One-command Gallery deploy/update for a Docker host.
#
# Usage:
#   ./scripts/deploy.sh                 # pull :latest and restart
#   ./scripts/deploy.sh sha-82d0158     # pin both images to a commit tag
#   ./scripts/deploy.sh --init          # first-time setup (creates .env placeholder)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="latest"
INIT=0
for arg in "$@"; do
  case "$arg" in
    --init) INIT=1 ;;
    -h|--help)
      sed -n '2,8p' "$0"
      exit 0
      ;;
    *) TAG="$arg" ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose plugin is required" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.docker.example ]]; then
    cp .env.docker.example .env
    echo "Created .env from .env.docker.example"
  else
    echo "Missing .env and .env.docker.example" >&2
    exit 1
  fi
fi

# Load .env for this shell (compose also reads it automatically).
set -a
# shellcheck disable=SC1091
source .env
set +a

UPLOAD_ENV_HOST_PATH="${UPLOAD_ENV_HOST_PATH:-./script/upload_r2.env}"
if [[ ! -f "$UPLOAD_ENV_HOST_PATH" ]]; then
  echo "Upload credentials file not found: $UPLOAD_ENV_HOST_PATH" >&2
  if [[ "$INIT" -eq 1 ]]; then
    mkdir -p "$(dirname "$UPLOAD_ENV_HOST_PATH")"
    cat >"$UPLOAD_ENV_HOST_PATH" <<'EOF'
# Fill remote upload credentials used by script/upload_r2.py
# Required R2-style keys typically include:
#   R2_ENDPOINT=
#   R2_ACCESS_KEY_ID=
#   R2_SECRET_ACCESS_KEY=
#   R2_BUCKET=
#   R2_PREFIX=gallery
EOF
    echo "Created placeholder $UPLOAD_ENV_HOST_PATH"
    echo "Fill credentials, set UPLOAD_ACCESS_TOKEN in .env if needed, then re-run:"
    echo "  ./scripts/deploy.sh"
    exit 0
  fi
  echo "Set UPLOAD_ENV_HOST_PATH in .env, or run: ./scripts/deploy.sh --init" >&2
  exit 1
fi

export BACKEND_IMAGE="ghcr.io/kohakunamori/gallery-backend:${TAG}"
export FRONTEND_IMAGE="ghcr.io/kohakunamori/gallery-frontend:${TAG}"
export GALLERY_HTTP_PORT="${GALLERY_HTTP_PORT:-8088}"
export MEDIA_BASE_URL="${MEDIA_BASE_URL:-https://static.cf.nyaneko.cn/gallery}"
export UPLOAD_ENV_HOST_PATH
export GALLERY_DATA_HOST_PATH="${GALLERY_DATA_HOST_PATH:-./data/gallery}"

mkdir -p "$GALLERY_DATA_HOST_PATH"
if [[ ! -f "$GALLERY_DATA_HOST_PATH/photos-index.json" ]]; then
  printf '%s\n' '{"version":1,"updatedAt":"1970-01-01T00:00:00Z","items":[]}' >"$GALLERY_DATA_HOST_PATH/photos-index.json"
  echo "Created empty $GALLERY_DATA_HOST_PATH/photos-index.json"
fi
export GALLERY_DATA_HOST_PATH

# Keep .env image tags in sync for next plain `docker compose` usage.
if grep -q '^BACKEND_IMAGE=' .env 2>/dev/null; then
  # portable in-place update
  tmp="$(mktemp)"
  sed \
    -e "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=${BACKEND_IMAGE}|" \
    -e "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=${FRONTEND_IMAGE}|" \
    .env >"$tmp"
  mv "$tmp" .env
fi

echo "==> Backend : $BACKEND_IMAGE"
echo "==> Frontend: $FRONTEND_IMAGE"
echo "==> Port    : $GALLERY_HTTP_PORT"
echo "==> Media   : $MEDIA_BASE_URL"
echo "==> Upload  : $UPLOAD_ENV_HOST_PATH"

echo "==> Pull images"
docker compose pull

echo "==> Start / recreate"
docker compose up -d --remove-orphans

echo "==> Wait for health (up to 90s)"
deadline=$((SECONDS + 90))
ok=0
while (( SECONDS < deadline )); do
  if curl -fsS "http://127.0.0.1:${GALLERY_HTTP_PORT}/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${GALLERY_HTTP_PORT}/" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

docker compose ps

if [[ "$ok" -ne 1 ]]; then
  echo "Services started but health checks did not pass within 90s." >&2
  echo "Check logs: docker compose logs --tail=100" >&2
  exit 1
fi

host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Gallery is up"
if [[ -n "${host_ip:-}" ]]; then
  echo "  Public UI : http://${host_ip}:${GALLERY_HTTP_PORT}/"
fi
echo "  Local UI  : http://127.0.0.1:${GALLERY_HTTP_PORT}/"
echo "  Health    : http://127.0.0.1:${GALLERY_HTTP_PORT}/health"
