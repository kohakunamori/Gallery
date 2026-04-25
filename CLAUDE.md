# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project layout

- `frontend/`: React 19 + TypeScript + Vite single-page app for the exhibition UI.
- `backend/`: Slim 4 PHP API that scans `storage/photos` and serves metadata plus local media files.
- `storage/photos/`: source image tree consumed by the backend scanner.
- `docs/`: design notes and supporting documentation.

## Development commands

### Frontend (`frontend/`)

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Run all frontend tests: `npm test`
- Run one frontend test file: `npm test -- src/pages/ExhibitionPage.test.tsx`
- Run tests matching a name: `npx vitest run -t "loads more"`

### Backend (`backend/`)

- Install deps: `composer install`
- Start local API server: `composer serve`
- Run all backend tests: `composer test`
- Run one backend test file: `php vendor/bin/phpunit tests/Action/GetPhotosActionTest.php`
- Run tests matching a name: `php vendor/bin/phpunit --filter testName`

### Full local development

Run both apps together:

1. Start the backend from `backend/` with `composer serve`.
2. Start the frontend from `frontend/` with `npm run dev`.
3. Open the Vite app; `/api` and `/media` are proxied to `http://127.0.0.1:8080` by `frontend/vite.config.ts`.

## Architecture

### Frontend flow

- `frontend/src/main.tsx` boots the app and renders `App`.
- `frontend/src/App.tsx` is intentionally thin; it mounts `ExhibitionPage` directly.
- `frontend/src/pages/ExhibitionPage.tsx` is the main orchestration layer. It:
  - fetches photo data via `fetchPhotos()`
  - owns gallery UI state (`status`, visible item count, selected photo, header visibility, settings modal state)
  - applies sort and month grouping before rendering sections
  - progressively reveals more content via `LoadTrigger`
  - opens the lightbox via `PhotoViewerModal`
- `frontend/src/components/exhibition/` contains the exhibition-specific UI. The waterfall layout is computed in `WaterfallGallery.tsx`, which balances photos into columns using image aspect ratios instead of plain CSS masonry.
- `GallerySettingsModal.tsx` defines the shared preference types used across the page (`columnPreference`, `sortPreference`, `mediaSourcePreference`).
- `frontend/src/services/` is a thin fetch layer over the backend JSON endpoints.
- `frontend/src/utils/` contains pure presentation/data helpers such as month grouping and sort logic.

### Backend flow

- `backend/public/index.php` is the runtime entrypoint. It wires the app to `storage/photos`, sets the default remote media base URL, enables a filesystem cache, and exposes a local `/media` route.
- `backend/src/createApp.php` composes the Slim app, registers routes, and builds the service graph.
- HTTP endpoints are minimal action classes:
  - `/api/photos` → `GetPhotosAction`
  - `/api/albums` → `GetAlbumsAction`
  - `/media/{path}` streams local files
  - `/health` returns a plain `ok`
- `PhotoIndexService` is the main photo feed builder. It scans files, reads metadata, chooses either remote (`r2`) or local media URLs, derives stable IDs from relative path + mtime, sorts newest-first, and optionally caches the resulting list.
- `AlbumIndexService` performs a similar scan but groups by the first path segment under `storage/photos`, using the newest photo in each group as the cover.
- `PhotoScanner` only scans files at the root of `storage/photos` and one directory level below it. If deeper nesting is introduced, scanning logic must change.
- `PhotoMetadataReader` reads dimensions with `getimagesize()` and EXIF timestamps when available; `takenAt` falls back to file modification time later in the index services.

## Testing notes

- Frontend tests use Vitest with `jsdom` and shared setup from `frontend/src/test/setup.ts`.
- Backend tests use PHPUnit with `vendor/autoload.php` bootstrap configured in `backend/phpunit.xml`.

## Repo-specific notes

- This gallery redesign does not need backwards compatibility with the previous frontend structure or entrypoints.
- `frontend/src/utils/photoQuery.ts` is currently a no-op placeholder; selected photo state is not persisted in the URL yet.
