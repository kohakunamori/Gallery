# Upload R2 Cache Compatibility and Cold-Start Skip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `upload_r2.py` reuse legacy `.upload_target_cache.json` data and avoid expensive PNG preparation for cold-start items that already exist remotely.

**Architecture:** Keep the current v4 `files` sync index as the saved cache format, but teach `load_upload_cache()` to preserve legacy target-keyed sections in memory for the current run. In `run_upload()`, promote matching legacy entries into the v4 in-memory view, then run narrow remote prechecks for unresolved pending items before any PNG preparation so only truly missing files are compressed and uploaded. Clarify per-target startup logs so cache-derived counts are no longer presented as remote truth.

**Tech Stack:** Python 3.14, unittest, pathlib, json, boto3/botocore, paramiko, qiniu SDK

---

## File Map

- `upload_r2.py` — add legacy cache ingestion/promotion helpers, add cold-start remote precheck helpers, update `run_upload()` ordering, and clarify log messages.
- `tests/test_upload_r2.py` — add regression tests for legacy cache promotion, cold-start remote precheck before PNG preparation, log wording, and saved-cache cleanup.
- `docs/superpowers/specs/2026-04-19-upload-r2-cache-compat-cold-start-design.md` — reference only; no edits.

## Notes

- This working directory is **not** a git repository, so replace commit steps with explicit verification checkpoints.
- Keep `both` as an alias for `all`.
- Do not change `PNG_COMPRESSION_STRATEGY`.
- Do not edit `upload_r2_gui.py`.
- Saved cache files must remain v4-only; legacy sections may exist only in transient in-memory data.

### Task 1: Add legacy cache ingestion and promotion helpers

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing legacy-cache tests**

Add this test class after `CacheSectionHelperTests` in `tests/test_upload_r2.py`:

```python
class LegacyCacheCompatibilityTests(unittest.TestCase):
    def test_load_upload_cache_preserves_legacy_target_sections_for_runtime_promotion(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_path.write_text(
                json.dumps(
                    {
                        'linux': {
                            'linux-host|/srv/gallery/image.png': {
                                'size': 9,
                                'mtime': 123.0,
                                'compressed': True,
                                'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                            }
                        },
                        'r2': {
                            'bucket-name|gallery/image.png': {
                                'size': 9,
                                'mtime': 123.0,
                                'compressed': True,
                                'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                            }
                        },
                    }
                ),
                encoding='utf-8',
            )

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(upload_r2.CACHE_SCHEMA_VERSION, cache_data['version'])
        self.assertEqual({}, cache_data['files'])
        self.assertEqual(
            {
                'bucket-name|gallery/image.png': {
                    'size': 9,
                    'mtime': 123.0,
                    'compressed': True,
                    'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                }
            },
            cache_data['_legacy_targets']['r2'],
        )
        self.assertEqual(
            {
                'linux-host|/srv/gallery/image.png': {
                    'size': 9,
                    'mtime': 123.0,
                    'compressed': True,
                    'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                }
            },
            cache_data['_legacy_targets']['linux'],
        )

    def test_promote_legacy_cache_entry_marks_matching_target_as_synced(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            cache_data['_legacy_targets'] = {
                'r2': {'bucket-name|gallery/image.png': fingerprint},
                'linux': {},
                'qiniu': {},
            }
            config = upload_r2.UploadRuntimeConfig(
                target='r2',
                bucket='bucket-name',
                prefix='gallery',
                region='auto',
                endpoint='https://example.invalid',
                r2_proxy=None,
                linux_host='linux-host',
                linux_user='linux-user',
                linux_dir='/srv/gallery',
                linux_key='/tmp/id_rsa',
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access',
                qiniu_secret_key='qiniu-secret',
                access_key='r2-access',
                secret_key='r2-secret',
            )

            promoted = upload_r2.promote_legacy_cache_entries(
                [path],
                base_dir=base_dir,
                cache_data=cache_data,
                config=config,
                target_labels=('r2',),
            )

        self.assertEqual({'r2': 1, 'linux': 0, 'qiniu': 0}, promoted)
        self.assertTrue(
            upload_r2.is_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket-name|gallery/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
        )

    def test_promote_legacy_cache_entry_ignores_mismatched_fingerprint(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['_legacy_targets'] = {
                'r2': {
                    'bucket-name|gallery/image.png': {
                        'size': 1,
                        'mtime': 1.0,
                        'compressed': True,
                        'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                    }
                },
                'linux': {},
                'qiniu': {},
            }
            config = upload_r2.UploadRuntimeConfig(
                target='r2',
                bucket='bucket-name',
                prefix='gallery',
                region='auto',
                endpoint='https://example.invalid',
                r2_proxy=None,
                linux_host='linux-host',
                linux_user='linux-user',
                linux_dir='/srv/gallery',
                linux_key='/tmp/id_rsa',
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access',
                qiniu_secret_key='qiniu-secret',
                access_key='r2-access',
                secret_key='r2-secret',
            )

            promoted = upload_r2.promote_legacy_cache_entries(
                [path],
                base_dir=base_dir,
                cache_data=cache_data,
                config=config,
                target_labels=('r2',),
            )

        self.assertEqual({'r2': 0, 'linux': 0, 'qiniu': 0}, promoted)
        self.assertFalse(
            upload_r2.is_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket-name|gallery/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
        )
```

- [ ] **Step 2: Run the legacy-cache tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.LegacyCacheCompatibilityTests -v
```

Expected: FAIL with missing `_legacy_targets` handling and missing `promote_legacy_cache_entries()`.

- [ ] **Step 3: Implement legacy cache ingestion and promotion helpers**

In `upload_r2.py`, update `load_upload_cache()` and add helpers near the cache section:

```python
def build_empty_upload_cache() -> dict:
    return {
        'version': CACHE_SCHEMA_VERSION,
        'files': {},
    }


def get_legacy_target_sections(cache_data: dict) -> dict[str, dict]:
    legacy = cache_data.get('_legacy_targets')
    if isinstance(legacy, dict):
        return {
            'r2': legacy.get('r2') if isinstance(legacy.get('r2'), dict) else {},
            'linux': legacy.get('linux') if isinstance(legacy.get('linux'), dict) else {},
            'qiniu': legacy.get('qiniu') if isinstance(legacy.get('qiniu'), dict) else {},
        }
    return {'r2': {}, 'linux': {}, 'qiniu': {}}


def load_upload_cache(path: Path) -> dict:
    empty_cache = build_empty_upload_cache()
    if not path.exists() or not path.is_file():
        return empty_cache
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return empty_cache
    if not isinstance(data, dict):
        return empty_cache
    if data.get('version') == CACHE_SCHEMA_VERSION:
        files = data.get('files')
        if not isinstance(files, dict):
            return empty_cache
        return {
            'version': CACHE_SCHEMA_VERSION,
            'files': files,
        }

    legacy_targets = {
        'r2': data.get('r2') if isinstance(data.get('r2'), dict) else {},
        'linux': data.get('linux') if isinstance(data.get('linux'), dict) else {},
        'qiniu': data.get('qiniu') if isinstance(data.get('qiniu'), dict) else {},
    }
    if not any(legacy_targets.values()):
        return empty_cache

    cache_data = build_empty_upload_cache()
    cache_data['_legacy_targets'] = legacy_targets
    return cache_data


def promote_legacy_cache_entries(
    files: list[Path],
    *,
    base_dir: Path,
    cache_data: dict,
    config: UploadRuntimeConfig,
    target_labels: tuple[str, ...],
) -> dict[str, int]:
    legacy_targets = get_legacy_target_sections(cache_data)
    promoted = {'r2': 0, 'linux': 0, 'qiniu': 0}
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path)
        fingerprint = build_upload_cache_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
        for target_label in target_labels:
            if target_label == 'r2':
                target_id = get_target_cache_id('r2', path, base_dir=base_dir, config=config)
            elif target_label == 'linux':
                target_id = get_target_cache_id('linux', path, base_dir=base_dir, config=config)
            else:
                target_id = get_target_cache_id('qiniu', path, base_dir=base_dir, config=config)
            legacy_entry = legacy_targets.get(target_label, {}).get(target_id)
            if legacy_entry != fingerprint:
                continue
            if apply_target_result_to_cache(
                cache_data,
                path,
                base_dir=base_dir,
                target_label=target_label,
                target_id=target_id,
                status='skipped',
                compressed=compressed,
                compression_strategy=compression_strategy,
            ):
                promoted[target_label] += 1
    return promoted
```

- [ ] **Step 4: Save only v4 fields when writing cache**

Update `save_upload_cache()` in `upload_r2.py` so transient legacy data is dropped:

```python
def save_upload_cache(path: Path, cache_data: dict) -> None:
    serializable_cache = {
        'version': CACHE_SCHEMA_VERSION,
        'files': cache_data.get('files') if isinstance(cache_data.get('files'), dict) else {},
    }
    with tempfile.NamedTemporaryFile(
        mode='w',
        encoding='utf-8',
        dir=path.parent,
        prefix=f'{path.name}.',
        suffix='.tmp',
        delete=False,
    ) as temp_file:
        json.dump(serializable_cache, temp_file, ensure_ascii=False, indent=2, sort_keys=True)
        temp_path = Path(temp_file.name)
    os.replace(temp_path, path)
```

- [ ] **Step 5: Run the legacy-cache tests again**

Run:

```bash
python -m unittest tests.test_upload_r2.LegacyCacheCompatibilityTests -v
```

Expected: all tests PASS.

- [ ] **Step 6: Verification checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheSectionHelperTests -v
```

Expected: PASS and no regressions in existing v4 cache behavior.

### Task 2: Promote legacy cache entries inside `run_upload()` before pending planning

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing `run_upload()` legacy-promotion regression test**

Add this test inside `PendingUploadPlanningTests` near the existing cache-hit tests:

```python
def test_run_upload_promotes_legacy_cache_hits_before_pending_planning(self):
    with TemporaryDirectory() as temp_dir:
        folder = Path(temp_dir)
        path = folder / 'image.png'
        path.write_bytes(b'png-bytes')
        args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
        config = self.make_runtime_config(target='r2')
        fingerprint = upload_r2.build_upload_cache_fingerprint(
            path,
            compressed=True,
            compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
        )
        cache_data = upload_r2.build_empty_upload_cache()
        cache_data['_legacy_targets'] = {
            'r2': {'bucket-name|gallery/image.png': fingerprint},
            'linux': {},
            'qiniu': {},
        }
        logs = []

        with patch('upload_r2.resolve_runtime_config', return_value=config), \
             patch('upload_r2.collect_files', return_value=[path]), \
             patch('upload_r2.load_upload_cache', return_value=cache_data), \
             patch('upload_r2.save_upload_cache') as save_mock, \
             patch('upload_r2.list_existing_keys') as list_existing_keys_mock, \
             patch('upload_r2.upload_pending_r2_files') as batch_upload_mock, \
             patch('upload_r2.upload_one') as upload_one_mock, \
             patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
            exit_code = upload_r2.run_upload(args, log_callback=logs.append)

    self.assertEqual(0, exit_code)
    list_existing_keys_mock.assert_not_called()
    batch_upload_mock.assert_not_called()
    upload_one_mock.assert_not_called()
    self.assertIn('Legacy cache promotions: 1', logs)
    self.assertIn('[R2] SKIP image.png -> s3://bucket-name/gallery/image.png', logs)
    save_mock.assert_called_once()
```

- [ ] **Step 2: Run the new `run_upload()` regression test and verify it fails**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_promotes_legacy_cache_hits_before_pending_planning -v
```

Expected: FAIL because `run_upload()` does not yet promote legacy hits before calling `plan_pending_uploads()`.

- [ ] **Step 3: Promote legacy hits before planning pending uploads**

In `run_upload()` inside `upload_r2.py`, insert promotion immediately after `target_labels = targets_for_mode(normalized_target)` and before `plan_pending_uploads(...)`:

```python
    skip_existing = not args.no_skip_existing
    target_labels = targets_for_mode(normalized_target)
    legacy_promotions = {'r2': 0, 'linux': 0, 'qiniu': 0}
    if skip_existing and not refresh_cache:
        legacy_promotions = promote_legacy_cache_entries(
            files,
            base_dir=folder,
            cache_data=cache_data,
            config=config,
            target_labels=target_labels,
        )
        if any(legacy_promotions.values()):
            cache_dirty = True

    pending_by_target = plan_pending_uploads(
        files,
        base_dir=folder,
        config=config,
        target_labels=target_labels,
        cache_data=cache_data,
        skip_existing=skip_existing,
    )
```

- [ ] **Step 4: Emit legacy-promotion counts in the startup logs**

Replace the current per-target log section in `run_upload()` with explicit counters:

```python
    if normalized_target in {'r2', 'all'}:
        emit_message(f'Bucket: {config.bucket}', log_callback)
        emit_message(f'Endpoint: {config.endpoint}', log_callback)
        emit_message(f'Prefix: {config.prefix or "(none)"}', log_callback)
        emit_message(f'Skip existing: {"yes" if skip_existing else "no"}', log_callback)
        emit_message(f'Local cache hits: {len(existing_keys or set())}', log_callback)
        emit_message(f'Legacy cache promotions: {legacy_promotions.get("r2", 0)}', log_callback)
        emit_message(f'Pending uploads after classification: {len(pending_by_target.get("r2", []))}', log_callback)
    if normalized_target in {'linux', 'all'}:
        emit_message(f'Linux target: {config.linux_user}@{config.linux_host}:{config.linux_dir}', log_callback)
        emit_message(f'Linux port: {config.linux_port}', log_callback)
        emit_message('Linux transfer mode: batched SSH/SFTP with key-upload fallback when needed', log_callback)
        emit_message(f'Local cache hits: {len(existing_linux_paths or set())}', log_callback)
        emit_message(f'Legacy cache promotions: {legacy_promotions.get("linux", 0)}', log_callback)
        emit_message(f'Pending uploads after classification: {len(pending_by_target.get("linux", []))}', log_callback)
    if normalized_target in {'qiniu', 'all'}:
        emit_message(f'Qiniu bucket: {config.qiniu_bucket}', log_callback)
        emit_message(f'Qiniu prefix: {config.qiniu_prefix or "(none)"}', log_callback)
        emit_message(f'Qiniu skip existing: {"yes" if skip_existing else "no"}', log_callback)
        emit_message(f'Local cache hits: {len(qiniu_existing_keys or set())}', log_callback)
        emit_message(f'Legacy cache promotions: {legacy_promotions.get("qiniu", 0)}', log_callback)
        emit_message(f'Pending uploads after classification: {len(pending_by_target.get("qiniu", []))}', log_callback)
```

- [ ] **Step 5: Run the new test again**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_promotes_legacy_cache_hits_before_pending_planning -v
```

Expected: PASS.

- [ ] **Step 6: Verification checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_without_verify_remote_does_not_probe_cached_hits tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_with_verify_remote_only_checks_pending_r2_keys -v
```

Expected: PASS and no regression in current v4 cache behavior.

### Task 3: Add cold-start remote precheck before PNG preparation for R2 and Qiniu

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing R2/Qiniu cold-start tests**

Add these tests inside `PendingUploadPlanningTests` near the `verify_remote` tests:

```python
def test_run_upload_cold_start_r2_precheck_skips_existing_png_before_prepare(self):
    with TemporaryDirectory() as temp_dir:
        folder = Path(temp_dir)
        path = folder / 'verified.png'
        path.write_bytes(b'png-bytes')
        args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
        config = self.make_runtime_config(target='r2')
        logs = []

        with patch('upload_r2.resolve_runtime_config', return_value=config), \
             patch('upload_r2.collect_files', return_value=[path]), \
             patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
             patch('upload_r2.save_upload_cache') as save_mock, \
             patch('upload_r2.list_existing_keys', return_value=({'gallery/verified.png'}, None)) as list_existing_keys_mock, \
             patch('upload_r2.prepare_upload_file') as prepare_mock, \
             patch('upload_r2.upload_pending_r2_files', return_value=[]) as batch_upload_mock, \
             patch('upload_r2.upload_one') as upload_one_mock, \
             patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
            exit_code = upload_r2.run_upload(args, log_callback=logs.append)

    self.assertEqual(0, exit_code)
    self.assertEqual(['gallery/verified.png'], list_existing_keys_mock.call_args.kwargs['object_keys'])
    prepare_mock.assert_not_called()
    batch_upload_mock.assert_not_called()
    upload_one_mock.assert_not_called()
    self.assertIn('Remote precheck confirmed existing: 1', logs)
    self.assertIn('[R2] SKIP verified.png -> s3://bucket-name/gallery/verified.png', logs)
    save_mock.assert_called_once()


def test_run_upload_cold_start_qiniu_precheck_skips_existing_png_before_prepare(self):
    with TemporaryDirectory() as temp_dir:
        folder = Path(temp_dir)
        path = folder / 'verified.png'
        path.write_bytes(b'png-bytes')
        args = self.make_args(dir=str(folder), target='qiniu', verify_remote=False)
        config = self.make_runtime_config(target='qiniu')
        logs = []

        with patch('upload_r2.resolve_runtime_config', return_value=config), \
             patch('upload_r2.collect_files', return_value=[path]), \
             patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
             patch('upload_r2.save_upload_cache') as save_mock, \
             patch('upload_r2.list_existing_qiniu_keys', return_value=({'gallery/verified.png'}, None)) as list_existing_qiniu_mock, \
             patch('upload_r2.prepare_upload_file') as prepare_mock, \
             patch('upload_r2.upload_pending_qiniu_files', return_value=[]) as batch_upload_mock, \
             patch('upload_r2.upload_one') as upload_one_mock, \
             patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
            exit_code = upload_r2.run_upload(args, log_callback=logs.append)

    self.assertEqual(0, exit_code)
    self.assertEqual(
        ('qiniu-bucket', ['gallery/verified.png'], 'qiniu-access', 'qiniu-secret'),
        list_qiniu_mock.call_args.args,
    )
    prepare_mock.assert_not_called()
    batch_upload_mock.assert_not_called()
    upload_one_mock.assert_not_called()
    self.assertIn('Remote precheck confirmed existing: 1', logs)
    self.assertIn('[QINIU] SKIP verified.png -> qiniu://qiniu-bucket/gallery/verified.png', logs)
    save_mock.assert_called_once()
```

- [ ] **Step 2: Run the R2/Qiniu cold-start tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_r2_precheck_skips_existing_png_before_prepare tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_qiniu_precheck_skips_existing_png_before_prepare -v
```

Expected: FAIL because cold-start precheck only runs behind `--verify-remote` today.

- [ ] **Step 3: Add a helper that decides when cold-start precheck should run**

In `upload_r2.py`, add this helper near `plan_pending_uploads()`:

```python
def should_precheck_pending_targets(
    *,
    skip_existing: bool,
    dry_run: bool,
    verify_remote: bool,
    cache_data: dict,
    target_label: str,
) -> bool:
    if not skip_existing or dry_run:
        return False
    if verify_remote:
        return True
    files = cache_data.get('files') if isinstance(cache_data.get('files'), dict) else {}
    if not files:
        return True
    return not any(
        isinstance(record, dict)
        and isinstance(record.get('targets'), dict)
        and isinstance(record['targets'].get(target_label), dict)
        for record in files.values()
    )
```

- [ ] **Step 4: Use cold-start precheck for unresolved R2 and Qiniu pending items before upload preparation**

Replace the `if skip_existing and verify_remote and not args.dry_run:` gate in `run_upload()` with per-target checks:

```python
    verify_remote = getattr(args, 'verify_remote', False)
    remote_precheck_counts = {'r2': 0, 'linux': 0, 'qiniu': 0}
    linux_precheck_completed = False

    if 'r2' in target_labels and should_precheck_pending_targets(
        skip_existing=skip_existing,
        dry_run=args.dry_run,
        verify_remote=verify_remote,
        cache_data=cache_data,
        target_label='r2',
    ):
        pending_r2 = pending_by_target.get('r2', [])
        pending_r2_keys = [
            build_object_key(item.source_path, base_dir=folder, prefix=normalized_prefix)
            for item in pending_r2
        ]
        if pending_r2_keys:
            emit_message('Prechecking pending R2 objects...', log_callback)
            online_existing_keys, list_error = list_existing_keys(
                endpoint=config.endpoint,
                bucket=config.bucket,
                prefix=normalized_prefix,
                access_key=config.access_key or '',
                secret_key=config.secret_key or '',
                region=config.region,
                proxy_url=config.r2_proxy,
                object_keys=pending_r2_keys,
            )
            if list_error:
                emit_message(f'Failed to list existing objects: {list_error}', log_callback, stream=sys.stderr)
                return 1
            existing_keys = existing_keys or set()
            existing_keys.update(online_existing_keys)
            remote_precheck_counts['r2'] = len(online_existing_keys)
            files_by_object_key = {
                build_object_key(path, base_dir=folder, prefix=normalized_prefix): path
                for path in files
            }
            for object_key in online_existing_keys:
                path = files_by_object_key.get(object_key)
                if path is None:
                    continue
                compressed, compression_strategy = get_expected_upload_cache_semantics(path)
                if update_r2_cache_entry(
                    cache_data,
                    base_dir=folder,
                    bucket=config.bucket,
                    object_key=object_key,
                    path=path,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                ):
                    cache_dirty = True

    if 'qiniu' in target_labels and should_precheck_pending_targets(
        skip_existing=skip_existing,
        dry_run=args.dry_run,
        verify_remote=verify_remote,
        cache_data=cache_data,
        target_label='qiniu',
    ):
        pending_qiniu = pending_by_target.get('qiniu', [])
        pending_qiniu_keys = [
            build_object_key(item.source_path, base_dir=folder, prefix=normalized_qiniu_prefix)
            for item in pending_qiniu
        ]
        if pending_qiniu_keys:
            emit_message('Prechecking pending Qiniu objects...', log_callback)
            online_qiniu_keys, qiniu_list_error = list_existing_qiniu_keys(
                config.qiniu_bucket,
                pending_qiniu_keys,
                config.qiniu_access_key or '',
                config.qiniu_secret_key or '',
            )
            if qiniu_list_error:
                emit_message(f'Failed to list existing Qiniu objects: {qiniu_list_error}', log_callback, stream=sys.stderr)
                return 1
            qiniu_existing_keys = qiniu_existing_keys or set()
            qiniu_existing_keys.update(online_qiniu_keys)
            remote_precheck_counts['qiniu'] = len(online_qiniu_keys)
            qiniu_files_by_key = {
                build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix): path
                for path in files
            }
            for object_key in online_qiniu_keys:
                path = qiniu_files_by_key.get(object_key)
                if path is None:
                    continue
                compressed, compression_strategy = get_expected_upload_cache_semantics(path)
                if update_qiniu_cache_entry(
                    cache_data,
                    base_dir=folder,
                    bucket=config.qiniu_bucket,
                    object_key=object_key,
                    path=path,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                ):
                    cache_dirty = True
```

- [ ] **Step 5: Add remote-precheck counts to the log block**

Extend the per-target log lines from Task 2 with:

```python
emit_message(f'Remote precheck confirmed existing: {remote_precheck_counts.get("r2", 0)}', log_callback)
emit_message(f'Remote precheck confirmed existing: {remote_precheck_counts.get("linux", 0)}', log_callback)
emit_message(f'Remote precheck confirmed existing: {remote_precheck_counts.get("qiniu", 0)}', log_callback)
```

Place each line in the matching target block.

- [ ] **Step 6: Run the cold-start R2/Qiniu tests again**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_r2_precheck_skips_existing_png_before_prepare tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_qiniu_precheck_skips_existing_png_before_prepare -v
```

Expected: PASS.

### Task 4: Add cold-start Linux precheck before PNG preparation and finish log/save regressions

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing Linux cold-start and save-cleanup tests**

Add these tests to `tests/test_upload_r2.py`:

```python
def test_run_upload_cold_start_linux_filename_precheck_skips_existing_png_before_prepare(self):
    with TemporaryDirectory() as temp_dir:
        folder = Path(temp_dir)
        path = folder / 'verified.png'
        path.write_bytes(b'png-bytes')
        args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
        config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
        logs = []

        with patch('upload_r2.resolve_runtime_config', return_value=config), \
             patch('upload_r2.collect_files', return_value=[path]), \
             patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
             patch('upload_r2.save_upload_cache') as save_mock, \
             patch('upload_r2.list_existing_linux_filenames', return_value=({'verified.png'}, None)) as list_linux_mock, \
             patch('upload_r2.check_linux_remote_skip_result') as exact_check_mock, \
             patch('upload_r2.prepare_upload_file') as prepare_mock, \
             patch('upload_r2.upload_pending_linux_files', return_value=[]) as batch_upload_mock:
            exit_code = upload_r2.run_upload(args, log_callback=logs.append)

    self.assertEqual(0, exit_code)
    list_linux_mock.assert_called_once_with(upload_r2.LINUX_EXISTING_PHOTOS_API_URL)
    exact_check_mock.assert_not_called()
    prepare_mock.assert_not_called()
    batch_upload_mock.assert_not_called()
    self.assertIn('Remote precheck confirmed existing: 1', logs)
    self.assertIn('[LINUX] SKIP verified.png -> linux-user@linux-host:/srv/gallery/verified.png', logs)
    save_mock.assert_called_once()


def test_save_upload_cache_drops_transient_legacy_targets(self):
    with TemporaryDirectory() as temp_dir:
        cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
        cache_data = upload_r2.build_empty_upload_cache()
        cache_data['files']['image.png'] = {'source': {'size': 1, 'mtime': 1.0}, 'targets': {}}
        cache_data['_legacy_targets'] = {'r2': {'bucket|gallery/image.png': {'size': 1}}}

        upload_r2.save_upload_cache(cache_path, cache_data)

        saved = json.loads(cache_path.read_text(encoding='utf-8'))

    self.assertEqual({'version': upload_r2.CACHE_SCHEMA_VERSION, 'files': {'image.png': {'source': {'size': 1, 'mtime': 1.0}, 'targets': {}}}}, saved)
```

- [ ] **Step 2: Run the Linux/save-cleanup tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_linux_filename_precheck_skips_existing_png_before_prepare tests.test_upload_r2.LegacyCacheCompatibilityTests.test_save_upload_cache_drops_transient_legacy_targets -v
```

Expected: FAIL because Linux cold-start precheck is not yet wired and the new save-cleanup assertion may still fail.

- [ ] **Step 3: Add Linux cold-start filename precheck with exact fallback**

In `upload_r2.py`, add helpers near `list_existing_linux_filenames()`:

```python
def has_unique_basenames(files: list[Path]) -> bool:
    names = [path.name for path in files]
    return len(names) == len(set(names))


def precheck_pending_linux_items(
    items: list[PlannedUpload],
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[set[str], list[tuple[Path, tuple[str, str, bool, str | None]]], int]:
    existing_paths: set[str] = set()
    skip_results: list[tuple[Path, tuple[str, str, bool, str | None]]] = []
    confirmed = 0
    filename_hits: set[str] = set()
    if items and has_unique_basenames([item.source_path for item in items]):
        filename_hits, filename_error = list_existing_linux_filenames()
        if filename_error:
            raise RuntimeError(filename_error)
    for item in items:
        path = item.source_path
        remote_path = build_linux_remote_path(path, base_dir=base_dir, remote_dir=config.linux_dir or '')
        if path.name in filename_hits:
            message = f'SKIP {path.name} -> {config.linux_user or ""}@{config.linux_host or ""}:{remote_path}'
            existing_paths.add(remote_path)
            skip_results.append((path, ('skipped', message, item.compressed, item.compression_strategy)))
            confirmed += 1
            continue
        remote_skip_result = check_linux_remote_skip_result(
            path,
            base_dir=base_dir,
            remote_dir=config.linux_dir or '',
            host=config.linux_host or '',
            user=config.linux_user or '',
            ssh_key=config.linux_key,
            password=config.linux_password,
            port=config.linux_port,
            proxy_url=config.linux_proxy,
        )
        if remote_skip_result is None:
            continue
        status, message = remote_skip_result
        if status != 'skipped':
            raise RuntimeError(message)
        existing_paths.add(remote_path)
        skip_results.append((path, ('skipped', message, item.compressed, item.compression_strategy)))
        confirmed += 1
    return existing_paths, skip_results, confirmed
```

- [ ] **Step 4: Use Linux cold-start precheck in `run_upload()` before any PNG preparation**

Replace the current Linux `verify_remote` block with:

```python
    if 'linux' in target_labels and should_precheck_pending_targets(
        skip_existing=skip_existing,
        dry_run=args.dry_run,
        verify_remote=verify_remote,
        cache_data=cache_data,
        target_label='linux',
    ):
        linux_precheck_completed = True
        pending_linux = pending_by_target.get('linux', [])
        try:
            prechecked_paths, verified_linux_skip_results, confirmed = precheck_pending_linux_items(
                pending_linux,
                base_dir=folder,
                config=config,
            )
        except RuntimeError as exc:
            emit_message(format_result_message('linux', str(exc)), log_callback)
            return 1
        existing_linux_paths = existing_linux_paths or set()
        existing_linux_paths.update(prechecked_paths)
        remote_precheck_counts['linux'] = confirmed
        for path, result in verified_linux_skip_results:
            remote_path = build_linux_remote_path(path, base_dir=folder, remote_dir=config.linux_dir or '')
            if update_linux_cache_entry(
                cache_data,
                base_dir=folder,
                host=config.linux_host or '',
                remote_path=remote_path,
                path=path,
                compressed=result[2],
                compression_strategy=result[3],
            ):
                cache_dirty = True
```

- [ ] **Step 5: Run the Linux/save-cleanup tests again**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_cold_start_linux_filename_precheck_skips_existing_png_before_prepare tests.test_upload_r2.LegacyCacheCompatibilityTests.test_save_upload_cache_drops_transient_legacy_targets -v
```

Expected: PASS.

- [ ] **Step 6: Final regression checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests tests.test_upload_r2.LegacyCacheCompatibilityTests tests.test_upload_r2.RunUploadCacheWriteRegressionTests -v
```

Expected: PASS.

- [ ] **Step 7: Final full verification checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2 -v
```

Expected: PASS with no regressions in upload batching, cache writes, or prepared PNG metadata behavior.
