# upload_r2 incremental performance design

## Goal

Speed up repeated uploads of large image directories in `upload_r2.py` without reducing upload success rate or PNG compression quality.

Primary priorities:
- Reduce R2 and Linux incremental-check overhead.
- Improve Qiniu incremental-check overhead as part of the same model.
- Avoid re-running expensive PNG compression work when the source file has not changed.
- Reduce connection/setup overhead in the upload phase without making delivery less reliable.

## Constraints

- The dominant workload is rerunning the same large directory, where most files are unchanged.
- Remote targets are assumed to be managed primarily by this script on this machine.
- PNG compression settings must not be weakened for speed.
- Upload performance improvements must not depend on more aggressive failure-prone behavior.
- Existing CLI usage should remain familiar where possible.

## In scope

- Change incremental decision-making from remote-first to local-cache-first.
- Replace the current remote-key-oriented cache model with a local-file-oriented sync index.
- Add an explicit remote verification mode for pending files.
- Rework execution flow so targets process their own pending file sets.
- Add persistent prepared-PNG reuse across runs.
- Reuse R2/Qiniu client state and improve Linux batch transfer reuse.
- Make cache writes atomic.
- Add regression and behavior tests for the new incremental model.

## Out of scope

- Full remote reconciliation of every file on every run.
- A new database-backed index.
- Filesystem watching.
- GUI redesign or GUI-specific behavior changes.
- Changing image scan rules or supported file types.
- Lowering PNG compression level or changing compression strategy.

## Current bottlenecks

### Remote existence checks dominate repeated runs

`run_upload()` currently spends much of its startup time checking target state before doing useful work:
- R2 prechecks in `upload_r2.py:1570-1613`
- Linux prechecks in `upload_r2.py:1614-1640`
- Qiniu prechecks in `upload_r2.py:1641-1680`

This is expensive when rerunning a directory where most files are unchanged.

### Cache semantics are optimized around remote identities

The current cache is keyed by remote target identifiers (`bucket|object_key`, `host|remote_path`) rather than by the local source file version being synchronized.

That makes the script ask, in effect, “does the remote object probably exist?” when the more useful question is “has this local file version already been synced to each target?”

### PNG work is reused within one run but not across runs

`prepare_upload_file()` in `upload_r2.py:595-647` avoids recompressing a PNG multiple times inside a single file-processing path, but repeated runs still redo the same `oxipng` work when a PNG needs any target upload.

### Upload setup work is repeated too often

- `upload_to_r2()` creates a new boto3 client per file in `upload_r2.py:689-697`.
- `upload_to_qiniu()` rebuilds auth state per file in `upload_r2.py:733-741`.
- Linux key-based uploads still rely heavily on per-file `ssh`/`scp` execution in `upload_r2.py:1082-1118`.

## Recommended approach

Adopt a **local-first incremental model**.

Default behavior should trust the local sync index and skip remote verification for unchanged files. Remote verification becomes an explicit, narrower safety mode used only for files that are already pending because the local index does not prove they are synced.

This matches the real workload:
- repeated runs of the same directory
- remote targets largely controlled by this tool
- higher value from eliminating unnecessary remote checks than from making those checks slightly faster

## Operating modes

### Default mode

- Scan local files.
- Compute the current local fingerprint for each file.
- Use the local sync index to decide which targets are already up to date.
- Build per-target pending queues.
- Upload pending items directly.
- Update the sync index only for successful target operations.

No remote existence checks run for already-cached files.

### `--verify-remote` mode

- Use the same local-first scan.
- Only for target entries that are already pending, verify exact remote existence before uploading.
- If remote existence is confirmed, mark the target as skipped and backfill the cache.
- If remote existence is not confirmed, upload as normal.

`--verify-remote` is a correctness-oriented fallback, not a full audit mode.

## Cache model

### Schema version

Bump `CACHE_SCHEMA_VERSION` from `3` to `4`.

Old cache files should be treated as stale and discarded. There is no in-place migration because the cache meaning changes materially.

### New shape

Replace the current per-target top-level sections with a local-file index:

```json
{
  "version": 4,
  "files": {
    "nested/image.png": {
      "source": {
        "size": 12345,
        "mtime": 1713512345.25
      },
      "prepared_png": {
        "sha256": "...",
        "compression_strategy": "oxipng:o_max:z:strip_safe",
        "prepared_size": 12001
      },
      "targets": {
        "r2": {
          "id": "static-bucket|gallery/nested/image.png",
          "synced_fingerprint": {
            "size": 12345,
            "mtime": 1713512345.25,
            "compressed": true,
            "compression_strategy": "oxipng:o_max:z:strip_safe"
          }
        },
        "linux": {
          "id": "linux-host|/srv/gallery/nested/image.png",
          "synced_fingerprint": {
            "size": 12345,
            "mtime": 1713512345.25,
            "compressed": true,
            "compression_strategy": "oxipng:o_max:z:strip_safe"
          }
        },
        "qiniu": {
          "id": "static-bucket|gallery/nested/image.png",
          "synced_fingerprint": {
            "size": 12345,
            "mtime": 1713512345.25,
            "compressed": true,
            "compression_strategy": "oxipng:o_max:z:strip_safe"
          }
        }
      }
    }
  }
}
```

### Semantics

For each local relative path:
- `source` describes the current local file snapshot used for invalidation.
- `prepared_png` is optional and only exists for PNG files after prepared-cache creation.
- `targets.<target>.synced_fingerprint` records the local-file version that was last confirmed uploaded or remotely verified for that target.

A target is considered up to date only when:
- the target entry exists, and
- its `synced_fingerprint` exactly matches the current source fingerprint plus the expected upload semantics for that target.

### Invalidating stale target state

If a local file changes in size or mtime:
- the file remains in the cache index
- but any target whose `synced_fingerprint` no longer matches is considered pending

This allows partial resyncs without losing the rest of the file history.

## Incremental execution flow

### Phase 1: local scan and classification

After `collect_files()` in `upload_r2.py:589-592`, build a local classification pass:

1. Compute the current source fingerprint for each file.
2. Determine expected upload semantics:
   - non-PNG: `compressed=false`
   - PNG: `compressed=true`, `compression_strategy=PNG_COMPRESSION_STRATEGY`
3. Compare the current file state against each target's cached `synced_fingerprint`.
4. Build target-specific pending queues:
   - `r2_pending`
   - `linux_pending`
   - `qiniu_pending`

Files with no pending targets do not continue into upload preparation.

### Phase 2: target execution

Each target processes only its own pending queue.

This replaces the current per-file orchestration pattern in `upload_one()` (`upload_r2.py:1329-1486`) with a clearer model:
- decide once per file which targets need work
- execute per target using that queue
- update cache per target result

That makes connection reuse and retry behavior much simpler.

## Target-specific behavior

### R2

Default mode:
- Do not call `list_existing_keys()` for unchanged cached files.
- Upload only `r2_pending` entries.
- On successful upload, update `targets.r2`.

`--verify-remote` mode:
- Perform exact existence checks only for `r2_pending` object keys.
- If the object exists, record the target as skipped and backfill `targets.r2`.
- Otherwise upload.

### Linux

Default mode:
- Do not call the Linux existing-photos API.
- Do not run per-file remote skip checks.
- Use the local sync index to decide whether Linux is pending.
- Upload only `linux_pending` entries.

`--verify-remote` mode:
- Verify exact remote path existence for `linux_pending` entries.
- If the remote path exists, record the target as skipped and backfill `targets.linux`.
- Otherwise upload.

The Linux existing-photos API is intentionally removed from the critical incremental path for this change because it reports filenames rather than exact remote paths, which is not precise enough for authoritative sync decisions.

### Qiniu

Default mode:
- Do not call `list_existing_qiniu_keys()` for unchanged cached files.
- Upload only `qiniu_pending` entries.
- On successful upload, update `targets.qiniu`.

`--verify-remote` mode:
- Perform exact `stat` checks only for `qiniu_pending` keys.
- If the object exists, record the target as skipped and backfill `targets.qiniu`.
- Otherwise upload.

## PNG prepared-cache design

### Objective

Keep the current compression quality while avoiding repeated `oxipng` runs across sessions.

### Rules

- Only PNG files with at least one pending target enter prepared-cache lookup.
- Non-PNG files never use prepared-cache logic.
- Compression parameters remain unchanged:
  - `-o max`
  - `-z`
  - `--strip safe`

### Cache key

For a pending PNG, compute a SHA-256 hash of the source file contents and combine it with `PNG_COMPRESSION_STRATEGY`.

Recommended artifact naming:
- `.upload_prepared_cache/<sha256>--<strategy-key>.png`

Where `<strategy-key>` is a filesystem-safe representation of `PNG_COMPRESSION_STRATEGY`.

### Reuse behavior

If the prepared artifact already exists for the same `sha256 + strategy`:
- reuse it directly
- do not re-run `oxipng`

If not:
- run `oxipng`
- store the prepared artifact in `.upload_prepared_cache/`
- record `prepared_png` metadata in the sync index

### Why content hash is required

Using only `size + mtime` to reuse prepared PNGs would be fast but not fully reliable. Using SHA-256 only for already-pending PNGs preserves correctness while still avoiding the much more expensive compression step.

## Upload connection reuse

### R2

Create and reuse one boto3 client per worker thread instead of creating one client per file.

Requirements:
- preserve existing retry configuration from `make_r2_client()` in `upload_r2.py:368-387`
- preserve proxy support
- do not change request semantics or metadata handling

### Qiniu

Reuse base Qiniu auth state per worker thread.

Requirements:
- continue generating per-key upload tokens as needed
- avoid rebuilding full auth state for every file
- preserve current upload result handling

### Linux

Use a persistent SFTP batch session for both password and key-based Linux uploads.

Requirements:
- batch multiple files through one Paramiko SSH/SFTP session when possible
- preserve reconnect-on-connection-reset behavior already represented by `is_linux_sftp_connection_error()` in `upload_r2.py:908-930`
- retry the current file once after reconnect when the failure is a connection-drop class error

Fallback policy:
- key-based uploads keep the current `ssh`/`scp` per-file path as a fallback if the batched SFTP path cannot be established or maintained
- password-based uploads remain Paramiko-only, because there is no current non-interactive shell fallback path to preserve

This keeps the success profile conservative while still eliminating most repeated connection setup.

## Failure handling

### Per-target independence

Cache state must remain target-specific.

Example:
- R2 succeeds
- Linux fails
- Qiniu succeeds

Result:
- update `targets.r2`
- leave `targets.linux` pending
- update `targets.qiniu`

The file as a whole is not treated as globally synced.

### Skipped vs uploaded

For a target in `--verify-remote` mode:
- if exact remote existence is confirmed, record that target as skipped and update its sync entry
- if verification fails because the object/path is missing, upload normally
- if verification errors out unexpectedly, surface the error and do not write success state

### Prepared-cache failures

If prepared PNG generation fails:
- surface the failure for that file
- do not write target sync success for any target that depends on the missing prepared artifact
- preserve existing cleanup guarantees for temporary work files

## Cache write strategy

Replace direct overwrite writes in `save_upload_cache()` (`upload_r2.py:355-356`) with atomic save behavior:

1. serialize the new cache to a temporary file in the same directory
2. flush and close the temp file
3. rename/replace the target cache file atomically

This avoids leaving a partially written cache file after interruption.

## CLI behavior

### Existing flags

- `--refresh-cache` remains supported.
- Its meaning becomes: discard the local sync index before this run and rebuild from scratch.

### New flag

Add:
- `--verify-remote`

Semantics:
- only applies to target entries already classified as pending from the local scan
- does not force a full remote listing or full reconciliation

### Combined behavior

- default: local-cache-first, no remote verification
- `--verify-remote`: verify pending targets before upload
- `--refresh-cache`: forget previous local sync state and rebuild
- `--refresh-cache --verify-remote`: treat all files as locally pending, then verify exact remote existence before upload

## Testing plan

Add or update tests in `tests/test_upload_r2.py` for the following:

1. Local cache hit
- unchanged file with matching target fingerprint skips upload
- unchanged file does not trigger remote verification in default mode
- unchanged PNG does not enter prepared-cache or compression flow

2. Per-target pending classification
- one file can be current for R2 but pending for Linux
- only pending targets are queued

3. Schema reset
- schema version `3` cache is discarded when loading version `4`
- version `4` cache round-trips correctly

4. `--verify-remote`
- default mode skips remote verification entirely for cached hits
- verify mode checks only pending targets
- verified-existing targets backfill cache as skipped

5. PNG prepared-cache
- first pending PNG run creates prepared artifact
- second run with identical content reuses prepared artifact
- changing `PNG_COMPRESSION_STRATEGY` invalidates prepared-cache reuse

6. Connection reuse
- R2 worker path reuses client instances
- Qiniu worker path reuses auth state
- Linux batch path reuses SFTP sessions and reconnects once on connection reset

7. Partial success behavior
- one target failure does not erase or block cache updates for other successful targets

8. Atomic cache writes
- cache saves through temporary file replacement rather than direct overwrite

## Rollout notes

- The first run after deploying schema version `4` will rebuild the cache and may perform more uploads or verifications than later runs.
- That one-time reset is acceptable because the ongoing benefit is much larger for the repeated-run workload.
- No separate migration command is needed.

## Acceptance criteria

The change is complete when:
- repeated runs of an unchanged large directory no longer perform routine R2/Linux/Qiniu remote existence checks by default
- unchanged files are skipped based on the local sync index
- only pending PNG files are considered for compression preparation
- repeated pending PNG uploads can reuse a prepared artifact without lowering compression settings
- R2 and Qiniu reuse worker-local client/auth state
- Linux uses a persistent batch SFTP path before falling back to legacy key-based per-file shell transfer
- target cache state is written independently for partial success cases
- cache files are written atomically
- updated tests cover the new incremental model and pass
