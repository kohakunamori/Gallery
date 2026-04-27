# Add Upload Endpoint and Page

## Goal
Add an authenticated-local-style upload flow for gallery images: the backend exposes `POST /upload`, and the frontend exposes an independent `/upload` page where users can upload one or many image files.

## Requirements
- Backend `POST /upload` accepts multipart form uploads using `files` or `file` fields.
- Support image extensions already recognized by `script/upload_r2.py`: jpg, jpeg, png, webp, gif, bmp, tiff, svg, avif, heic.
- Save uploaded files under the configured gallery photos directory, then invoke `script/upload_r2.py` with its existing upload logic.
- Upload to all three media targets (`r2`, `linux`, `qiniu`) via `--target all`.
- Clear backend photo cache after successful upload so `/api/photos` reflects new items.
- Return JSON for both success and validation/upload errors.
- Frontend provides an independent `/upload` page, not embedded in the gallery page.
- Frontend upload page supports single and batch selection, previews selected file metadata, submits to backend `/upload`, and shows success/error output.
- Existing gallery page remains available at the root route.

## Acceptance Criteria
- [ ] `POST /upload` accepts one or more supported image files and rejects unsupported extensions with JSON error.
- [ ] Backend invokes `script/upload_r2.py --dir <photosDirectory> --recursive --target all` after saving files.
- [ ] Backend clears the configured photo cache only after successful remote upload.
- [ ] Frontend `/upload` page can select one or multiple files including webp/avif and submit them via multipart form data.
- [ ] Frontend shows uploaded file results and script output on success.
- [ ] Frontend shows a useful error message when backend returns an error or the request fails.
- [ ] Backend and frontend tests/build checks pass.

## Contract
- Request: `POST /upload` with `multipart/form-data` and field name `files` for multiple uploads; single-file field `file` is also accepted.
- Success response: HTTP 200 JSON `{ "files": [{ "name": string, "path": string, "size": number }], "output": string[] }`.
- Error response: HTTP 400 JSON `{ "error": string }` for validation, save, or remote upload failures.
- Frontend route: `/upload`; root `/` continues to render the existing gallery.

## Validation and Error Matrix
- No files supplied -> 400 `{ "error": "No image files were uploaded." }`.
- Upload transport error -> 400 JSON error.
- Unsupported extension -> 400 JSON error naming the file.
- `script/upload_r2.py` unavailable or exits non-zero -> 400 JSON error with script output when available.
- Network/backend request failure in frontend -> visible error message.

## Good/Base/Bad Cases
- Good: upload a single `.avif` file and receive one file result plus script output.
- Base: upload multiple `.jpg`, `.png`, `.webp` files and receive all file results.
- Bad: upload a `.txt` file and receive a JSON validation error without clearing cache.

## Technical Notes
- Reuse the existing `script/upload_r2.py` behavior rather than duplicating cloud upload logic in PHP.
- Use existing backend Slim action/service patterns and frontend fetch-service/component patterns.
- Do not change existing gallery media display behavior except for route selection needed to support `/upload`.
