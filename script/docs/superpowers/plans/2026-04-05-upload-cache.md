# Upload Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local skip caches for both R2 and Linux so repeated uploads can skip known-unchanged files immediately, while preserving the current online existence-check strategy as a fallback and adding manual cache refresh.

**Architecture:** Add a small JSON-backed cache layer in `upload_r2.py` keyed by upload target plus remote destination, with local file fingerprints based on `size + mtime`. At runtime, check the local cache first, then fall back to the existing online check when the cache misses, and write back cache entries after confirmed existence or successful upload. Keep Linux behavior otherwise unchanged: no new SSH concurrency model, only cache-aware skip shortcuts.

**Tech Stack:** Python 3.13, boto3/botocore, paramiko, PySocks, json, unittest

---

## File Map

- `upload_r2.py` — modify to add cache file loading/saving, file fingerprint helpers, cache-aware skip checks for R2 and Linux, and the `--refresh-cache` CLI flag.
- `tests/test_upload_r2.py` — modify to add regression tests for cache fingerprinting, R2 cache-first skip behavior, Linux cache-first skip behavior, and manual cache refresh behavior.
- `upload_r2_gui.py` — optionally expose the refresh flag in `_build_args()` and UI if GUI parity is required in the same change.

## Notes

- The working directory is not a git repository, so use verification checkpoints instead of commits.
- The user explicitly wants cache support for **both R2 and Linux**.
- The user explicitly wants **manual refresh only** — do not add TTL or background expiration.
- Cache invalidation uses **local file size + local file mtime** only. Do not add file hashing.
- Cache should be **parallel to the current online strategy, not a replacement**. Cache miss must still fall back to live verification.
- Do **not** optimize Linux by adding new SSH concurrency or batching beyond the current connection model; the user explicitly said not to pursue that line.

## Proposed Cache Shape

Use a JSON file in the project root named `.upload_target_cache.json`:

```json
{
  "version": 1,
  "r2": {
    "static-bucket|gallery/a.png": {
      "size": 12345,
      "mtime": 1712300000.123456
    }
  },
  "linux": {
    "server.nyaneko.cn|/www/wwwroot/aigc.nyaneko.cn/storage/photos/a.png": {
      "size": 12345,
      "mtime": 1712300000.123456
    }
  }
}
```

This keeps the cache simple, target-scoped, and cheap to read/write.

### Task 1: Add cache primitives and refresh flag

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:1-120`

- [ ] **Step 1: Write the failing cache helper test**

Append this to `tests/test_upload_r2.py`:

```python
class CacheHelperTests(unittest.TestCase):
    def test_build_local_file_fingerprint_uses_size_and_mtime(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'abc')

            fingerprint = upload_r2.build_local_file_fingerprint(path)

        self.assertEqual(fingerprint['size'], 3)
        self.assertIn('mtime', fingerprint)
        self.assertIsInstance(fingerprint['mtime'], float)
```

- [ ] **Step 2: Run the test and verify it fails because the helper does not exist yet**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::CacheHelperTests::test_build_local_file_fingerprint_uses_size_and_mtime" -q
```

Expected: `AttributeError` mentioning `build_local_file_fingerprint`.

- [ ] **Step 3: Add cache constants and helper functions**

In `upload_r2.py`, add near the other small helpers:

```python
CACHE_FILE_NAME = '.upload_target_cache.json'
```

```python
def get_cache_file_path() -> Path:
    return Path(CACHE_FILE_NAME)


def build_local_file_fingerprint(path: Path) -> dict[str, float | int]:
    stat = path.stat()
    return {
        'size': stat.st_size,
        'mtime': stat.st_mtime,
    }


def load_upload_cache(path: Path) -> dict:
    if not path.exists() or not path.is_file():
        return {'version': 1, 'r2': {}, 'linux': {}}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return {'version': 1, 'r2': {}, 'linux': {}}
    if not isinstance(data, dict):
        return {'version': 1, 'r2': {}, 'linux': {}}
    return {
        'version': 1,
        'r2': data.get('r2', {}) if isinstance(data.get('r2', {}), dict) else {},
        'linux': data.get('linux', {}) if isinstance(data.get('linux', {}), dict) else {},
    }


def save_upload_cache(path: Path, cache_data: dict) -> None:
    path.write_text(json.dumps(cache_data, ensure_ascii=False, indent=2, sort_keys=True), encoding='utf-8')
```

- [ ] **Step 4: Add the CLI refresh flag**

In `main()` add:

```python
parser.add_argument('--refresh-cache', action='store_true', help='Clear the local upload cache before checking targets.')
```

- [ ] **Step 5: Run the focused test again and verify it passes**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::CacheHelperTests::test_build_local_file_fingerprint_uses_size_and_mtime" -q
```

Expected: `1 passed`.

### Task 2: Add cache-first skip behavior for R2

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:90-220`

- [ ] **Step 1: Write the failing R2 cache-hit test**

Append this to `tests/test_upload_r2.py`:

```python
class R2CacheTests(unittest.TestCase):
    def test_run_upload_skips_r2_without_online_check_when_cache_hits(self):
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / 'image.png'
            image_path.write_bytes(b'png-bytes')
            fingerprint = upload_r2.build_local_file_fingerprint(image_path)
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket='static-bucket',
                prefix='gallery',
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=False,
                target='r2',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                refresh_cache=False,
            )
            cache_data = {
                'version': 1,
                'r2': {'static-bucket|gallery/image.png': fingerprint},
                'linux': {},
            }

            def fake_env_first(*names):
                values = {
                    'CLOUDFLARE_R2_ACCESS_KEY_ID': 'ak',
                    'AWS_ACCESS_KEY_ID': 'ak',
                    'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'sk',
                    'AWS_SECRET_ACCESS_KEY': 'sk',
                }
                for name in names:
                    if name in values:
                        return values[name]
                return None

            with patch.object(upload_r2, 'load_env_file', return_value=False), \
                 patch.object(upload_r2, 'env_first', side_effect=fake_env_first), \
                 patch.object(upload_r2, 'load_upload_cache', return_value=cache_data), \
                 patch.object(upload_r2, 'save_upload_cache') as mock_save_cache, \
                 patch.object(upload_r2, 'list_existing_keys') as mock_list_existing_keys:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertFalse(mock_list_existing_keys.called)
        self.assertFalse(mock_save_cache.called)
        self.assertTrue(any(message.startswith('[R2] SKIP image.png') for message in messages))
```

- [ ] **Step 2: Run the test and verify it fails because cache logic is missing**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::R2CacheTests::test_run_upload_skips_r2_without_online_check_when_cache_hits" -q
```

Expected: `FAIL` because `list_existing_keys` is still called or because there is no cache-aware skip.

- [ ] **Step 3: Add R2 cache lookup helpers**

In `upload_r2.py`, add:

```python
def build_r2_cache_key(bucket: str, object_key: str) -> str:
    return f'{bucket}|{object_key}'


def get_cached_existing_r2_keys(
    files: list[Path],
    *,
    base_dir: Path,
    bucket: str,
    prefix: str,
    cache_data: dict,
) -> set[str]:
    cached_keys: set[str] = set()
    cache_bucket = cache_data['r2']
    normalized_prefix = prefix.strip('/')
    for path in files:
        object_key = build_object_key(path, base_dir=base_dir, prefix=normalized_prefix)
        cache_key = build_r2_cache_key(bucket, object_key)
        if cache_bucket.get(cache_key) == build_local_file_fingerprint(path):
            cached_keys.add(object_key)
    return cached_keys
```

- [ ] **Step 4: Integrate R2 cache into `run_upload()`**

Inside `run_upload(args, log_callback=None)`:

1. Load cache near the beginning:

```python
    cache_file = get_cache_file_path()
    cache_data = {'version': 1, 'r2': {}, 'linux': {}} if args.refresh_cache else load_upload_cache(cache_file)
```

2. After `files = collect_files(...)`, compute cached R2 hits when target includes R2:

```python
    cached_r2_keys: set[str] = set()
```

and after `prefix`/`bucket` resolve:

```python
    if args.target in {'r2', 'both'} and skip_existing:
        cached_r2_keys = get_cached_existing_r2_keys(
            files,
            base_dir=folder,
            bucket=bucket,
            prefix=prefix,
            cache_data=cache_data,
        )
```

3. When calling `list_existing_keys(...)`, only ask for object keys not already covered by cache:

```python
    object_keys = [
        build_object_key(path, base_dir=folder, prefix=prefix.strip('/'))
        for path in files
        if build_object_key(path, base_dir=folder, prefix=prefix.strip('/')) not in cached_r2_keys
    ]
```

4. Merge live hits with cached hits:

```python
    existing_keys = set(cached_r2_keys)
```

before extending with online results.

- [ ] **Step 5: Update the cache after confirmed R2 success or confirmed existing objects**

When `list_existing_keys(...)` returns existing keys, write matching fingerprints into `cache_data['r2']`. When `upload_to_r2()` returns `uploaded`, write the new fingerprint too. Save once at the end of `run_upload()` if cache content changed.

Use this pattern:

```python
def update_r2_cache_entry(cache_data: dict, *, bucket: str, object_key: str, path: Path) -> None:
    cache_data['r2'][build_r2_cache_key(bucket, object_key)] = build_local_file_fingerprint(path)
```

- [ ] **Step 6: Run the focused R2 cache test again and verify it passes**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::R2CacheTests::test_run_upload_skips_r2_without_online_check_when_cache_hits" -q
```

Expected: `1 passed`.

### Task 3: Add cache-first skip behavior for Linux

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:170-520`

- [ ] **Step 1: Write the failing Linux cache-hit test**

Append this to `tests/test_upload_r2.py`:

```python
class LinuxCacheTests(unittest.TestCase):
    def test_run_upload_skips_linux_without_online_check_when_cache_hits(self):
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / 'image.png'
            image_path.write_bytes(b'png-bytes')
            fingerprint = upload_r2.build_local_file_fingerprint(image_path)
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket=None,
                prefix=None,
                endpoint=None,
                region=None,
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=False,
                target='linux',
                r2_proxy=None,
                linux_host='host',
                linux_user='user',
                linux_dir='/remote',
                linux_key='id_rsa',
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                refresh_cache=False,
            )
            cache_data = {
                'version': 1,
                'r2': {},
                'linux': {'host|/remote/image.png': fingerprint},
            }

            with patch.object(upload_r2, 'load_env_file', return_value=False), \
                 patch.object(upload_r2, 'load_upload_cache', return_value=cache_data), \
                 patch.object(upload_r2, 'upload_to_linux') as mock_upload_to_linux:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertFalse(mock_upload_to_linux.called)
        self.assertTrue(any(message.startswith('[LINUX] SKIP image.png') for message in messages))
```

- [ ] **Step 2: Run the Linux cache test and verify it fails because cache logic is missing**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::LinuxCacheTests::test_run_upload_skips_linux_without_online_check_when_cache_hits" -q
```

Expected: `FAIL` because Linux still tries to call `upload_to_linux()`.

- [ ] **Step 3: Add Linux cache helpers**

In `upload_r2.py`, add:

```python
def build_linux_cache_key(host: str, remote_path: str) -> str:
    return f'{host}|{remote_path}'


def get_cached_existing_linux_paths(
    files: list[Path],
    *,
    base_dir: Path,
    remote_dir: str,
    host: str,
    cache_data: dict,
) -> set[str]:
    cached_paths: set[str] = set()
    cache_bucket = cache_data['linux']
    for path in files:
        remote_path = build_linux_remote_path(path, base_dir=base_dir, remote_dir=remote_dir)
        cache_key = build_linux_cache_key(host, remote_path)
        if cache_bucket.get(cache_key) == build_local_file_fingerprint(path):
            cached_paths.add(remote_path)
    return cached_paths
```

- [ ] **Step 4: Add Linux cache-aware short-circuiting before network upload**

The smallest safe change is to add cache-aware handling inside `upload_one(...)` before calling `upload_to_linux(...)`:

```python
    linux_cached_paths: set[str] | None,
    cache_data: dict,
    cache_changed: list[bool],
```

Extend the function signature as needed so `upload_one(...)` can:
- compute `remote_path`
- if `skip_existing` and `remote_path in linux_cached_paths`, return

```python
('skipped', f'SKIP {path.name} -> {linux_user}@{linux_host}:{remote_path}')
```

without calling `upload_to_linux(...)`.

- [ ] **Step 5: Write back Linux cache entries after confirmed success**

When Linux upload returns `uploaded`, record:

```python
def update_linux_cache_entry(cache_data: dict, *, host: str, remote_path: str, path: Path) -> None:
    cache_data['linux'][build_linux_cache_key(host, remote_path)] = build_local_file_fingerprint(path)
```

Save the cache once at the end of `run_upload()` if any R2 or Linux cache entry changed.

- [ ] **Step 6: Run the focused Linux cache test again and verify it passes**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::LinuxCacheTests::test_run_upload_skips_linux_without_online_check_when_cache_hits" -q
```

Expected: `1 passed`.

### Task 4: Add manual cache refresh and verify end-to-end behavior

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`
- Modify: `upload_r2_gui.py` (only if GUI parity is desired now)

- [ ] **Step 1: Write the failing refresh test**

Append this to `tests/test_upload_r2.py`:

```python
class CacheRefreshTests(unittest.TestCase):
    def test_run_upload_ignores_existing_cache_when_refresh_cache_is_true(self):
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / 'image.png'
            image_path.write_bytes(b'png-bytes')
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket='static-bucket',
                prefix='gallery',
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=False,
                target='r2',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                refresh_cache=True,
            )
            cache_data = {
                'version': 1,
                'r2': {'static-bucket|gallery/image.png': {'size': 999, 'mtime': 1.0}},
                'linux': {},
            }

            def fake_env_first(*names):
                values = {
                    'CLOUDFLARE_R2_ACCESS_KEY_ID': 'ak',
                    'AWS_ACCESS_KEY_ID': 'ak',
                    'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'sk',
                    'AWS_SECRET_ACCESS_KEY': 'sk',
                }
                for name in names:
                    if name in values:
                        return values[name]
                return None

            with patch.object(upload_r2, 'load_env_file', return_value=False), \
                 patch.object(upload_r2, 'env_first', side_effect=fake_env_first), \
                 patch.object(upload_r2, 'load_upload_cache', return_value=cache_data), \
                 patch.object(upload_r2, 'list_existing_keys', return_value=(set(), None)) as mock_list_existing_keys, \
                 patch.object(upload_r2, 'upload_one', return_value=[('uploaded', 'OK image.png -> s3://static-bucket/gallery/image.png')]):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertTrue(mock_list_existing_keys.called)
```

- [ ] **Step 2: Run the refresh test and verify it fails before implementation**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py::CacheRefreshTests::test_run_upload_ignores_existing_cache_when_refresh_cache_is_true" -q
```

Expected: `FAIL` because the existing cache still short-circuits the online path.

- [ ] **Step 3: Implement manual refresh behavior**

Inside `run_upload(...)`, make `args.refresh_cache` bypass previously stored cache content entirely:

```python
    cache_data = {'version': 1, 'r2': {}, 'linux': {}} if args.refresh_cache else load_upload_cache(cache_file)
```

Do not delete the file eagerly; just rebuild the in-memory cache and overwrite it when the run finishes.

- [ ] **Step 4: If GUI parity is in scope, add the refresh flag to the GUI**

If you decide to keep CLI and GUI aligned in the same change, add to `upload_r2_gui.py`:

```python
self.refresh_cache_checkbox = QCheckBox('刷新本地缓存')
```

and in `_build_args()`:

```python
refresh_cache=self.refresh_cache_checkbox.isChecked(),
```

If GUI parity is not part of this change, explicitly leave `upload_r2_gui.py` untouched.

- [ ] **Step 5: Run the full test file and verify all cache tests pass**

Run:

```bash
python -m pytest "C:/Users/gekdanhs/Pictures/AIGCC/tests/test_upload_r2.py" -q
```

Expected: all tests pass.

- [ ] **Step 6: Run a CLI smoke test covering the new flag**

Run:

```bash
python upload_r2.py --target r2 --dry-run --workers 1 --refresh-cache --dir .
```

Expected: the script starts normally, does not crash on the new flag, and prints the usual dry-run summary.
