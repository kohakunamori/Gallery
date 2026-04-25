# upload_r2 cache compatibility and cold-start skip design

## Goal

Fix the two practical problems now affecting `upload_r2.py`:

1. Existing `.upload_target_cache.json` files in the old top-level target format are ignored, so repeated runs fall back to an empty cache.
2. When the effective cache is empty, the script can spend a long time compressing PNG files that already exist remotely.

The fix should preserve current CLI behavior, keep the current PNG compression strategy, and stay focused on `upload_r2.py`.

## Problem summary

### Old cache files are effectively treated as empty

`load_upload_cache()` currently accepts only the v4 local-file index shape:

```json
{
  "version": 4,
  "files": { ... }
}
```

Many real cache files still use the older target-keyed structure:

```json
{
  "r2": { "bucket|key": { ... } },
  "linux": { "host|path": { ... } },
  "qiniu": { "bucket|key": { ... } }
}
```

Those files are not semantically useless, but the current loader discards them. That turns a warm cache into a cold start.

### Current startup logs are misleading

The current `Existing remote objects under prefix: N` style logs are derived mostly from local cache classification, not from an actual remote listing in the default path. When the local cache is empty, the log looks like “remote has nothing” even when the remote already contains many files.

### Cold-start runs do expensive work too early

PNG preparation happens before the script has strong evidence that a pending file is truly missing remotely. On a cold start or cache reset, that can waste a large amount of CPU time on files that should have been skipped.

## Constraints

- Keep `upload_r2.py` as the only code file changed for this fix.
- Do not change CLI flags or remove `both` as an alias for `all`.
- Do not weaken `PNG_COMPRESSION_STRATEGY`.
- Do not change GUI behavior.
- Do not perform a full remote audit of all files on every run.
- Do not rewrite old cache files immediately on load.

## Recommended approach

Use a **hybrid warm-cache / cold-start model**:

- Keep the current v4 local-first sync index as the main cache model.
- Add **legacy cache ingestion** so old cache files can be promoted into the in-memory v4 view for the current run.
- Add **cold-start remote precheck** only when the current run has no usable local proof for a target and `skip-existing` is enabled.
- Make the logs explicitly distinguish cache-derived counts from remote-precheck-derived counts.

This keeps fast repeated runs fast while fixing the pathological cold-start case that the user is hitting now.

## Design

### 1. Legacy cache ingestion into the in-memory v4 model

#### Detection

`load_upload_cache()` should recognize two inputs:

1. Native v4 cache: return as-is.
2. Legacy target-keyed cache: return an empty v4 cache plus the parsed legacy sections stored in a transient internal field used only during this run.

The transient field is an implementation detail and must not be written back to disk.

#### Promotion timing

Legacy promotion cannot be completed at file-load time alone, because mapping legacy remote IDs back to v4 file records requires:

- the current local file set
- the current base directory
- the resolved runtime config (`bucket`, `prefix`, Linux host/dir, Qiniu prefix, etc.)

So promotion should happen inside `run_upload()` after:

- `resolve_runtime_config()`
- `collect_files()`

#### Promotion rule

For each local file in the current run, compute the current target IDs using the current config:

- R2: `bucket|object_key`
- Linux: `host|remote_path`
- Qiniu: `bucket|object_key`

If the matching legacy entry exists for that target and its stored fingerprint matches the current local upload fingerprint for that file, create the corresponding v4 `files/<relative_path>/targets/<target>` record in memory.

This means promotion is conservative:

- exact target ID must match
- exact fingerprint must match
- otherwise the file remains pending

#### Save behavior

At the end of the run, `save_upload_cache()` should write only the normal v4 structure. The first successful save naturally upgrades the cache file on disk.

### 2. Cold-start remote precheck before PNG preparation

#### Trigger condition

Cold-start remote precheck should run only when all of the following are true:

- `skip-existing` is enabled
- not `dry-run`
- after native-v4 matching and legacy promotion, the target still has no usable local synced evidence for the current candidate set

This is a narrow fallback for cold-start or cache-reset situations. It is not a replacement for the normal local-first path.

#### Behavior by target

##### R2

For pending R2 items, call `list_existing_keys()` with only the candidate object keys.

- keys confirmed remotely present become `skipped`
- matching v4 target entries are backfilled immediately
- only the remaining missing keys continue to upload preparation

##### Qiniu

For pending Qiniu items, call `list_existing_qiniu_keys()` with only the candidate object keys.

- confirmed keys become `skipped`
- matching v4 target entries are backfilled immediately
- only the remaining missing keys continue to upload preparation

##### Linux

Linux should also avoid PNG preparation before existence is known.

The precheck order should be:

1. If the current local candidate set has unique basenames, try `list_existing_linux_filenames()` first to cheaply confirm obvious existing files.
2. For unresolved items, or when basename matching is unsafe because of duplicates, fall back to exact `check_linux_remote_skip_result()` checks for the pending paths.

This keeps the fast path for the common `storage/photos/<filename>` workflow but avoids incorrect basename-only skipping when duplicates exist.

#### Resulting execution order

For cold-start pending items:

1. classify by cache
2. precheck remote existence
3. backfill cache for confirmed existing objects
4. prepare PNGs only for the remaining truly missing files
5. upload

That is the key performance fix.

### 3. Logging changes

Replace ambiguous remote-looking counts with explicit source labels.

Per target, report separate counts such as:

- `Local cache hits: N`
- `Legacy cache promotions: N`
- `Remote precheck confirmed existing: N`
- `Pending uploads after classification: N`

The goal is not fancy telemetry. The goal is to stop implying that a cache-derived zero means the remote contains zero files.

### 4. Failure handling

- If legacy cache parsing fails, fall back to an empty v4 cache and continue.
- If cold-start remote precheck fails for a target, keep existing error behavior for that target instead of silently assuming objects are missing.
- Cache backfill should happen only for `uploaded` or remotely confirmed `skipped` results.
- Transient legacy data must never leak into the saved cache file.

## Testing

Add focused tests in `tests/test_upload_r2.py` for:

1. loading a legacy top-level cache and preserving it for promotion
2. promoting a legacy entry into the in-memory v4 file record when target ID and fingerprint match
3. refusing promotion when target ID or fingerprint does not match
4. cold-start R2/Qiniu precheck preventing PNG preparation for already-existing remote objects
5. cold-start Linux precheck preventing PNG preparation for already-existing remote files
6. logging text distinguishing local cache hits from remote-precheck hits
7. saved cache output containing only v4 fields, not transient legacy data

## Out of scope

- full migration tooling for arbitrary historical cache files outside the current run context
- rewriting the cache file immediately on startup before any upload work happens
- changing upload concurrency or compression quality as part of this fix
- redesigning the broader incremental model described in earlier specs

## Implementation handoff

Implementation should modify `upload_r2.py` to:

1. ingest legacy cache sections safely
2. promote matching legacy entries after file scan and config resolution
3. run cold-start remote prechecks before PNG preparation
4. backfill the v4 cache from confirmed remote skips
5. clarify the per-target startup logs

This is intentionally a targeted repair, not a full architecture rewrite.
