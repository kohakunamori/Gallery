# upload_r2.py Qiniu + PNG Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `upload_r2.py` so the CLI can upload to Qiniu, preprocess PNG files with `oxipng -o max -z --strip safe`, and reuse the same prepared file across R2, Linux, and Qiniu uploads while preserving the current GUI scope.

**Architecture:** Keep destination-specific upload functions focused on one remote target, but separate the concept of the source file path from the actual bytes-upload path so a temporary compressed PNG can be reused safely. Upgrade the cache schema to be compression-aware, add a Qiniu destination using the official SDK, and normalize target routing so `both` becomes an alias for `all` without duplicating orchestration logic.

**Tech Stack:** Python 3.13, boto3/botocore, paramiko, PySocks, qiniu Python SDK, oxipng CLI, unittest

---

## File Map

- `upload_r2.py` — extend imports/constants/cache helpers; add compression-aware fingerprinting, PNG preparation helpers, Qiniu existence/upload helpers, target normalization, and the `all` orchestration path.
- `requirements.txt` — add the `qiniu` runtime dependency while preserving existing packages.
- `tests/test_upload_r2.py` — add regression tests for cache schema changes, PNG preprocessing, Qiniu upload/existence checks, target normalization, and multi-target dispatch.

## Notes

- The current working directory is **not** a git repository, so use verification checkpoints instead of commit steps.
- Scope is **CLI only**. Do **not** modify `upload_r2_gui.py`.
- Use the official Qiniu SDK calls `Auth`, `upload_token`, `put_file_v2`, and `BucketManager.stat`.
- Treat Qiniu `info.status_code == 612` as “object not found”.
- Use `oxipng -o max -z --strip safe --out <tmp> <src>` and do **not** use `--alpha`.
- `both` must remain accepted on the CLI, but it should internally normalize to `all`.
- For `all` mode, do **not** use the current Linux password batch shortcut because it bypasses per-file PNG preparation and would break the “compress once, upload to all three targets” requirement.

### Task 1: Upgrade dependencies, cache schema, and target normalization

**Files:**
- Modify: `requirements.txt:1-4`
- Modify: `upload_r2.py:17-118`
- Modify: `tests/test_upload_r2.py:11-350`

- [ ] **Step 1: Write the failing cache and target normalization tests**

Add these tests near the existing cache helper tests in `tests/test_upload_r2.py`:

```python
class CacheHelperTests(unittest.TestCase):
    def test_build_local_file_fingerprint_marks_png_as_compressed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'abc')

            fingerprint = upload_r2.build_local_file_fingerprint(path)

        self.assertEqual(fingerprint['size'], 3)
        self.assertIn('mtime', fingerprint)
        self.assertTrue(fingerprint['compressed'])
        self.assertEqual(fingerprint['compression_strategy'], upload_r2.PNG_COMPRESSION_STRATEGY)

    def test_build_local_file_fingerprint_marks_non_png_as_uncompressed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.jpg'
            path.write_bytes(b'abc')

            fingerprint = upload_r2.build_local_file_fingerprint(path)

        self.assertFalse(fingerprint['compressed'])
        self.assertIsNone(fingerprint['compression_strategy'])

    def test_load_upload_cache_adds_qiniu_bucket_for_legacy_cache(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_file = Path(tmpdir) / upload_r2.CACHE_FILE_NAME
            cache_file.write_text('{"version": 1, "r2": {}, "linux": {}}', encoding='utf-8')

            cache_data = upload_r2.load_upload_cache(cache_file)

        self.assertEqual(
            cache_data,
            {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'r2': {},
                'linux': {},
                'qiniu': {},
            },
        )


class TargetNormalizationTests(unittest.TestCase):
    def test_normalize_target_maps_both_to_all(self):
        self.assertEqual(upload_r2.normalize_target('both'), 'all')
        self.assertEqual(upload_r2.normalize_target('all'), 'all')
        self.assertEqual(upload_r2.normalize_target('qiniu'), 'qiniu')
```

- [ ] **Step 2: Run the targeted tests and verify they fail for the right reason**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheHelperTests tests.test_upload_r2.TargetNormalizationTests -v
```

Expected:
- `ERROR` or `FAIL` because `PNG_COMPRESSION_STRATEGY` and `normalize_target()` do not exist yet.
- The fingerprint tests should also fail because `build_local_file_fingerprint()` does not yet return `compressed` and `compression_strategy`.

- [ ] **Step 3: Update the runtime dependency list**

Replace `requirements.txt` with:

```txt
boto3
paramiko
PySide6
PySocks
qiniu
```

- [ ] **Step 4: Install dependencies into the active environment**

Run:

```bash
python -m pip install -r requirements.txt
```

Expected: pip reports `Successfully installed qiniu ...` or `Requirement already satisfied` for all packages.

- [ ] **Step 5: Implement the cache schema upgrade and target normalization helpers**

Update the constants and cache helpers near the top of `upload_r2.py`:

```python
CACHE_SCHEMA_VERSION = 2
PNG_COMPRESSION_STRATEGY = 'oxipng:o_max:z:strip_safe'
```

```python
def normalize_target(target: str) -> str:
    return 'all' if target == 'both' else target
```

```python
def build_local_file_fingerprint(path: Path) -> dict[str, float | int | bool | str | None]:
    stat = path.stat()
    is_png = path.suffix.lower() == '.png'
    return {
        'size': stat.st_size,
        'mtime': stat.st_mtime,
        'compressed': is_png,
        'compression_strategy': PNG_COMPRESSION_STRATEGY if is_png else None,
    }
```

Add the Qiniu cache key helper next to the existing R2/Linux helpers:

```python
def build_qiniu_cache_key(bucket: str, object_key: str) -> str:
    return f'{bucket}|{object_key}'
```

Then upgrade `load_upload_cache()` to always return the new schema:

```python
def load_upload_cache(path: Path) -> dict:
    empty_cache = {
        'version': CACHE_SCHEMA_VERSION,
        'r2': {},
        'linux': {},
        'qiniu': {},
    }
    if not path.exists() or not path.is_file():
        return empty_cache
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return empty_cache
    if not isinstance(data, dict):
        return empty_cache
    return {
        'version': CACHE_SCHEMA_VERSION,
        'r2': data.get('r2', {}) if isinstance(data.get('r2', {}), dict) else {},
        'linux': data.get('linux', {}) if isinstance(data.get('linux', {}), dict) else {},
        'qiniu': data.get('qiniu', {}) if isinstance(data.get('qiniu', {}), dict) else {},
    }
```

Also update every in-file empty-cache literal from:

```python
{'version': 1, 'r2': {}, 'linux': {}}
```

to:

```python
{'version': CACHE_SCHEMA_VERSION, 'r2': {}, 'linux': {}, 'qiniu': {}}
```

- [ ] **Step 6: Run the targeted tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheHelperTests tests.test_upload_r2.TargetNormalizationTests -v
```

Expected: all tests from these two classes report `ok`.

### Task 2: Add the PNG preparation layer and separate source path from upload path

**Files:**
- Modify: `upload_r2.py:1-479`
- Modify: `tests/test_upload_r2.py:503-707`

- [ ] **Step 1: Write the failing PNG preparation and path-separation tests**

Append these tests after the existing R2 upload tests in `tests/test_upload_r2.py`:

```python
class PrepareUploadFileTests(unittest.TestCase):
    def test_prepare_upload_file_returns_original_path_for_non_png(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.jpg'
            path.write_bytes(b'jpg-bytes')

            prepared = upload_r2.prepare_upload_file(path)

        self.assertEqual(prepared.source_path, path)
        self.assertEqual(prepared.upload_path, path)
        self.assertFalse(prepared.compressed)
        self.assertIsNone(prepared.temp_path)
        self.assertIsNone(prepared.compression_strategy)

    def test_prepare_upload_file_runs_oxipng_and_cleans_up_temp_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'original-png-bytes')

            def fake_run(cmd, check, capture_output, text):
                out_path = Path(cmd[cmd.index('--out') + 1])
                out_path.write_bytes(b'compressed-png-bytes')

            with patch.object(upload_r2.shutil, 'which', return_value='oxipng'), \
                 patch.object(upload_r2.subprocess, 'run', side_effect=fake_run) as mock_run:
                prepared = upload_r2.prepare_upload_file(path)

            self.assertTrue(prepared.compressed)
            self.assertEqual(prepared.source_path, path)
            self.assertEqual(prepared.upload_path.read_bytes(), b'compressed-png-bytes')
            self.assertEqual(prepared.compression_strategy, upload_r2.PNG_COMPRESSION_STRATEGY)
            self.assertIn('-z', mock_run.call_args.args[0])
            self.assertIn('--strip', mock_run.call_args.args[0])

            upload_r2.cleanup_prepared_upload(prepared)
            self.assertFalse(prepared.upload_path.exists())


class UploadPathSeparationTests(unittest.TestCase):
    def test_upload_to_r2_uses_source_path_for_key_and_upload_path_for_body(self):
        class FakePutClient:
            def __init__(self):
                self.calls = []

            def put_object(self, **kwargs):
                self.calls.append(kwargs)
                return {'ETag': '"etag"'}

        fake_client = FakePutClient()

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            nested_dir = base_dir / 'nested'
            nested_dir.mkdir()
            source_path = nested_dir / 'image.png'
            source_path.write_bytes(b'original')
            upload_path = base_dir / 'compressed.png'
            upload_path.write_bytes(b'compressed')

            with patch.object(upload_r2, 'make_r2_client', return_value=fake_client):
                status, message = upload_r2.upload_to_r2(
                    source_path,
                    upload_path=upload_path,
                    base_dir=base_dir,
                    endpoint='https://example.r2.cloudflarestorage.com',
                    bucket='static-bucket',
                    prefix='gallery',
                    access_key='ak',
                    secret_key='sk',
                    region='auto',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                )

        self.assertEqual(status, 'uploaded')
        self.assertEqual(message, 'OK image.png -> s3://static-bucket/gallery/nested/image.png')
        self.assertEqual(fake_client.calls[0]['Key'], 'gallery/nested/image.png')
        self.assertEqual(fake_client.calls[0]['Body'], b'compressed')
```

- [ ] **Step 2: Run the targeted tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.PrepareUploadFileTests tests.test_upload_r2.UploadPathSeparationTests -v
```

Expected:
- `ERROR` because `prepare_upload_file()` and `cleanup_prepared_upload()` do not exist yet.
- `ERROR` because `upload_to_r2()` does not yet accept `upload_path=`.

- [ ] **Step 3: Implement the preparation model and update the R2/Linux upload signatures**

Add the needed imports near the top of `upload_r2.py`:

```python
from dataclasses import dataclass
import shutil
import tempfile
```

Add the prepared upload model and helper functions above `upload_to_r2()`:

```python
@dataclass
class PreparedUpload:
    source_path: Path
    upload_path: Path
    compressed: bool
    compression_strategy: str | None
    temp_path: Path | None = None


def prepare_upload_file(path: Path) -> PreparedUpload:
    if path.suffix.lower() != '.png':
        return PreparedUpload(
            source_path=path,
            upload_path=path,
            compressed=False,
            compression_strategy=None,
            temp_path=None,
        )

    oxipng_bin = shutil.which('oxipng')
    if not oxipng_bin:
        raise RuntimeError('oxipng not found in PATH')

    tmp_file = tempfile.NamedTemporaryFile(prefix='upload-r2-', suffix='.png', delete=False)
    tmp_path = Path(tmp_file.name)
    tmp_file.close()

    try:
        subprocess.run(
            [
                oxipng_bin,
                '-o', 'max',
                '-z',
                '--strip', 'safe',
                '--out', str(tmp_path),
                str(path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        if not tmp_path.exists() or tmp_path.stat().st_size == 0:
            raise RuntimeError('oxipng did not produce an output file')
        return PreparedUpload(
            source_path=path,
            upload_path=tmp_path,
            compressed=True,
            compression_strategy=PNG_COMPRESSION_STRATEGY,
            temp_path=tmp_path,
        )
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def cleanup_prepared_upload(prepared: PreparedUpload) -> None:
    if prepared.temp_path is not None:
        prepared.temp_path.unlink(missing_ok=True)
```

Update `upload_to_r2()` so it computes object keys and messages from the source path, but reads bytes from the actual upload path:

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
        client = make_r2_client(
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
        )
        return 'uploaded', f'OK {source_path.name} -> s3://{bucket}/{key}'
    except Exception as exc:
        return 'failed', f'ERR {source_path.name}: {exc}'
```

Make the same source-path/upload-path split in `upload_to_linux()`:

```python
def upload_to_linux(
    source_path: Path,
    *,
    upload_path: Path | None = None,
    base_dir: Path,
    remote_dir: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    dry_run: bool,
    skip_existing: bool,
    proxy_url: str | None = None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    remote_path = build_linux_remote_path(source_path, base_dir=base_dir, remote_dir=remote_dir)
    target = f'{user}@{host}'

    if dry_run:
        return 'dry-run', f'DRY-RUN {source_path.name} -> {target}:{remote_path}'

    # ... keep the existing logic, but replace every str(path) with str(upload_path)
    # and every path.name in messages with source_path.name
```

Also update `upload_files_to_linux_via_password()` messages to use the original source path names consistently if you touch it in later tasks.

- [ ] **Step 4: Run the targeted tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.PrepareUploadFileTests tests.test_upload_r2.UploadPathSeparationTests -v
```

Expected: all tests from these two classes report `ok`.

### Task 3: Add the Qiniu existence check and upload path

**Files:**
- Modify: `upload_r2.py:1-360`
- Modify: `tests/test_upload_r2.py:575-760`

- [ ] **Step 1: Write the failing Qiniu tests**

Append these tests after the existing Linux upload tests in `tests/test_upload_r2.py`:

```python
class QiniuUploadTests(unittest.TestCase):
    def test_list_existing_qiniu_keys_handles_612_as_missing(self):
        calls = []

        class FakeInfo:
            def __init__(self, status_code):
                self.status_code = status_code

            def __str__(self):
                return f'status={self.status_code}'

        class FakeAuth:
            def __init__(self, access_key, secret_key):
                self.access_key = access_key
                self.secret_key = secret_key

        class FakeBucketManager:
            def stat(self, bucket, key):
                calls.append((bucket, key))
                if key == 'gallery/existing.png':
                    return {'hash': 'etag'}, FakeInfo(200)
                return None, FakeInfo(612)

        class FakeQiniuModule:
            Auth = FakeAuth

            @staticmethod
            def BucketManager(auth):
                return FakeBucketManager()

        with patch.object(upload_r2, 'qiniu', FakeQiniuModule(), create=True):
            keys, error = upload_r2.list_existing_qiniu_keys(
                bucket='qiniu-bucket',
                object_keys=['gallery/existing.png', 'gallery/missing.png'],
                access_key='qak',
                secret_key='qsk',
            )

        self.assertIsNone(error)
        self.assertEqual(keys, {'gallery/existing.png'})
        self.assertEqual(
            calls,
            [
                ('qiniu-bucket', 'gallery/existing.png'),
                ('qiniu-bucket', 'gallery/missing.png'),
            ],
        )

    def test_upload_to_qiniu_uses_put_file_v2(self):
        calls = []

        class FakeInfo:
            status_code = 200

            def __str__(self):
                return 'ok'

        class FakeAuth:
            def __init__(self, access_key, secret_key):
                self.access_key = access_key
                self.secret_key = secret_key

            def upload_token(self, bucket, key, expires):
                calls.append(('upload_token', bucket, key, expires))
                return 'token-123'

        class FakeQiniuModule:
            Auth = FakeAuth

            @staticmethod
            def put_file_v2(token, key, localfile, version='v2'):
                calls.append(('put_file_v2', token, key, localfile, version))
                return {'key': key, 'hash': 'etag'}, FakeInfo()

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2, 'qiniu', FakeQiniuModule(), create=True):
                status, message = upload_r2.upload_to_qiniu(
                    image_path,
                    base_dir=base_dir,
                    bucket='qiniu-bucket',
                    prefix='gallery',
                    access_key='qak',
                    secret_key='qsk',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                )

        self.assertEqual(status, 'uploaded')
        self.assertEqual(message, 'OK image.png -> qiniu://qiniu-bucket/gallery/image.png')
        self.assertEqual(
            calls,
            [
                ('upload_token', 'qiniu-bucket', 'gallery/image.png', 3600),
                ('put_file_v2', 'token-123', 'gallery/image.png', str(image_path), 'v2'),
            ],
        )
```

- [ ] **Step 2: Run the Qiniu tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.QiniuUploadTests -v
```

Expected: `ERROR` because `list_existing_qiniu_keys()` and `upload_to_qiniu()` do not exist yet.

- [ ] **Step 3: Implement the Qiniu helpers and upload function**

Add the import near the top of `upload_r2.py`:

```python
import qiniu
```

Add the Qiniu existence helper after the R2 listing helper:

```python
def list_existing_qiniu_keys(
    *,
    bucket: str,
    object_keys: list[str],
    access_key: str,
    secret_key: str,
) -> tuple[set[str], str | None]:
    existing_keys: set[str] = set()
    try:
        auth = qiniu.Auth(access_key, secret_key)
        bucket_manager = qiniu.BucketManager(auth)
        for object_key in object_keys:
            ret, info = bucket_manager.stat(bucket, object_key)
            if ret and 'hash' in ret:
                existing_keys.add(object_key)
                continue
            if getattr(info, 'status_code', None) == 612:
                continue
            return existing_keys, str(info)
        return existing_keys, None
    except Exception as exc:
        return existing_keys, str(exc)
```

Add the Qiniu upload function next to `upload_to_r2()` and `upload_to_linux()`:

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
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    key = build_object_key(source_path, base_dir=base_dir, prefix=prefix)

    if dry_run:
        return 'dry-run', f'DRY-RUN {source_path.name} -> qiniu://{bucket}/{key}'

    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'SKIP {source_path.name} -> qiniu://{bucket}/{key}'

    try:
        auth = qiniu.Auth(access_key, secret_key)
        token = auth.upload_token(bucket, key, 3600)
        ret, info = qiniu.put_file_v2(token, key, str(upload_path), version='v2')
        if ret is None or ret.get('key') != key:
            detail = getattr(info, 'text_body', None) or str(info)
            return 'failed', f'ERR {source_path.name}: {detail}'
        return 'uploaded', f'OK {source_path.name} -> qiniu://{bucket}/{key}'
    except Exception as exc:
        return 'failed', f'ERR {source_path.name}: {exc}'
```

Add the Qiniu cache helpers next to the existing R2/Linux cache functions:

```python
def get_cached_existing_qiniu_keys(
    files: list[Path],
    *,
    base_dir: Path,
    bucket: str,
    prefix: str,
    cache_data: dict,
) -> set[str]:
    cached_existing_keys: set[str] = set()
    qiniu_cache = cache_data.get('qiniu', {}) if isinstance(cache_data.get('qiniu', {}), dict) else {}
    for path in files:
        object_key = build_object_key(path, base_dir=base_dir, prefix=prefix)
        cache_key = build_qiniu_cache_key(bucket, object_key)
        if qiniu_cache.get(cache_key) == build_local_file_fingerprint(path):
            cached_existing_keys.add(object_key)
    return cached_existing_keys


def update_qiniu_cache_entry(cache_data: dict, *, bucket: str, object_key: str, path: Path) -> bool:
    cache_key = build_qiniu_cache_key(bucket, object_key)
    fingerprint = build_local_file_fingerprint(path)
    qiniu_cache = cache_data.setdefault('qiniu', {})
    if qiniu_cache.get(cache_key) == fingerprint:
        return False
    qiniu_cache[cache_key] = fingerprint
    return True
```

- [ ] **Step 4: Run the Qiniu tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.QiniuUploadTests -v
```

Expected: both Qiniu tests report `ok`.

### Task 4: Refactor `upload_one()` and `run_upload()` for `qiniu` / `all` / `both`

**Files:**
- Modify: `upload_r2.py:541-908`
- Modify: `tests/test_upload_r2.py:709-967`

- [ ] **Step 1: Write the failing orchestration tests**

Append these tests near the existing `RunUploadTests` section in `tests/test_upload_r2.py`:

```python
class UploadOneTests(unittest.TestCase):
    def test_upload_one_uses_one_prepared_upload_for_all_targets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')
            compressed_path = base_dir / 'compressed.png'
            compressed_path.write_bytes(b'compressed')
            prepared = upload_r2.PreparedUpload(
                source_path=image_path,
                upload_path=compressed_path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                temp_path=compressed_path,
            )

            with patch.object(upload_r2, 'prepare_upload_file', return_value=prepared), \
                 patch.object(upload_r2, 'cleanup_prepared_upload') as mock_cleanup, \
                 patch.object(upload_r2, 'upload_to_r2', return_value=('uploaded', 'OK image.png -> s3://r2-bucket/gallery/image.png')) as mock_r2, \
                 patch.object(upload_r2, 'upload_to_linux', return_value=('uploaded', 'OK image.png -> user@host:/remote/image.png')) as mock_linux, \
                 patch.object(upload_r2, 'upload_to_qiniu', return_value=('uploaded', 'OK image.png -> qiniu://qiniu-bucket/gallery/image.png')) as mock_qiniu:
                results = upload_r2.upload_one(
                    image_path,
                    base_dir=base_dir,
                    target='all',
                    endpoint='https://example.r2.cloudflarestorage.com',
                    bucket='r2-bucket',
                    prefix='gallery',
                    access_key='ak',
                    secret_key='sk',
                    region='auto',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                    r2_proxy=None,
                    linux_host='host',
                    linux_user='user',
                    linux_dir='/remote',
                    linux_key='id_rsa',
                    linux_password=None,
                    linux_port=22,
                    linux_proxy=None,
                    qiniu_bucket='qiniu-bucket',
                    qiniu_prefix='gallery',
                    qiniu_access_key='qak',
                    qiniu_secret_key='qsk',
                    qiniu_existing_keys=None,
                )

        self.assertEqual([status for status, _ in results], ['uploaded', 'uploaded', 'uploaded'])
        self.assertEqual(mock_r2.call_args.kwargs['upload_path'], compressed_path)
        self.assertEqual(mock_linux.call_args.kwargs['upload_path'], compressed_path)
        self.assertEqual(mock_qiniu.call_args.kwargs['upload_path'], compressed_path)
        mock_cleanup.assert_called_once_with(prepared)

    def test_upload_one_skips_prepare_upload_file_in_dry_run(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2, 'prepare_upload_file') as mock_prepare, \
                 patch.object(upload_r2, 'upload_to_qiniu', return_value=('dry-run', 'DRY-RUN image.png -> qiniu://qiniu-bucket/gallery/image.png')):
                results = upload_r2.upload_one(
                    image_path,
                    base_dir=base_dir,
                    target='qiniu',
                    endpoint='https://example.r2.cloudflarestorage.com',
                    bucket='r2-bucket',
                    prefix='gallery',
                    access_key='ak',
                    secret_key='sk',
                    region='auto',
                    dry_run=True,
                    skip_existing=False,
                    existing_keys=None,
                    r2_proxy=None,
                    linux_host=None,
                    linux_user=None,
                    linux_dir=None,
                    linux_key=None,
                    linux_password=None,
                    linux_port=22,
                    linux_proxy=None,
                    qiniu_bucket='qiniu-bucket',
                    qiniu_prefix='gallery',
                    qiniu_access_key='qak',
                    qiniu_secret_key='qsk',
                    qiniu_existing_keys=None,
                )

        self.assertFalse(mock_prepare.called)
        self.assertEqual(results, [('dry-run', 'DRY-RUN image.png -> qiniu://qiniu-bucket/gallery/image.png')])


class QiniuCacheTests(unittest.TestCase):
    def test_run_upload_skips_qiniu_without_online_check_when_cache_hits(self):
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / 'image.png'
            image_path.write_bytes(b'png-bytes')
            fingerprint = upload_r2.build_local_file_fingerprint(image_path)
            messages = []
            args = Namespace(
                dir=tmpdir,
                bucket='r2-bucket',
                prefix='gallery',
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                env_file=None,
                recursive=False,
                workers=1,
                no_skip_existing=False,
                dry_run=False,
                target='qiniu',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
                refresh_cache=False,
            )
            cache_data = {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'r2': {},
                'linux': {},
                'qiniu': {'qiniu-bucket|gallery/image.png': fingerprint},
            }

            def fake_env_first(*names):
                values = {
                    'QINIU_ACCESS_KEY': 'qak',
                    'QINIU_SECRET_KEY': 'qsk',
                }
                for name in names:
                    if name in values:
                        return values[name]
                return None

            with patch.object(upload_r2, 'load_env_file', return_value=False), \
                 patch.object(upload_r2, 'env_first', side_effect=fake_env_first), \
                 patch.object(upload_r2, 'load_upload_cache', return_value=cache_data), \
                 patch.object(upload_r2, 'save_upload_cache') as mock_save_cache, \
                 patch.object(upload_r2, 'list_existing_qiniu_keys') as mock_list_existing_qiniu_keys:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(exit_code, 0)
        self.assertFalse(mock_list_existing_qiniu_keys.called)
        self.assertFalse(mock_save_cache.called)
        self.assertTrue(any(message.startswith('[QINIU] SKIP image.png') for message in messages))
```

Update the parser coverage test to accept the new CLI options:

```python
    def test_main_accepts_qiniu_target_and_bucket(self):
        with TemporaryDirectory() as tmpdir:
            with patch.object(upload_r2, 'run_upload', return_value=0) as mock_run_upload:
                exit_code = upload_r2.main([
                    '--dir', tmpdir,
                    '--target', 'qiniu',
                    '--dry-run',
                    '--qiniu-bucket', 'qiniu-bucket',
                ])

        self.assertEqual(exit_code, 0)
        args = mock_run_upload.call_args.args[0]
        self.assertEqual(args.target, 'qiniu')
        self.assertEqual(args.qiniu_bucket, 'qiniu-bucket')
```

- [ ] **Step 2: Run the orchestration tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadOneTests tests.test_upload_r2.QiniuCacheTests tests.test_upload_r2.RunUploadTests -v
```

Expected:
- `ERROR` because `upload_one()` does not yet accept the Qiniu arguments.
- `FAIL` because `run_upload()` does not yet understand `target='qiniu'` or Qiniu cache fields.
- `argparse` may also reject `--qiniu-bucket` until the parser is updated.

- [ ] **Step 3: Refactor the target orchestration and wire Qiniu into `run_upload()`**

Add a helper to define the ordered labels for each target mode:

```python
def targets_for_mode(target: str) -> tuple[str, ...]:
    normalized = normalize_target(target)
    mapping = {
        'r2': ('r2',),
        'linux': ('linux',),
        'qiniu': ('qiniu',),
        'all': ('r2', 'linux', 'qiniu'),
    }
    return mapping[normalized]
```

Refactor `upload_one()` to prepare PNGs once per file and to dispatch using the same prepared upload path:

```python
def upload_one(
    path: Path,
    *,
    base_dir: Path,
    target: str,
    endpoint: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    region: str,
    dry_run: bool,
    skip_existing: bool,
    existing_keys: set[str] | None,
    r2_proxy: str | None,
    linux_host: str | None,
    linux_user: str | None,
    linux_dir: str | None,
    linux_key: str | None,
    linux_password: str | None,
    linux_port: int,
    linux_proxy: str | None,
    qiniu_bucket: str | None,
    qiniu_prefix: str | None,
    qiniu_access_key: str | None,
    qiniu_secret_key: str | None,
    qiniu_existing_keys: set[str] | None,
) -> list[tuple[str, str]]:
    normalized_target = normalize_target(target)
    results: list[tuple[str, str]] = []

    if dry_run:
        prepared = PreparedUpload(
            source_path=path,
            upload_path=path,
            compressed=False,
            compression_strategy=None,
            temp_path=None,
        )
    else:
        try:
            prepared = prepare_upload_file(path)
        except Exception as exc:
            return [('failed', f'ERR {path.name}: {exc}')]

    try:
        if normalized_target in {'r2', 'all'}:
            results.append(
                upload_to_r2(
                    path,
                    upload_path=prepared.upload_path,
                    base_dir=base_dir,
                    endpoint=endpoint,
                    bucket=bucket,
                    prefix=prefix,
                    access_key=access_key,
                    secret_key=secret_key,
                    region=region,
                    dry_run=dry_run,
                    skip_existing=skip_existing,
                    existing_keys=existing_keys,
                    proxy_url=r2_proxy,
                )
            )
        if normalized_target in {'linux', 'all'}:
            results.append(
                upload_to_linux(
                    path,
                    upload_path=prepared.upload_path,
                    base_dir=base_dir,
                    remote_dir=linux_dir or '',
                    host=linux_host or '',
                    user=linux_user or '',
                    ssh_key=linux_key,
                    password=linux_password,
                    port=linux_port,
                    dry_run=dry_run,
                    skip_existing=skip_existing,
                    proxy_url=linux_proxy,
                )
            )
        if normalized_target in {'qiniu', 'all'}:
            results.append(
                upload_to_qiniu(
                    path,
                    upload_path=prepared.upload_path,
                    base_dir=base_dir,
                    bucket=qiniu_bucket or '',
                    prefix=qiniu_prefix or '',
                    access_key=qiniu_access_key or '',
                    secret_key=qiniu_secret_key or '',
                    dry_run=dry_run,
                    skip_existing=skip_existing,
                    existing_keys=qiniu_existing_keys,
                )
            )
        return results
    finally:
        if not dry_run:
            cleanup_prepared_upload(prepared)
```

Update the top of `run_upload()` to normalize the target and load Qiniu configuration:

```python
normalized_target = normalize_target(args.target)
qiniu_bucket = args.qiniu_bucket or env_first('QINIU_BUCKET') or bucket
qiniu_prefix = args.qiniu_prefix if args.qiniu_prefix is not None else (env_first('QINIU_PREFIX') or prefix)
normalized_qiniu_prefix = qiniu_prefix.strip('/')
qiniu_access_key = env_first('QINIU_ACCESS_KEY')
qiniu_secret_key = env_first('QINIU_SECRET_KEY')
```

Add Qiniu validation next to the existing R2/Linux validation:

```python
if normalized_target in {'qiniu', 'all'}:
    if not args.dry_run and not qiniu_bucket:
        emit_message('Missing Qiniu bucket. Set --qiniu-bucket or QINIU_BUCKET.', log_callback, stream=sys.stderr)
        return 2
    if not args.dry_run and (not qiniu_access_key or not qiniu_secret_key):
        emit_message('Missing Qiniu credentials. Set QINIU_ACCESS_KEY and QINIU_SECRET_KEY.', log_callback, stream=sys.stderr)
        return 2
```

Load Qiniu existing keys with the local cache before falling back to `BucketManager.stat`:

```python
qiniu_existing_keys: set[str] | None = None
qiniu_object_keys = [
    build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix)
    for path in files
] if normalized_target in {'qiniu', 'all'} else None

if normalized_target in {'qiniu', 'all'} and skip_existing and not args.dry_run:
    cached_qiniu_keys = get_cached_existing_qiniu_keys(
        files,
        base_dir=folder,
        bucket=qiniu_bucket,
        prefix=normalized_qiniu_prefix,
        cache_data=cache_data,
    )
    qiniu_existing_keys = set(cached_qiniu_keys)
    uncached_qiniu_object_keys = [
        object_key for object_key in qiniu_object_keys or []
        if object_key not in cached_qiniu_keys
    ]
    if uncached_qiniu_object_keys:
        online_qiniu_keys, qiniu_error = list_existing_qiniu_keys(
            bucket=qiniu_bucket,
            object_keys=uncached_qiniu_object_keys,
            access_key=qiniu_access_key or '',
            secret_key=qiniu_secret_key or '',
        )
        if qiniu_error:
            emit_message(f'Failed to check existing Qiniu objects: {qiniu_error}', log_callback, stream=sys.stderr)
            return 1
        qiniu_existing_keys.update(online_qiniu_keys)
        files_by_qiniu_key = {
            build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix): path
            for path in files
        }
        for object_key in online_qiniu_keys:
            source_path = files_by_qiniu_key.get(object_key)
            if source_path and update_qiniu_cache_entry(cache_data, bucket=qiniu_bucket, object_key=object_key, path=source_path):
                cache_dirty = True
```

Replace the old `maybe_update_r2_cache_for_path()` helper with a single multi-target cache updater:

```python
def maybe_update_cache_for_path(target_label: str, status: str, path: Path | None) -> None:
    nonlocal cache_dirty
    if status != 'uploaded' or path is None:
        return
    if target_label == 'r2':
        object_key = build_object_key(path, base_dir=folder, prefix=normalized_prefix)
        if update_r2_cache_entry(cache_data, bucket=bucket, object_key=object_key, path=path):
            cache_dirty = True
    elif target_label == 'linux':
        remote_path = build_linux_remote_path(path, base_dir=folder, remote_dir=linux_dir or '')
        if update_linux_cache_entry(cache_data, host=linux_host or '', remote_path=remote_path, path=path):
            cache_dirty = True
    elif target_label == 'qiniu':
        object_key = build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix)
        if update_qiniu_cache_entry(cache_data, bucket=qiniu_bucket, object_key=object_key, path=path):
            cache_dirty = True
```

In the worker loop, stop inferring target labels from message text and instead zip results with `targets_for_mode(normalized_target)`:

```python
label_order = targets_for_mode(normalized_target)
for future in concurrent.futures.as_completed(future_to_path):
    future_path = future_to_path[future]
    items = future.result()
    for target_label, (status, message) in zip(label_order, items):
        emit_message(format_result_message(target_label, message), log_callback)
        maybe_update_cache_for_path(target_label, status, future_path)
        if status == 'uploaded':
            uploaded_count += 1
        elif status == 'skipped':
            skipped_count += 1
        elif status == 'dry-run':
            dry_run_count += 1
        else:
            fail_count += 1
```

Important: keep the Linux password batch shortcut only for `normalized_target == 'linux'`. Remove the current `elif args.target == 'both' and linux_password and not linux_key:` branch entirely, because `all`/`both` must go through per-file `upload_one()` to share the prepared PNG.

Finally, update the parser in `main()`:

```python
parser.add_argument('--target', choices=('r2', 'linux', 'qiniu', 'all', 'both'), default='both', help='Upload target. Defaults to both.')
parser.add_argument('--qiniu-bucket', default=None, help='Target Qiniu bucket name.')
parser.add_argument('--qiniu-prefix', default=None, help='Object key prefix for Qiniu uploads.')
```

- [ ] **Step 4: Run the orchestration tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadOneTests tests.test_upload_r2.QiniuCacheTests tests.test_upload_r2.RunUploadTests -v
```

Expected: the new orchestration tests report `ok`, and the parser test accepts `--target qiniu` and `--qiniu-bucket`.

### Task 5: Run the full regression suite and smoke-test the CLI aliases

**Files:**
- Modify: `tests/test_upload_r2.py` (only if a failing existing test needs an assertion update to reflect `both -> all` aliasing)

- [ ] **Step 1: Run the complete upload test suite**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: all `tests/test_upload_r2.py` tests pass.

- [ ] **Step 2: Create a one-file dry-run smoke-test directory**

Run:

```bash
python - <<'PY'
from pathlib import Path
folder = Path('tmp-upload-smoke')
folder.mkdir(exist_ok=True)
(folder / 'image.png').write_bytes(b'not-read-in-dry-run')
print(folder.resolve())
PY
```

Expected: Python prints the absolute path to `tmp-upload-smoke`.

- [ ] **Step 3: Verify the new Qiniu-only dry-run path**

Run:

```bash
python upload_r2.py --dir tmp-upload-smoke --target qiniu --dry-run --qiniu-bucket qiniu-bucket
```

Expected:
- The script prints `Target: qiniu`
- At least one line starts with `[QINIU] DRY-RUN image.png`
- The final line is `Finished. Dry-run: 1, Failed: 0`

- [ ] **Step 4: Verify the `both` alias still works and expands to all three destinations**

Run:

```bash
python upload_r2.py --dir tmp-upload-smoke --target both --dry-run --endpoint https://example.r2.cloudflarestorage.com --linux-host host --linux-user user --linux-dir /remote --linux-key key.pem --qiniu-bucket qiniu-bucket
```

Expected:
- The script accepts `both` instead of rejecting it.
- Output includes one `[R2] DRY-RUN image.png ...` line.
- Output includes one `[LINUX] DRY-RUN image.png ...` line.
- Output includes one `[QINIU] DRY-RUN image.png ...` line.
- The final line is `Finished. Dry-run: 3, Failed: 0`

- [ ] **Step 5: Clean up the smoke-test directory**

Run:

```bash
python - <<'PY'
from pathlib import Path
folder = Path('tmp-upload-smoke')
for child in folder.iterdir():
    child.unlink()
folder.rmdir()
PY
```

Expected: the command exits silently and removes the temporary directory.

## Self-Review Checklist

- Spec coverage:
  - Qiniu upload: Task 3 and Task 4
  - Shared PNG preprocessing: Task 2 and Task 4
  - Same prepared file reused across all targets: Task 4
  - `qiniu` / `all` / `both` aliasing: Task 1 and Task 4
  - Qiniu skip-existing and cache: Task 3 and Task 4
  - CLI-only scope: preserved throughout
- Placeholder scan: no `TODO`, `TBD`, or implicit “write tests later” steps remain.
- Type consistency:
  - `PreparedUpload` is defined before use.
  - `upload_to_r2()`, `upload_to_linux()`, and `upload_to_qiniu()` all use the same `source_path` / `upload_path` split.
  - `normalize_target()` and `targets_for_mode()` are defined before the orchestration code depends on them.
