#!/bin/bash
set -euo pipefail

VAR_DIR="${PHOTO_CATALOG_PATH%/*}"
CATALOG_PATH="${PHOTO_CATALOG_PATH:-/var/www/gallery/backend/var/photos-index.json}"
UPLOAD_DIR="${UPLOAD_TEMPORARY_DIRECTORY:-/var/www/gallery/backend/var/upload-batches}"
CACHE_DIR="/var/www/gallery/backend/var/cache"

mkdir -p "$VAR_DIR" "$UPLOAD_DIR" "$CACHE_DIR"

if [ ! -f "$CATALOG_PATH" ]; then
  printf '%s\n' '{"version":1,"updatedAt":"1970-01-01T00:00:00Z","items":[]}' > "$CATALOG_PATH"
fi

# Ensure the Apache user can write catalog + temp batches on mounted volumes.
chown -R www-data:www-data /var/www/gallery/backend/var || true
chmod -R u+rwX,g+rwX /var/www/gallery/backend/var || true

exec "$@"
