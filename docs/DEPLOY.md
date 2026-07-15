# Deploy Gallery (frontend + backend) with Docker

This repo publishes two images to GitHub Container Registry on every push to `master`/`main`:

| Image | Purpose |
| --- | --- |
| `ghcr.io/kohakunamori/gallery-backend` | Slim PHP API + upload worker |
| `ghcr.io/kohakunamori/gallery-frontend` | Static SPA (nginx) + reverse proxy |

Each commit is tagged as:

- `sha-<full-git-sha>`
- `sha-<short-sha>`
- branch name (`master`)
- `latest` (default branch only)

## 1. One-time GitHub setup

1. Push this repository to GitHub (`kohakunamori/Gallery`).
2. Ensure **Settings → Actions → General → Workflow permissions** allows:
   - Read and write permissions
   - (optional) Allow GitHub Actions to create and approve pull requests
3. Packages are created automatically on first successful workflow run under:
   - `https://github.com/users/kohakunamori/packages`
4. Packages are public (`gallery-backend`, `gallery-frontend`); servers can `docker pull` without login.
   - Package pages:  
     https://github.com/kohakunamori/Gallery/pkgs/container/gallery-backend  
     https://github.com/kohakunamori/Gallery/pkgs/container/gallery-frontend

No extra secrets are required for push: the workflow uses `GITHUB_TOKEN`.

## 2. One-command server deploy (recommended)

Images are **public** on GHCR — no `docker login` needed for pull.

### A. Zero-repo bootstrap (fresh server)

```bash
# optional overrides:
# export GALLERY_DIR=/opt/gallery
# export GALLERY_TAG=latest          # or sha-82d0158
# export GALLERY_HTTP_PORT=8088
# export MEDIA_BASE_URL=https://static.cf.nyaneko.cn/gallery

curl -fsSL https://raw.githubusercontent.com/kohakunamori/Gallery/master/scripts/bootstrap-deploy.sh | bash
```

First run creates `~/gallery` (or `$GALLERY_DIR`) with:

- `docker-compose.yml`
- `.env`
- `scripts/deploy.sh`
- placeholder `script/upload_r2.env`

Fill `script/upload_r2.env`, then:

```bash
cd ~/gallery   # or $GALLERY_DIR
./scripts/deploy.sh
```

### B. Full git clone

```bash
git clone https://github.com/kohakunamori/Gallery.git
cd Gallery
cp .env.docker.example .env
# put real R2 credentials at path from UPLOAD_ENV_HOST_PATH (default ./script/upload_r2.env)
./scripts/deploy.sh --init   # creates placeholders if missing
./scripts/deploy.sh          # pull :latest and start
# pin a commit:
# ./scripts/deploy.sh sha-82d0158
```

### C. Manual compose (same as script internals)

```bash
export BACKEND_IMAGE=ghcr.io/kohakunamori/gallery-backend:latest
export FRONTEND_IMAGE=ghcr.io/kohakunamori/gallery-frontend:latest
export UPLOAD_ENV_HOST_PATH=/absolute/path/to/upload_r2.env
export GALLERY_DATA_HOST_PATH=./data/gallery
export UPLOAD_ACCESS_TOKEN='your-upload-token'
export MEDIA_BASE_URL='https://static.cf.nyaneko.cn/gallery'
export GALLERY_HTTP_PORT=8088

docker compose pull
docker compose up -d
```

Open `http://SERVER:8088/`.

- Frontend serves the SPA
- `/api/*` and `POST /upload` are proxied to the backend container
- `photos-index.json` lives on the **host** at `${GALLERY_DATA_HOST_PATH}/photos-index.json` (default `./data/gallery/photos-index.json`) so you can replace/update it without entering the container
- Temporary upload batches under the same host dir are cleaned after each upload

### Build locally without GHCR

```bash
docker compose build
docker compose up -d
```

## 3. Environment variables

| Variable | Where | Meaning |
| --- | --- | --- |
| `MEDIA_BASE_URL` | backend | R2 public base URL for gallery images |
| `UPLOAD_ACCESS_TOKEN` | backend | Optional token required by `POST /upload` |
| `UPLOAD_SCRIPT_ENV_FILE` | backend | Path inside container to `upload_r2.env` (compose mounts it) |
| `UPLOAD_ENV_HOST_PATH` | compose host | Host path of the env file mounted into backend |
| `GALLERY_DATA_HOST_PATH` | compose host | Host dir mounted to backend `var/` (holds `photos-index.json`) |
| `GALLERY_HTTP_PORT` | compose | Host port for frontend (default `8088`) |
| `BACKEND_IMAGE` / `FRONTEND_IMAGE` | compose | Override image tags |

## 4. Update after a new commit

```bash
cd ~/gallery   # or repo root
./scripts/deploy.sh                 # track latest
# or pin:
./scripts/deploy.sh sha-<new>
```

Equivalent manual flow:

```bash
docker compose pull && docker compose up -d
```

## 5. Migrate images already on R2

You do **not** need to re-upload. Only rebuild `photos-index.json`.

```bash
# dry-run first
python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog backend/var/photos-index.json \
  --dry-run

# write catalog (R2 list only — width/height null)
python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog backend/var/photos-index.json

# preferred: fill width/height from local originals
python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog backend/var/photos-index.json \
  --local-dir "D:/path/to/originals" \
  --dry-run

python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog backend/var/photos-index.json \
  --local-dir "D:/path/to/originals"
```

Matching rules for `--local-dir` (first hit wins):

1. exact relative path (`travel/a.png` → `travel/a.png`)
2. same dir + stem (`travel/a.png` → remote `travel/a.avif`)
3. same filename anywhere
4. same filename stem anywhere

If R2 has more objects than local originals (e.g. 2083 vs 2065):

```bash
# list unmatched only
python script/download_unmatched_r2.py \
  --local-dir "D:/path/to/originals" \
  --dry-run

# download unmatched into a temp folder
python script/download_unmatched_r2.py \
  --local-dir "D:/path/to/originals" \
  --out-dir "D:/path/to/originals/_from_r2_unmatched"

# import with both local roots so every catalog item gets dimensions
python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog backend/var/photos-index.json \
  --local-dir "D:/path/to/originals" \
  --local-dir "D:/path/to/originals/_from_r2_unmatched"
```

Path mapping:

```text
R2 key:  gallery/travel/cover.avif
catalog: travel/cover.avif
API URL: {MEDIA_BASE_URL}/travel/cover.avif
```

On Docker, write catalog to the host data dir (default `./data/gallery/photos-index.json`), then restart backend if needed:

```bash
python script/import_r2_catalog.py \
  --env-file script/upload_r2.env \
  --catalog data/gallery/photos-index.json \
  --local-dir "D:/path/to/originals"
```

## 6. Upload route routing

Frontend nginx splits `/upload` by HTTP method. Do not treat every `/upload` request as a backend call.

| Method | Handled by | Purpose |
| --- | --- | --- |
| `GET` / `HEAD` | SPA (`index.html` via frontend nginx rewrite) | Browser opens the upload page |
| `POST` | backend (`gallery-backend`) | Multipart upload API |

Relevant config: `frontend/docker/nginx.conf` (`location = /upload`). Dev Vite proxy uses the same rule: only `POST` is forwarded; other methods serve the SPA.

### After the nginx SPA fix (`17f913a`)

`GET /upload` used to be proxied to PHP and could return **500**. The fix lives in the **frontend** image. After that commit (or any later `master` tip that includes it), operators must pull a new `gallery-frontend` image — pulling backend alone is not enough:

```bash
cd ~/gallery   # or repo root
./scripts/deploy.sh              # pulls both images tagged :latest
# or pin the same build for both:
# ./scripts/deploy.sh sha-<git>
```

Manual equivalent:

```bash
docker compose pull
docker compose up -d
# or:
docker pull ghcr.io/kohakunamori/gallery-frontend:latest
docker pull ghcr.io/kohakunamori/gallery-backend:latest
```

### GHCR tags

Both `gallery-frontend` and `gallery-backend` are published with the same tag set on every push to `master`/`main`:

| Tag | Meaning |
| --- | --- |
| `latest` | Tip of the default branch only |
| `sha-<full-git-sha>` | Immutable full commit SHA |
| `sha-<short-sha>` | Immutable short commit SHA |
| branch name (`master` / `main`) | Moving branch tip |

Prefer `sha-*` when you need a pin; use `latest` or `./scripts/deploy.sh` for routine updates. Packages are public — `docker pull` does not require login.

## 7. Notes

- Backend image includes PHP + Apache, Python, and `upload_r2.py` so upload works inside the container.
- Frontend does **not** embed API secrets; only the backend needs `upload_r2.env`. Never commit real `upload_r2.env`, tokens, or runtime catalogs into git.
- Upload path: image bytes always go to **R2 only** (`--target r2`).
- `photos-index.json` updates:
  - **Same machine as API**: set `PHOTO_CATALOG_PATH` / `--catalog` (local merge).
  - **Script on another machine**: set `PHOTO_CATALOG_REMOTE_PATH` / `--catalog-remote` plus `LINUX_UPLOAD_HOST`/`USER` and key or password — script SFTP-merges only the JSON (does **not** upload images to Linux (images always go to R2)).
- Web upload injects local `PHOTO_CATALOG_PATH` inside the API container.
- The server only stores `photos-index.json` and temporary upload batches (no permanent local image store).


