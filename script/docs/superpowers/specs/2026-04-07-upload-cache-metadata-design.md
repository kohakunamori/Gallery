# Upload cache and metadata design

## Goal

Fix two inconsistencies in `upload_r2.py`:

1. `.upload_target_cache.json` currently records uploads as if they were always uncompressed, even when PNG files are uploaded through a compressed temporary file.
2. Compressed upload artifacts should preserve the source file modification time so that remote targets can retain a useful chronological order.

This design keeps the existing shared prepared-upload model: one prepared upload artifact may be reused across R2, Linux, and Qiniu for a single source file.

## Scope

In scope:
- Make upload cache entries reflect the actual uploaded artifact semantics.
- Invalidate old cache entries that were written with the old semantics.
- Preserve source mtime on compressed temporary files.
- Preserve or propagate source mtime to Linux, R2, and Qiniu uploads.
- Add regression tests for cache semantics and mtime propagation.

Out of scope:
- Changing directory scan rules.
- Reworking upload concurrency beyond the existing Linux batch change.
- Building any separate cache migration command.

## Current problem

### Cache mismatch

`build_upload_cache_fingerprint()` currently hardcodes `compressed=False` and `compression_strategy=None`, so cache entries do not describe the actual uploaded content for PNG uploads.

As a result, `.upload_target_cache.json` is a skip cache, but its compression fields are misleading.

### Timestamp mismatch

`prepare_upload_file()` creates a temporary compressed PNG file, but the temporary file's filesystem timestamp is not explicitly aligned with the source file.

For Linux uploads, remote file ordering by mtime is therefore not guaranteed to match the source file ordering unless the script explicitly restores source mtime on the remote file.

For R2 and Qiniu, source mtime is not currently attached as object metadata.

## Recommended approach

Use one unified upload-artifact model:

- `PreparedUpload` remains the single source of truth for what is actually uploaded.
- Cache writes use the `PreparedUpload` semantics rather than hardcoded uncompressed values.
- Temporary compressed files inherit the source file mtime.
- Linux remote files explicitly restore the source mtime after upload.
- R2 and Qiniu store source mtime as object metadata.
- Old cache entries are invalidated by schema version bump rather than migrated in place.

## Design details

### 1. Cache schema semantics

Cache entries should describe the successful uploaded artifact, not just the local source file.

Each cache fingerprint continues to include:
- `size`
- `mtime`
- `compressed`
- `compression_strategy`

But the semantics become:
- `size`: source file size snapshot used for invalidating stale cache when the local file changes
- `mtime`: source file mtime snapshot used for invalidating stale cache when the local file changes
- `compressed`: whether the uploaded artifact was compressed before upload
- `compression_strategy`: strategy used to produce the uploaded artifact, or `null`

This preserves the current skip-cache behavior while making the compression fields truthful.

### 2. Cache versioning

Bump `CACHE_SCHEMA_VERSION`.

When reading an older cache version:
- treat the whole cache as stale
- return an empty cache structure in the new schema

No in-place migration is needed because the old compression fields are semantically wrong and should not be trusted.

### 3. Building upload fingerprints

Replace the current `build_upload_cache_fingerprint(path)` behavior with a function that can build a fingerprint from:
- the source path
- the actual upload artifact semantics (`compressed`, `compression_strategy`)

Recommended shape:
- either extend `build_upload_cache_fingerprint(...)` to accept explicit compression arguments
- or add a helper that accepts `PreparedUpload`

The important rule is that every successful cache update must use the same compression semantics as the upload that actually happened.

### 4. Prepared upload mtime

After `oxipng` writes the temporary PNG:
- set the temp file access time / modification time to the source file timestamps

This keeps the prepared artifact aligned with the source file for downstream uploads.

For non-PNG uploads, the upload path is already the source path, so no extra work is required.

### 5. Linux mtime preservation

For Linux uploads through Paramiko/SFTP:
- after a successful `put`, explicitly set remote atime/mtime to the source file timestamps using SFTP operations

Apply this to both:
- `upload_to_linux(...)`
- `upload_files_to_linux_via_password(...)`

This ensures remote filesystem sorting reflects the original source chronology rather than upload time or temp-file creation time.

### 6. R2 metadata propagation

For R2 uploads:
- add source mtime metadata to `put_object(...)`

Recommended metadata payload:
- `source-mtime`: source file `st_mtime` serialized as a string

This does not change native object last-modified behavior, but it preserves the source chronology as object metadata for future inspection or tooling.

### 7. Qiniu metadata propagation

For Qiniu uploads:
- attach source mtime as custom object metadata on upload

Recommended stored value:
- `source-mtime`: source file `st_mtime` serialized as a string

The exact SDK parameter name should follow what the current Qiniu SDK supports for custom metadata in `put_file_v2`.

## Expected behavior after change

For a PNG upload:
- the file is compressed once into a temp artifact
- the temp artifact inherits the source file mtime
- Linux, R2, and Qiniu all upload from that same prepared artifact
- Linux remote mtime is restored to the source file mtime
- R2 and Qiniu receive source mtime metadata
- cache entries record `compressed=true` and the actual compression strategy

For a non-PNG upload:
- no compression occurs
- cache entries record `compressed=false`
- Linux remote mtime still reflects source file mtime
- R2 and Qiniu still receive source mtime metadata

## Testing plan

Add or update tests for:

1. Cache semantics
- PNG upload cache fingerprint records `compressed=True` and the configured compression strategy.
- Non-PNG cache fingerprint records `compressed=False` and `compression_strategy=None`.
- Old cache schema versions are discarded and rebuilt.

2. Prepared upload timestamps
- compressed temp file gets the same mtime as the source file.

3. Linux timestamp propagation
- `upload_to_linux(...)` restores remote mtime after upload.
- `upload_files_to_linux_via_password(...)` restores remote mtime after upload.
- Linux batch path still uploads the prepared artifact, not the original file.

4. Object storage metadata
- R2 upload request includes source mtime metadata.
- Qiniu upload request includes source mtime metadata.

5. Regression coverage
- existing skip-cache tests still pass with the new cache schema
- existing Linux batch and logging tests still pass

## Risks and mitigations

### Risk: old cache suddenly stops skipping
This is intentional. Old cache semantics are invalid for compression tracking.

Mitigation:
- schema version bump makes the reset explicit and deterministic.

### Risk: R2/Qiniu metadata API differences
The desired behavior is clear, but implementation details depend on SDK support.

Mitigation:
- verify exact parameter names against current SDK behavior during implementation
- test request payloads directly in unit tests

### Risk: remote mtime support differences
Linux SFTP timestamp setting should work with the current Paramiko path, but failures must surface as normal upload errors if the remote rejects timestamp updates.

Mitigation:
- keep timestamp-setting logic in the same upload success path so failures are visible and testable

## Acceptance criteria

The change is complete when:
- `.upload_target_cache.json` records truthful compression semantics for uploaded files
- old cache files are automatically invalidated
- compressed temporary files preserve source mtime
- Linux remote files preserve source mtime
- R2 and Qiniu uploads include source mtime metadata
- all updated and new tests pass
