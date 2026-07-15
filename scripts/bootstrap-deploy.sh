#!/usr/bin/env bash
# Minimal bootstrap: download only deploy files (no full source tree) and start Gallery.
#
# One-liner on a fresh Docker host:
#   curl -fsSL https://raw.githubusercontent.com/kohakunamori/Gallery/master/scripts/bootstrap-deploy.sh | bash
#
# Options via env:
#   GALLERY_DIR=/opt/gallery
#   GALLERY_TAG=latest          # or sha-82d0158
#   GALLERY_HTTP_PORT=8088
#   MEDIA_BASE_URL=https://static.cf.nyaneko.cn/gallery
set -euo pipefail

REPO_RAW="${GALLERY_RAW_BASE:-https://raw.githubusercontent.com/kohakunamori/Gallery/master}"
DIR="${GALLERY_DIR:-$HOME/gallery}"
TAG="${GALLERY_TAG:-latest}"
PORT="${GALLERY_HTTP_PORT:-8088}"
MEDIA="${MEDIA_BASE_URL:-https://static.cf.nyaneko.cn/gallery}"

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }
}

need curl
need docker
docker compose version >/dev/null 2>&1 || { echo "docker compose plugin is required" >&2; exit 1; }

mkdir -p "$DIR/script" "$DIR/scripts" "$DIR/data/gallery"
cd "$DIR"

download() {
  local path="$1"
  local dest="$2"
  echo "  fetch $path"
  curl -fsSL "$REPO_RAW/$path" -o "$dest"
}

echo "==> Bootstrap Gallery into $DIR"
download docker-compose.yml docker-compose.yml
download .env.docker.example .env.docker.example
download scripts/deploy.sh scripts/deploy.sh
chmod +x scripts/deploy.sh

if [[ ! -f .env ]]; then
  cp .env.docker.example .env
  # Prefer portable sed; fall back to overwrite if needed.
  if command -v sed >/dev/null 2>&1; then
    tmp="$(mktemp)"
    sed \
      -e "s|^GALLERY_HTTP_PORT=.*|GALLERY_HTTP_PORT=${PORT}|" \
      -e "s|^MEDIA_BASE_URL=.*|MEDIA_BASE_URL=${MEDIA}|" \
      -e "s|^BACKEND_IMAGE=.*|BACKEND_IMAGE=ghcr.io/kohakunamori/gallery-backend:${TAG}|" \
      -e "s|^FRONTEND_IMAGE=.*|FRONTEND_IMAGE=ghcr.io/kohakunamori/gallery-frontend:${TAG}|" \
      -e "s|^UPLOAD_ENV_HOST_PATH=.*|UPLOAD_ENV_HOST_PATH=./script/upload_r2.env|" \
      -e "s|^GALLERY_DATA_HOST_PATH=.*|GALLERY_DATA_HOST_PATH=./data/gallery|" \
      .env >"$tmp"
    mv "$tmp" .env
  fi
  echo "Created $DIR/.env"
fi

if [[ ! -f script/upload_r2.env ]]; then
  cat >script/upload_r2.env <<'EOF'
# Fill remote upload credentials used by script/upload_r2.py
# R2_ENDPOINT=
# R2_ACCESS_KEY_ID=
# R2_SECRET_ACCESS_KEY=
# R2_BUCKET=
# R2_PREFIX=gallery
EOF
  echo
  echo "Created placeholder $DIR/script/upload_r2.env"
  echo "Edit that file with real R2 credentials, then run:"
  echo "  cd $DIR && ./scripts/deploy.sh ${TAG}"
  exit 0
fi

echo "==> Deploy tag: $TAG"
./scripts/deploy.sh "$TAG"
