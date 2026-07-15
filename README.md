# Gallery

A lightweight personal photo exhibition: React frontend + Slim PHP API, with **images on object storage (Cloudflare R2 by default)** and a **JSON catalog** as the source of truth.

- Waterfall gallery, month groups, lightbox, settings (columns / sort / theme)
- Web upload page and offline CLI uploader
- Docker / GHCR one-command deploy

## Architecture

```text
Browser
  └─ frontend (nginx SPA)
       ├─ /api/* , POST /upload  →  backend (Slim PHP)
       ├─ GET / HEAD /upload     →  SPA upload page (nginx rewrite)
       └─ image URLs             →  R2 / CDN  (MEDIA_BASE_URL)

Catalog (host file, mounted into backend):
  ${GALLERY_DATA_HOST_PATH}/photos-index.json
```

**`/upload` routing:** browsers open the upload UI with `GET`/`HEAD` (served by the frontend SPA). Only `POST /upload` is proxied to the PHP API. After the nginx SPA fix (`17f913a`), pull a fresh `gallery-frontend` image — backend-only updates do not fix `GET /upload`. See [docs/DEPLOY.md](docs/DEPLOY.md) § “Upload route routing”.

| Piece | Role |
| --- | --- |
| `frontend/` | React 19 + Vite SPA |
| `backend/` | Slim 4 API: photo list, albums, upload |
| `script/upload_r2.py` | CLI: compress → R2, merge catalog (local or remote over SSH) |
| `backend/var` host mount | `photos-index.json`, API cache, temp upload batches |

Image **bytes** are not stored permanently on the API host. The API only keeps the catalog and temporary upload batches.

## Quick deploy (server)

Requirements: Docker + Compose plugin.

### Option A — no full clone (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/kohakunamori/Gallery/master/scripts/bootstrap-deploy.sh | bash
```

Creates `~/gallery` (or `$GALLERY_DIR`) with compose files and placeholders. Then:

```bash
cd ~/gallery   # or $GALLERY_DIR
# edit .env  →  MEDIA_BASE_URL, UPLOAD_ACCESS_TOKEN, ports
# put R2 keys in script/upload_r2.env  (see script/.env.example)
./scripts/deploy.sh
```

Open `http://SERVER:8088/`.

### Option B — from this repo

```bash
git clone https://github.com/kohakunamori/Gallery.git
cd Gallery
cp .env.docker.example .env
# create script/upload_r2.env from script/.env.example
./scripts/deploy.sh --init
./scripts/deploy.sh
```

### Update

```bash
./scripts/deploy.sh              # pull :latest
# ./scripts/deploy.sh sha-<git>  # pin a build
```

Images (public, no `docker login` needed):

- `ghcr.io/kohakunamori/gallery-backend`
- `ghcr.io/kohakunamori/gallery-frontend`

Full deploy notes: [docs/DEPLOY.md](docs/DEPLOY.md).

## Configuration

Main host `.env` (from `.env.docker.example`):

| Variable | Meaning |
| --- | --- |
| `MEDIA_BASE_URL` | Public base URL for images (R2/CDN), e.g. `https://static.example.com/gallery` |
| `GALLERY_HTTP_PORT` | Published HTTP port (default `8088`) |
| `GALLERY_DATA_HOST_PATH` | Host dir for catalog/cache (default `./data/gallery`) |
| `UPLOAD_ENV_HOST_PATH` | Host path to `upload_r2.env` (R2 credentials) |
| `UPLOAD_ACCESS_TOKEN` | Optional token for `POST /upload` |

Catalog path on host:

```text
${GALLERY_DATA_HOST_PATH}/photos-index.json
```

You can replace or edit that file without entering the container; restart/cache clear may be needed after manual edits.

## Local development

```bash
# API
cd backend && composer install && composer serve   # http://127.0.0.1:8080

# UI (proxies /api and /upload to 8080)
cd frontend && npm install && npm run dev
```

Tests:

```bash
cd frontend && npm test
cd backend  && composer test
cd script   && python -m unittest tests.test_upload_r2
```

## Uploading photos

### Web UI

Open `/upload` in the browser (`GET` loads the SPA upload page; only `POST /upload` hits the API). Set `UPLOAD_ACCESS_TOKEN` if you use one. Files are staged temporarily, uploaded to **R2**, and merged into `photos-index.json` by path (existing entries are kept).

### CLI (`script/upload_r2.py`)

Typical offline machine workflow: images → R2, catalog → remote server over SSH.

```bash
cp script/.env.example script/upload_r2.env
# fill R2_* (or AWS_*) and, for remote catalog:
#   PHOTO_CATALOG_REMOTE_PATH=/path/on/server/photos-index.json
#   LINUX_UPLOAD_HOST / USER / KEY or PASSWORD

python script/upload_r2.py /path/to/photos
```

Defaults: target **R2 only**, AVIF compression, skip already-uploaded objects. Catalog merge is optional via `PHOTO_CATALOG_PATH` (local) or `PHOTO_CATALOG_REMOTE_PATH` (SFTP merge only — does not upload image files to Linux unless `--target` includes `linux`).

Import an existing R2 bucket into a catalog:

```bash
python script/import_r2_catalog.py --env-file script/upload_r2.env --catalog data/gallery/photos-index.json
```

See [docs/DEPLOY.md](docs/DEPLOY.md) § “Migrate images already on R2”.

## API (backend)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | liveness |
| `GET` | `/api/photos` | photo feed from catalog + R2 media base URL |
| `GET` | `/api/albums` | albums grouped by path prefix |
| `POST` | `/upload` | multipart upload (optional bearer/token) |

## Project layout

```text
frontend/          SPA
backend/           PHP API
script/            upload_r2.py, catalog import helpers
scripts/           deploy.sh, bootstrap-deploy.sh
docs/DEPLOY.md     detailed deploy / migrate guide
docker-compose.yml production compose
```

## License

Use and modify for personal or project use as you see fit unless otherwise noted in future license files.
