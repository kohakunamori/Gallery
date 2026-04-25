# Upload R2 Incremental Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repeated runs of `upload_r2.py` fast by default through a local-first sync index, persistent PNG prepared-cache reuse, and connection reuse, while preserving upload success rate and compression quality.

**Architecture:** Replace the current remote-key skip cache with a v4 local-file sync index keyed by relative path. `run_upload()` will first classify each file into per-target pending queues using local fingerprints, optionally verify only those pending entries with `--verify-remote`, then execute per-target upload batches that reuse clients/connections and update target state independently. PNGs keep the current `oxipng` settings, but prepared artifacts move into a persistent cache so repeated runs avoid recompression.

**Tech Stack:** Python 3.14, unittest, boto3/botocore, paramiko, qiniu SDK, pathlib, tempfile, hashlib, json, concurrent.futures

---

## File Map

- `upload_r2.py` — change cache schema and I/O, add local-first pending planning, add `--verify-remote`, add persistent PNG prepared cache, add target batch executors, and refactor Linux batch upload fallback behavior.
- `tests/test_upload_r2.py` — add regression tests for the v4 sync index, pending planning, verify-remote behavior, prepared PNG cache reuse, R2/Qiniu client reuse, Linux batch fallback, and atomic cache writes.
- `docs/superpowers/specs/2026-04-19-upload-r2-incremental-performance-design.md` — reference only; no edits.

## Notes

- This working directory is not a git repository, so replace commit steps with explicit verification checkpoints.
- Keep `both` as an alias for `all`.
- Do not change `upload_r2_gui.py` in this plan.
- Do not weaken `PNG_COMPRESSION_STRATEGY`.
- Keep partial-success semantics: each target updates its own sync state independently.

### Task 1: Replace the old cache with a v4 local-file sync index

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing sync-index and atomic-save tests**

Add this test class near the top-level cache helper tests in `tests/test_upload_r2.py`:

```python
class IncrementalSyncIndexTests(unittest.TestCase):
    def test_load_upload_cache_discards_v3_sections_and_returns_v4_files_index(self):
        with TemporaryDirectory() as tmpdir:
            cache_path = Path(tmpdir) / upload_r2.CACHE_FILE_NAME
            cache_path.write_text(
                json.dumps(
                    {
                        'version': 3,
                        'r2': {'bucket|gallery/image.png': {'size': 1, 'mtime': 1.0, 'compressed': True, 'compression_strategy': 'old'}},
                        'linux': {},
                        'qiniu': {},
                    }
                ),
                encoding='utf-8',
            )

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(cache_data, upload_r2.build_empty_upload_cache())

    def test_set_target_synced_creates_v4_file_record(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed = upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='static-bucket|gallery/nested/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

        self.assertTrue(changed)
        self.assertEqual(
            cache_data['files']['nested/image.png']['source'],
            upload_r2.build_source_cache_fingerprint(path),
        )
        self.assertEqual(
            cache_data['files']['nested/image.png']['targets']['r2']['id'],
            'static-bucket|gallery/nested/image.png',
        )
        self.assertEqual(
            cache_data['files']['nested/image.png']['targets']['r2']['synced_fingerprint'],
            upload_r2.build_synced_target_fingerprint(
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            ),
        )

    def test_save_upload_cache_replaces_file_atomically(self):
        with TemporaryDirectory() as tmpdir:
            cache_path = Path(tmpdir) / upload_r2.CACHE_FILE_NAME
            cache_data = upload_r2.build_empty_upload_cache()
            replace_calls = []

            def fake_replace(src, dst):
                replace_calls.append((Path(src).name, Path(dst).name))
                Path(dst).write_text(Path(src).read_text(encoding='utf-8'), encoding='utf-8')
                Path(src).unlink()

            with patch.object(upload_r2.os, 'replace', side_effect=fake_replace):
                upload_r2.save_upload_cache(cache_path, cache_data)

        self.assertEqual(len(replace_calls), 1)
        self.assertEqual(replace_calls[0][1], upload_r2.CACHE_FILE_NAME)
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.IncrementalSyncIndexTests.test_load_upload_cache_discards_v3_sections_and_returns_v4_files_index tests.test_upload_r2.IncrementalSyncIndexTests.test_set_target_synced_creates_v4_file_record tests.test_upload_r2.IncrementalSyncIndexTests.test_save_upload_cache_replaces_file_atomically -v
```

Expected: failures because `build_empty_upload_cache()`, `set_target_synced()`, `build_source_cache_fingerprint()`, `build_synced_target_fingerprint()`, and atomic `save_upload_cache()` do not exist yet.

- [ ] **Step 3: Add the v4 cache helpers and atomic save implementation**

In `upload_r2.py`, replace the old empty-cache shape and add the new helpers:

```python
CACHE_SCHEMA_VERSION = 4
PREPARED_CACHE_DIR_NAME = '.upload_prepared_cache'


def build_empty_upload_cache() -> dict:
    return {
        'version': CACHE_SCHEMA_VERSION,
        'files': {},
    }


def build_source_cache_fingerprint(path: Path) -> dict[str, float | int]:
    stat = path.stat()
    return {
        'size': stat.st_size,
        'mtime': stat.st_mtime,
    }


def build_synced_target_fingerprint(
    path: Path,
    *,
    compressed: bool,
    compression_strategy: str | None,
) -> dict[str, float | int | bool | str | None]:
    fingerprint = build_source_cache_fingerprint(path)
    fingerprint.update(
        {
            'compressed': compressed,
            'compression_strategy': compression_strategy,
        }
    )
    return fingerprint


def build_cache_relative_path(path: Path, *, base_dir: Path) -> str:
    return path.relative_to(base_dir).as_posix()


def get_file_cache_record(cache_data: dict, relative_path: str, *, initialize: bool = False) -> dict | None:
    files = cache_data.get('files')
    if not isinstance(files, dict):
        if not initialize:
            return None
        files = {}
        cache_data['files'] = files

    record = files.get(relative_path)
    if isinstance(record, dict):
        return record
    if not initialize:
        return None

    record = {'source': {}, 'targets': {}}
    files[relative_path] = record
    return record


def set_target_synced(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    target_label: str,
    target_id: str,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    record = get_file_cache_record(cache_data, relative_path, initialize=True)
    source_fingerprint = build_source_cache_fingerprint(path)
    target_fingerprint = build_synced_target_fingerprint(
        path,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
    next_target_entry = {
        'id': target_id,
        'synced_fingerprint': target_fingerprint,
    }
    changed = False
    if record.get('source') != source_fingerprint:
        record['source'] = source_fingerprint
        changed = True
    targets = record.setdefault('targets', {})
    if targets.get(target_label) != next_target_entry:
        targets[target_label] = next_target_entry
        changed = True
    return changed
```

Update `load_upload_cache()` and `save_upload_cache()`:

```python
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
    if data.get('version') != CACHE_SCHEMA_VERSION:
        return empty_cache
    files = data.get('files')
    if not isinstance(files, dict):
        return empty_cache
    return {
        'version': CACHE_SCHEMA_VERSION,
        'files': files,
    }


def save_upload_cache(path: Path, cache_data: dict) -> None:
    temp_file = tempfile.NamedTemporaryFile(
        mode='w',
        delete=False,
        dir=path.parent,
        suffix='.tmp',
        encoding='utf-8',
    )
    try:
        with temp_file:
            json.dump(cache_data, temp_file, ensure_ascii=False, indent=2, sort_keys=True)
        os.replace(temp_file.name, path)
    finally:
        temp_path = Path(temp_file.name)
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)
```

- [ ] **Step 4: Run the focused tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.IncrementalSyncIndexTests.test_load_upload_cache_discards_v3_sections_and_returns_v4_files_index tests.test_upload_r2.IncrementalSyncIndexTests.test_set_target_synced_creates_v4_file_record tests.test_upload_r2.IncrementalSyncIndexTests.test_save_upload_cache_replaces_file_atomically -v
```

Expected: all three tests pass.

### Task 2: Plan pending work locally and add `--verify-remote`

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing pending-planning tests**

Add this test class after the sync-index tests in `tests/test_upload_r2.py`:

```python
class PendingUploadPlanningTests(unittest.TestCase):
    def make_config(self, **overrides):
        args = SimpleNamespace(
            target='all',
            bucket='static-bucket',
            prefix='gallery',
            endpoint='https://example.r2.cloudflarestorage.com',
            region='auto',
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
        )
        for key, value in overrides.items():
            setattr(args, key, value)
        return upload_r2.resolve_runtime_config(args)

    def test_plan_pending_uploads_skips_targets_with_matching_cached_fingerprint(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            config = self.make_config()
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='static-bucket|gallery/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            pending = upload_r2.plan_pending_uploads(
                [path],
                base_dir=base_dir,
                config=config,
                target_labels=('r2', 'linux', 'qiniu'),
                cache_data=cache_data,
            )

        self.assertEqual([], pending['r2'])
        self.assertEqual([path], [item.source_path for item in pending['linux']])
        self.assertEqual([path], [item.source_path for item in pending['qiniu']])

    def test_run_upload_without_verify_remote_does_not_probe_cached_hits(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.jpg'
            path.write_bytes(b'jpg-bytes')
            cache_path = Path(tmpdir) / upload_r2.CACHE_FILE_NAME
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='static-bucket|gallery/image.jpg',
                compressed=False,
                compression_strategy=None,
            )
            upload_r2.save_upload_cache(cache_path, cache_data)

            args = SimpleNamespace(
                dir=str(base_dir),
                env_file=None,
                recursive=False,
                workers=1,
                dry_run=False,
                no_skip_existing=False,
                refresh_cache=False,
                verify_remote=False,
                target='r2',
                bucket='static-bucket',
                prefix='gallery',
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=None,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
            )

            with patch.object(upload_r2, 'get_cache_file_path', return_value=cache_path), \
                 patch.object(upload_r2, 'list_existing_keys') as list_mock, \
                 patch.object(upload_r2, 'upload_pending_r2_files', return_value=[]):
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(exit_code, 0)
        list_mock.assert_not_called()
```

- [ ] **Step 2: Run the focused planning tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_plan_pending_uploads_skips_targets_with_matching_cached_fingerprint tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_without_verify_remote_does_not_probe_cached_hits -v
```

Expected: failures because `plan_pending_uploads()` and `upload_pending_r2_files()` do not exist yet and `run_upload()` still performs remote-first checks.

- [ ] **Step 3: Add the pending-planning dataclass and helpers**

In `upload_r2.py`, add a local planning dataclass and sync-check helper near the cache functions:

```python
@dataclass(frozen=True)
class PlannedUpload:
    source_path: Path
    relative_path: str
    compressed: bool
    compression_strategy: str | None


def get_target_cache_id(
    target_label: str,
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> str:
    if target_label == 'r2':
        return build_r2_cache_key(
            config.bucket,
            build_object_key(path, base_dir=base_dir, prefix=config.prefix.strip('/')),
        )
    if target_label == 'linux':
        return build_linux_cache_key(
            config.linux_host or '',
            build_linux_remote_path(path, base_dir=base_dir, remote_dir=config.linux_dir or ''),
        )
    return build_qiniu_cache_key(
        config.qiniu_bucket,
        build_object_key(path, base_dir=base_dir, prefix=config.qiniu_prefix.strip('/')),
    )


def is_target_synced(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    target_label: str,
    target_id: str,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    record = get_file_cache_record(cache_data, build_cache_relative_path(path, base_dir=base_dir))
    if record is None:
        return False
    targets = record.get('targets')
    if not isinstance(targets, dict):
        return False
    target_entry = targets.get(target_label)
    if not isinstance(target_entry, dict):
        return False
    return target_entry == {
        'id': target_id,
        'synced_fingerprint': build_synced_target_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        ),
    }


def plan_pending_uploads(
    files: list[Path],
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
    target_labels: tuple[str, ...],
    cache_data: dict,
) -> dict[str, list[PlannedUpload]]:
    pending = {label: [] for label in target_labels}
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path)
        planned = PlannedUpload(
            source_path=path,
            relative_path=build_cache_relative_path(path, base_dir=base_dir),
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
        for target_label in target_labels:
            target_id = get_target_cache_id(
                target_label,
                path,
                base_dir=base_dir,
                config=config,
            )
            if is_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label=target_label,
                target_id=target_id,
                compressed=compressed,
                compression_strategy=compression_strategy,
            ):
                continue
            pending[target_label].append(planned)
    return pending
```

- [ ] **Step 4: Add `--verify-remote` and switch `run_upload()` to local-first queue planning**

Update the parser in `main()`:

```python
    parser.add_argument('--verify-remote', action='store_true', help='Verify exact remote existence only for locally pending targets.')
```

Then replace the old precheck branches in `run_upload()` with this shape:

```python
    target_labels = targets_for_mode(normalized_target)
    pending_by_target = plan_pending_uploads(
        files,
        base_dir=folder,
        config=config,
        target_labels=target_labels,
        cache_data=cache_data,
    )

    if getattr(args, 'verify_remote', False) and 'r2' in pending_by_target:
        pending_keys = [
            build_object_key(item.source_path, base_dir=folder, prefix=normalized_prefix)
            for item in pending_by_target['r2']
        ]
        if pending_keys:
            verified_keys, list_error = list_existing_keys(
                endpoint=config.endpoint,
                bucket=config.bucket,
                prefix=normalized_prefix,
                access_key=config.access_key or '',
                secret_key=config.secret_key or '',
                region=config.region,
                proxy_url=config.r2_proxy,
                object_keys=pending_keys,
            )
            if list_error:
                emit_message(f'Failed to verify pending R2 objects: {list_error}', log_callback, stream=sys.stderr)
                return 1
```

Keep the default path remote-silent: if `verify_remote` is false, do not call `list_existing_keys()`, `list_existing_qiniu_keys()`, `list_existing_linux_filenames()`, or `check_linux_remote_skip_result()` before building pending queues.

- [ ] **Step 5: Run the focused planning tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests.test_plan_pending_uploads_skips_targets_with_matching_cached_fingerprint tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_without_verify_remote_does_not_probe_cached_hits -v
```

Expected: both pass.

### Task 3: Add a persistent prepared-PNG cache and record prepared metadata

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing prepared-cache tests**

Add this test class in `tests/test_upload_r2.py` after the planning tests:

```python
class PreparedPngCacheTests(unittest.TestCase):
    def test_prepare_upload_file_reuses_persistent_cached_png(self):
        def fake_run(command, **kwargs):
            out_path = Path(command[command.index('--out') + 1])
            out_path.write_bytes(b'optimized-png-bytes')
            return subprocess.CompletedProcess(command, 0)

        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            source_path = base_dir / 'image.png'
            prepared_dir = base_dir / '.upload_prepared_cache'
            source_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2.shutil, 'which', return_value='oxipng'), \
                 patch.object(upload_r2.subprocess, 'run', side_effect=fake_run) as run_mock, \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=prepared_dir):
                first = upload_r2.prepare_upload_file(source_path)
                second = upload_r2.prepare_upload_file(source_path)

        self.assertEqual(first.upload_path, second.upload_path)
        self.assertTrue(first.upload_path.is_file())
        self.assertEqual(run_mock.call_count, 1)

    def test_record_prepared_png_metadata_writes_sha_and_size(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            prepared_path = base_dir / '.upload_prepared_cache' / 'abc.png'
            prepared_path.parent.mkdir(parents=True)
            prepared_path.write_bytes(b'optimized-png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            upload_r2.record_prepared_png_metadata(
                cache_data,
                path,
                base_dir=base_dir,
                sha256='abc123',
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                prepared_path=prepared_path,
            )

        self.assertEqual(
            cache_data['files']['image.png']['prepared_png'],
            {
                'sha256': 'abc123',
                'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                'prepared_size': prepared_path.stat().st_size,
            },
        )
```

- [ ] **Step 2: Run the focused prepared-cache tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.PreparedPngCacheTests.test_prepare_upload_file_reuses_persistent_cached_png tests.test_upload_r2.PreparedPngCacheTests.test_record_prepared_png_metadata_writes_sha_and_size -v
```

Expected: failures because `get_prepared_cache_dir()` and `record_prepared_png_metadata()` do not exist and `prepare_upload_file()` always uses disposable temp files.

- [ ] **Step 3: Add the persistent prepared-cache helpers**

In `upload_r2.py`, add these helpers near `prepare_upload_file()`:

```python

def get_prepared_cache_dir() -> Path:
    return Path(__file__).resolve().parent / PREPARED_CACHE_DIR_NAME


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def build_prepared_cache_key(sha256: str, *, compression_strategy: str) -> str:
    strategy_key = compression_strategy.replace(':', '_').replace('/', '_')
    return f'{sha256}--{strategy_key}.png'


def record_prepared_png_metadata(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    sha256: str,
    compression_strategy: str,
    prepared_path: Path,
) -> None:
    record = get_file_cache_record(
        cache_data,
        build_cache_relative_path(path, base_dir=base_dir),
        initialize=True,
    )
    record['prepared_png'] = {
        'sha256': sha256,
        'compression_strategy': compression_strategy,
        'prepared_size': prepared_path.stat().st_size,
    }
```

- [ ] **Step 4: Change `prepare_upload_file()` to reuse persistent prepared PNGs**

Replace the PNG path in `prepare_upload_file()` with this structure:

```python
def prepare_upload_file(path: Path) -> PreparedUpload:
    if path.suffix.lower() != '.png':
        return PreparedUpload(
            source_path=path,
            upload_path=path,
            compressed=False,
            compression_strategy=None,
        )

    oxipng_executable = shutil.which('oxipng')
    if not oxipng_executable:
        raise RuntimeError('oxipng CLI not found in PATH; install oxipng first')

    sha256 = compute_file_sha256(path)
    prepared_dir = get_prepared_cache_dir()
    prepared_dir.mkdir(parents=True, exist_ok=True)
    cache_path = prepared_dir / build_prepared_cache_key(
        sha256,
        compression_strategy=PNG_COMPRESSION_STRATEGY,
    )
    if cache_path.is_file() and cache_path.stat().st_size > 0:
        return PreparedUpload(
            source_path=path,
            upload_path=cache_path,
            temp_path=None,
            compressed=True,
            compression_strategy=PNG_COMPRESSION_STRATEGY,
        )

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.png')
    temp_path = Path(temp_file.name)
    temp_file.close()
    temp_path.unlink(missing_ok=True)
    try:
        subprocess.run(
            [
                oxipng_executable,
                '-o', 'max',
                '-z',
                '--strip', 'safe',
                '--out', str(temp_path),
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        source_stat = path.stat()
        os.utime(temp_path, (source_stat.st_atime, source_stat.st_mtime))
        os.replace(temp_path, cache_path)
        return PreparedUpload(
            source_path=path,
            upload_path=cache_path,
            temp_path=None,
            compressed=True,
            compression_strategy=PNG_COMPRESSION_STRATEGY,
        )
    except Exception:
        cleanup_prepared_upload(PreparedUpload(source_path=path, upload_path=temp_path, temp_path=temp_path))
        raise
```

- [ ] **Step 5: Run the focused prepared-cache tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.PreparedPngCacheTests.test_prepare_upload_file_reuses_persistent_cached_png tests.test_upload_r2.PreparedPngCacheTests.test_record_prepared_png_metadata_writes_sha_and_size -v
```

Expected: both pass.

### Task 4: Batch R2 and Qiniu pending uploads with shared client/auth state

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing shared-client tests**

Add this test class in `tests/test_upload_r2.py` after the prepared-cache tests:

```python
class SharedClientBatchUploadTests(unittest.TestCase):
    def test_upload_pending_r2_files_reuses_single_client(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path_a = base_dir / 'a.jpg'
            path_b = base_dir / 'b.jpg'
            path_a.write_bytes(b'a')
            path_b.write_bytes(b'b')
            planned = [
                upload_r2.PlannedUpload(path_a, 'a.jpg', False, None),
                upload_r2.PlannedUpload(path_b, 'b.jpg', False, None),
            ]
            fake_client = object()

            with patch.object(upload_r2, 'make_r2_client', return_value=fake_client) as client_mock, \
                 patch.object(upload_r2, 'upload_to_r2', side_effect=[('uploaded', 'A'), ('uploaded', 'B')]) as upload_mock:
                results = upload_r2.upload_pending_r2_files(
                    planned,
                    base_dir=base_dir,
                    endpoint='https://example.r2.cloudflarestorage.com',
                    bucket='static-bucket',
                    prefix='gallery',
                    access_key='ak',
                    secret_key='sk',
                    region='auto',
                    proxy_url=None,
                )

        self.assertEqual([item.source_path.name for item, _ in results], ['a.jpg', 'b.jpg'])
        self.assertEqual(client_mock.call_count, 1)
        self.assertEqual(upload_mock.call_args_list[0].kwargs['client'], fake_client)
        self.assertEqual(upload_mock.call_args_list[1].kwargs['client'], fake_client)

    def test_upload_pending_qiniu_files_reuses_single_auth(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path_a = base_dir / 'a.jpg'
            path_b = base_dir / 'b.jpg'
            path_a.write_bytes(b'a')
            path_b.write_bytes(b'b')
            planned = [
                upload_r2.PlannedUpload(path_a, 'a.jpg', False, None),
                upload_r2.PlannedUpload(path_b, 'b.jpg', False, None),
            ]
            fake_auth = object()

            with patch.object(upload_r2.qiniu, 'Auth', return_value=fake_auth) as auth_mock, \
                 patch.object(upload_r2, 'upload_to_qiniu', side_effect=[('uploaded', 'A'), ('uploaded', 'B')]) as upload_mock:
                results = upload_r2.upload_pending_qiniu_files(
                    planned,
                    base_dir=base_dir,
                    bucket='qiniu-bucket',
                    prefix='gallery',
                    access_key='q-ak',
                    secret_key='q-sk',
                )

        self.assertEqual([item.source_path.name for item, _ in results], ['a.jpg', 'b.jpg'])
        self.assertEqual(auth_mock.call_count, 1)
        self.assertEqual(upload_mock.call_args_list[0].kwargs['auth'], fake_auth)
        self.assertEqual(upload_mock.call_args_list[1].kwargs['auth'], fake_auth)
```

- [ ] **Step 2: Run the focused shared-client tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.SharedClientBatchUploadTests.test_upload_pending_r2_files_reuses_single_client tests.test_upload_r2.SharedClientBatchUploadTests.test_upload_pending_qiniu_files_reuses_single_auth -v
```

Expected: failures because `upload_pending_r2_files()` and `upload_pending_qiniu_files()` do not exist and `upload_to_r2()` / `upload_to_qiniu()` do not accept shared client/auth injection.

- [ ] **Step 3: Let per-file upload helpers accept injected shared state**

Update `upload_to_r2()` and `upload_to_qiniu()` signatures in `upload_r2.py`:

```python
def upload_to_r2(
    source_path: Path,
    *,
    upload_path: Path | None = None,
    base_dir: Path,
    endpoint: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    region: str,
    dry_run: bool,
    skip_existing: bool,
    existing_keys: set[str] | None,
    proxy_url: str | None = None,
    client=None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    key = build_object_key(source_path, base_dir=base_dir, prefix=prefix)
    if dry_run:
        return 'dry-run', f'DRY-RUN {source_path.name} -> s3://{bucket}/{key}'
    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'SKIP {source_path.name} -> s3://{bucket}/{key}'
    try:
        data = upload_path.read_bytes()
        content_type = mimetypes.guess_type(source_path.name)[0] or 'application/octet-stream'
        client = client or make_r2_client(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
            proxy_url=proxy_url,
        )
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl='public, max-age=315360000, immutable',
            Metadata={'source-mtime': get_source_mtime_metadata_value(source_path)},
        )
        return 'uploaded', f'OK {source_path.name} -> s3://{bucket}/{key}'
    except Exception as exc:
        return 'failed', f'ERR {source_path.name}: {exc}'
```

```python
def upload_to_qiniu(
    source_path: Path,
    *,
    upload_path: Path | None = None,
    base_dir: Path,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    dry_run: bool,
    skip_existing: bool,
    existing_keys: set[str] | None,
    auth=None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    key = build_object_key(source_path, base_dir=base_dir, prefix=prefix)
    if dry_run:
        return 'dry-run', f'DRY-RUN {source_path.name} -> qiniu://{bucket}/{key}'
    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'SKIP {source_path.name} -> qiniu://{bucket}/{key}'
    try:
        auth = auth or qiniu.Auth(access_key, secret_key)
        token = auth.upload_token(bucket, key, 3600)
        ret, info = qiniu.put_file_v2(
            token,
            key,
            str(upload_path),
            version='v2',
            params={'x-qn-meta-source-mtime': get_source_mtime_metadata_value(source_path)},
        )
        if info is not None and info.ok():
            return 'uploaded', f'OK {source_path.name} -> qiniu://{bucket}/{key}'
        detail = getattr(info, 'text_body', None) or getattr(info, 'error', None) or str(info)
        if not detail or detail == 'None':
            detail = str(ret)
        if not detail or detail == 'None':
            detail = 'unknown qiniu upload error'
        return 'failed', f'ERR {source_path.name}: {detail}'
    except Exception as exc:
        return 'failed', f'ERR {source_path.name}: {exc}'
```

- [ ] **Step 4: Add batch executors and wire them into `run_upload()`**

Add these helpers in `upload_r2.py`:

```python
def upload_pending_r2_files(
    items: list[PlannedUpload],
    *,
    base_dir: Path,
    endpoint: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    region: str,
    proxy_url: str | None,
) -> list[tuple[PlannedUpload, tuple[str, str]]]:
    if not items:
        return []
    client = make_r2_client(
        endpoint=endpoint,
        access_key=access_key,
        secret_key=secret_key,
        region=region,
        proxy_url=proxy_url,
    )
    results = []
    for item in items:
        prepared = prepare_upload_file(item.source_path)
        try:
            result = upload_to_r2(
                item.source_path,
                upload_path=prepared.upload_path,
                base_dir=base_dir,
                endpoint=endpoint,
                bucket=bucket,
                prefix=prefix,
                access_key=access_key,
                secret_key=secret_key,
                region=region,
                dry_run=False,
                skip_existing=False,
                existing_keys=None,
                proxy_url=proxy_url,
                client=client,
            )
            results.append((item, result))
        finally:
            cleanup_prepared_upload(prepared)
    return results


def upload_pending_qiniu_files(
    items: list[PlannedUpload],
    *,
    base_dir: Path,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
) -> list[tuple[PlannedUpload, tuple[str, str]]]:
    if not items:
        return []
    auth = qiniu.Auth(access_key, secret_key)
    results = []
    for item in items:
        prepared = prepare_upload_file(item.source_path)
        try:
            result = upload_to_qiniu(
                item.source_path,
                upload_path=prepared.upload_path,
                base_dir=base_dir,
                bucket=bucket,
                prefix=prefix,
                access_key=access_key,
                secret_key=secret_key,
                dry_run=False,
                skip_existing=False,
                existing_keys=None,
                auth=auth,
            )
            results.append((item, result))
        finally:
            cleanup_prepared_upload(prepared)
    return results
```

Then call these from `run_upload()` using `pending_by_target['r2']` and `pending_by_target['qiniu']` instead of routing those targets through `upload_one()`.

- [ ] **Step 5: Run the focused shared-client tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.SharedClientBatchUploadTests.test_upload_pending_r2_files_reuses_single_client tests.test_upload_r2.SharedClientBatchUploadTests.test_upload_pending_qiniu_files_reuses_single_auth -v
```

Expected: both pass.

### Task 5: Batch Linux pending uploads over SFTP and fall back for key-based shell uploads

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing Linux batch and fallback tests**

Add this test class in `tests/test_upload_r2.py` after the shared-client tests:

```python
class LinuxBatchPendingUploadTests(unittest.TestCase):
    def test_upload_pending_linux_files_uses_single_sftp_session_for_key_auth(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path_a = base_dir / 'a.jpg'
            path_b = base_dir / 'b.jpg'
            path_a.write_bytes(b'a')
            path_b.write_bytes(b'b')
            planned = [
                upload_r2.PlannedUpload(path_a, 'a.jpg', False, None),
                upload_r2.PlannedUpload(path_b, 'b.jpg', False, None),
            ]
            client = MagicMock()
            sftp = MagicMock()

            with patch.object(upload_r2, 'open_linux_sftp_client', return_value=(client, sftp)) as open_mock, \
                 patch.object(upload_r2, 'prepare_upload_file', side_effect=lambda path: upload_r2.PreparedUpload(path, path, None, False, None)), \
                 patch.object(upload_r2, 'upload_linux_file_with_sftp', side_effect=[('uploaded', 'A'), ('uploaded', 'B')]):
                results = upload_r2.upload_pending_linux_files(
                    planned,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password=None,
                    port=22,
                    proxy_url=None,
                )

        self.assertEqual(len(results), 2)
        open_mock.assert_called_once_with(
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )

    def test_upload_pending_linux_files_falls_back_to_shell_upload_for_key_auth_when_batch_open_fails(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.jpg'
            path.write_bytes(b'jpg-bytes')
            planned = [upload_r2.PlannedUpload(path, 'image.jpg', False, None)]

            with patch.object(upload_r2, 'open_linux_sftp_client', side_effect=OSError('socket failed')), \
                 patch.object(upload_r2, 'prepare_upload_file', side_effect=lambda current_path: upload_r2.PreparedUpload(current_path, current_path, None, False, None)), \
                 patch.object(upload_r2, 'upload_to_linux', return_value=('uploaded', 'OK image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg')) as fallback_mock:
                results = upload_r2.upload_pending_linux_files(
                    planned,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password=None,
                    port=22,
                    proxy_url=None,
                )

        self.assertEqual(results[0][1], ('uploaded', 'OK image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg'))
        fallback_mock.assert_called_once()
```

- [ ] **Step 2: Run the focused Linux batch tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.LinuxBatchPendingUploadTests.test_upload_pending_linux_files_uses_single_sftp_session_for_key_auth tests.test_upload_r2.LinuxBatchPendingUploadTests.test_upload_pending_linux_files_falls_back_to_shell_upload_for_key_auth_when_batch_open_fails -v
```

Expected: failures because `upload_pending_linux_files()` does not exist yet.

- [ ] **Step 3: Generalize the Linux batch uploader to work for both password and key auth**

In `upload_r2.py`, rename the current password-only batch function into a generic batch helper with this signature:

```python
def upload_pending_linux_files(
    items: list[PlannedUpload],
    *,
    base_dir: Path,
    remote_dir: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
) -> list[tuple[PlannedUpload, tuple[str, str]]]:
    if not items:
        return []
    client, sftp = open_linux_sftp_client(
        host=host,
        user=user,
        ssh_key=ssh_key,
        password=password,
        port=port,
        proxy_url=proxy_url,
    )
    results: list[tuple[PlannedUpload, tuple[str, str]]] = []
    try:
        for item in items:
            prepared = prepare_upload_file(item.source_path)
            remote_path = build_linux_remote_path(item.source_path, base_dir=base_dir, remote_dir=remote_dir)
            try:
                result = upload_linux_file_with_sftp(
                    sftp,
                    source_path=item.source_path,
                    upload_path=prepared.upload_path,
                    remote_path=remote_path,
                    target=f'{user}@{host}',
                    skip_existing=False,
                )
                results.append((item, result))
            finally:
                cleanup_prepared_upload(prepared)
        return results
    finally:
        close_linux_sftp_session(client, sftp)
```

- [ ] **Step 4: Add key-auth fallback and verify-only-pending behavior in `run_upload()`**

Still in `upload_r2.py`, wrap Linux batch execution like this:

```python
    linux_results: list[tuple[PlannedUpload, tuple[str, str]]] = []
    if pending_by_target.get('linux'):
        try:
            linux_results = upload_pending_linux_files(
                pending_by_target['linux'],
                base_dir=folder,
                remote_dir=config.linux_dir or '',
                host=config.linux_host or '',
                user=config.linux_user or '',
                ssh_key=config.linux_key,
                password=config.linux_password,
                port=config.linux_port,
                proxy_url=config.linux_proxy,
            )
        except Exception as exc:
            if not config.linux_key or config.linux_password:
                raise
            emit_message(
                f'Linux batch SFTP unavailable, falling back to legacy shell upload: {exc}',
                log_callback,
                stream=sys.stderr,
            )
            for item in pending_by_target['linux']:
                prepared = prepare_upload_file(item.source_path)
                try:
                    result = upload_to_linux(
                        item.source_path,
                        upload_path=prepared.upload_path,
                        base_dir=folder,
                        remote_dir=config.linux_dir or '',
                        host=config.linux_host or '',
                        user=config.linux_user or '',
                        ssh_key=config.linux_key,
                        password=config.linux_password,
                        port=config.linux_port,
                        dry_run=False,
                        skip_existing=False,
                        existing_paths=None,
                        proxy_url=config.linux_proxy,
                    )
                    linux_results.append((item, result))
                finally:
                    cleanup_prepared_upload(prepared)
```

If `args.verify_remote` is true, verify only `pending_by_target['linux']` before this upload block by calling `check_linux_remote_skip_result()` per pending item and removing any verified-existing entries from the upload queue while backfilling `set_target_synced()` for those exact paths.

- [ ] **Step 5: Run the focused Linux batch tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.LinuxBatchPendingUploadTests.test_upload_pending_linux_files_uses_single_sftp_session_for_key_auth tests.test_upload_r2.LinuxBatchPendingUploadTests.test_upload_pending_linux_files_falls_back_to_shell_upload_for_key_auth_when_batch_open_fails -v
```

Expected: both pass.

### Task 6: Update result handling so each target writes independent sync state and prepared metadata

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing partial-success cache-update tests**

Add this test class in `tests/test_upload_r2.py` after the Linux batch tests:

```python
class TargetResultCacheUpdateTests(unittest.TestCase):
    def test_apply_target_result_updates_only_successful_target(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed_r2 = upload_r2.apply_target_result_to_cache(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='static-bucket|gallery/image.png',
                status='uploaded',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            changed_linux = upload_r2.apply_target_result_to_cache(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='linux',
                target_id='linux-host|/srv/gallery/image.png',
                status='failed',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

        self.assertTrue(changed_r2)
        self.assertFalse(changed_linux)
        self.assertIn('r2', cache_data['files']['image.png']['targets'])
        self.assertNotIn('linux', cache_data['files']['image.png']['targets'])
```

- [ ] **Step 2: Run the focused target-result test and verify it fails**

Run:

```bash
python -m unittest tests.test_upload_r2.TargetResultCacheUpdateTests.test_apply_target_result_updates_only_successful_target -v
```

Expected: failure because `apply_target_result_to_cache()` does not exist.

- [ ] **Step 3: Add a single target-result cache writer and use it from all batch executors**

In `upload_r2.py`, add:

```python
def apply_target_result_to_cache(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    target_label: str,
    target_id: str,
    status: str,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    if status not in {'uploaded', 'skipped'}:
        return False
    return set_target_synced(
        cache_data,
        path,
        base_dir=base_dir,
        target_label=target_label,
        target_id=target_id,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
```

Then update the result-handling part of `run_upload()` so every target result does all three actions in one place:

```python
        if item.source_path.suffix.lower() == '.png' and prepared_sha256 is not None and prepared_path is not None:
            record_prepared_png_metadata(
                cache_data,
                item.source_path,
                base_dir=folder,
                sha256=prepared_sha256,
                compression_strategy=PNG_COMPRESSION_STRATEGY,
                prepared_path=prepared_path,
            )

        cache_dirty = apply_target_result_to_cache(
            cache_data,
            item.source_path,
            base_dir=folder,
            target_label='r2',
            target_id=get_target_cache_id('r2', item.source_path, base_dir=folder, config=config),
            status=status,
            compressed=item.compressed,
            compression_strategy=item.compression_strategy,
        ) or cache_dirty
```

Apply the same pattern for Linux and Qiniu.

- [ ] **Step 4: Run the focused target-result test again and verify it passes**

Run:

```bash
python -m unittest tests.test_upload_r2.TargetResultCacheUpdateTests.test_apply_target_result_updates_only_successful_target -v
```

Expected: pass.

### Task 7: Run full verification and a smoke check for the new default path

**Files:**
- Modify: `tests/test_upload_r2.py` (no new edits expected)
- Modify: `upload_r2.py` (no new edits expected)

- [ ] **Step 1: Run the full unit test suite**

Run:

```bash
python -m unittest tests.test_upload_r2 -v
```

Expected: all tests pass.

- [ ] **Step 2: Run a dry-run smoke check for the new CLI flag and queue planning**

Run:

```bash
python upload_r2.py --env-file upload_r2.env --target both --workers 1 --verify-remote --dry-run
```

Expected: the command accepts `--verify-remote`, prints target/mode summary, and finishes without argument errors.

- [ ] **Step 3: Run one real repeated-run smoke check against your normal environment**

Run twice:

```bash
python upload_r2.py --env-file upload_r2.env --target both --workers 1
python upload_r2.py --env-file upload_r2.env --target both --workers 1
```

Expected: the second run should avoid routine R2/Linux/Qiniu existence checks for unchanged files and finish mainly with skips driven by the local sync index.

- [ ] **Step 4: Inspect the new cache structure on disk**

Open `.upload_target_cache.json` and verify it now contains a `files` object with entries shaped like:

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
        }
      }
    }
  }
}
```

- [ ] **Step 5: Check the persistent PNG prepared cache was reused**

After the repeated-run smoke check, inspect `.upload_prepared_cache/` and confirm the same cached `.png` artifact remains present across runs instead of being recreated as a temporary file.
