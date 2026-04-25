# Upload Cache Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.upload_target_cache.json` reflect the actual uploaded artifact semantics, invalidate old cache entries automatically, and preserve source file modification time across compressed uploads and remote targets.

**Architecture:** Keep `PreparedUpload` as the single source of truth for what actually gets uploaded. Update cache reads/writes to use upload-artifact semantics instead of hardcoded uncompressed values, set compressed temp files to the source file timestamps, restore Linux remote mtimes after upload, and attach source mtime metadata to R2 and Qiniu uploads. Implement through focused TDD changes in `upload_r2.py` with regression coverage in `tests/test_upload_r2.py`.

**Tech Stack:** Python 3.14, unittest, boto3/botocore, paramiko, qiniu SDK, tempfile, os, pathlib

---

## File Map

- `upload_r2.py` — modify cache fingerprint helpers, cache version handling, prepared-upload timestamp handling, Linux remote mtime restoration, and R2/Qiniu metadata propagation.
- `tests/test_upload_r2.py` — add and update regression tests for cache semantics, cache invalidation, temp-file timestamp preservation, Linux remote timestamp restoration, and R2/Qiniu metadata payloads.
- `docs/superpowers/specs/2026-04-07-upload-cache-metadata-design.md` — reference only; no code changes.

## Notes

- The working directory is not a git repository, so use test verification checkpoints instead of commit steps.
- Old cache entries with the current schema are semantically wrong for compression tracking and must be invalidated via schema bump.
- Cache `size` and `mtime` should continue to describe the local source file snapshot used for skip invalidation.
- Cache `compressed` and `compression_strategy` must describe the actual uploaded artifact.
- Linux filesystem ordering should reflect source file mtime, not upload time or temp-file creation time.
- R2/Qiniu object metadata should preserve source mtime for downstream tooling even if native object sorting does not use it directly.

### Task 1: Update cache schema semantics and invalidate old cache files

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:21-208`

- [ ] **Step 1: Write the failing cache fingerprint tests**

Add these tests near the existing `CacheHelperTests` in `tests/test_upload_r2.py`:

```python
    def test_build_upload_cache_fingerprint_marks_png_as_compressed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'abc')

            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

        self.assertTrue(fingerprint['compressed'])
        self.assertEqual(fingerprint['compression_strategy'], upload_r2.PNG_COMPRESSION_STRATEGY)

    def test_build_upload_cache_fingerprint_marks_non_png_as_uncompressed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.jpg'
            path.write_bytes(b'abc')

            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=False,
                compression_strategy=None,
            )

        self.assertFalse(fingerprint['compressed'])
        self.assertIsNone(fingerprint['compression_strategy'])

    def test_load_upload_cache_discards_previous_schema_version(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cache_path = Path(tmpdir) / upload_r2.CACHE_FILE_NAME
            cache_path.write_text(
                upload_r2.json.dumps({
                    'version': upload_r2.CACHE_SCHEMA_VERSION - 1,
                    'r2': {'old': {'size': 1, 'mtime': 1.0, 'compressed': False, 'compression_strategy': None}},
                    'linux': {'old': {'size': 1, 'mtime': 1.0, 'compressed': False, 'compression_strategy': None}},
                    'qiniu': {'old': {'size': 1, 'mtime': 1.0, 'compressed': False, 'compression_strategy': None}},
                }),
                encoding='utf-8',
            )

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(cache_data, build_empty_upload_cache())
```

- [ ] **Step 2: Run the focused tests and verify they fail for the expected reason**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheHelperTests.test_build_upload_cache_fingerprint_marks_png_as_compressed tests.test_upload_r2.CacheHelperTests.test_build_upload_cache_fingerprint_marks_non_png_as_uncompressed tests.test_upload_r2.CacheHelperTests.test_load_upload_cache_discards_previous_schema_version
```

Expected: failures because `build_upload_cache_fingerprint()` still hardcodes uncompressed semantics and `load_upload_cache()` still accepts old versions.

- [ ] **Step 3: Bump cache schema and change cache fingerprint helper signatures**

In `upload_r2.py`, update the cache helpers:

```python
CACHE_SCHEMA_VERSION = 3
```

```python
def build_upload_cache_fingerprint(
    path: Path,
    *,
    compressed: bool,
    compression_strategy: str | None,
) -> dict[str, float | int | bool | str | None]:
    return build_local_file_fingerprint(
        path,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
```

Update `load_upload_cache()` so any cache whose `version` is not equal to `CACHE_SCHEMA_VERSION` returns:

```python
{
    'version': CACHE_SCHEMA_VERSION,
    'r2': {},
    'linux': {},
    'qiniu': {},
}
```

- [ ] **Step 4: Update cache read/write helpers to use explicit upload-artifact semantics**

Change `update_r2_cache_entry`, `update_linux_cache_entry`, and `update_qiniu_cache_entry` signatures to accept explicit compression info:

```python
def update_r2_cache_entry(
    cache_data: dict,
    *,
    bucket: str,
    object_key: str,
    path: Path,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
```

Build the fingerprint with:

```python
fingerprint = build_upload_cache_fingerprint(
    path,
    compressed=compressed,
    compression_strategy=compression_strategy,
)
```

Do the same for Linux and Qiniu.

- [ ] **Step 5: Run the focused tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheHelperTests.test_build_upload_cache_fingerprint_marks_png_as_compressed tests.test_upload_r2.CacheHelperTests.test_build_upload_cache_fingerprint_marks_non_png_as_uncompressed tests.test_upload_r2.CacheHelperTests.test_load_upload_cache_discards_previous_schema_version
```

Expected: all pass.

### Task 2: Preserve source mtime on compressed temp files

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:393-443`

- [ ] **Step 1: Write the failing prepared-upload timestamp test**

Add this test near the existing `PrepareUploadFileTests`:

```python
    def test_prepare_upload_file_preserves_source_mtime_on_compressed_temp_file(self):
        def fake_run(command, **kwargs):
            output_path = Path(command[command.index('--out') + 1])
            output_path.write_bytes(b'optimized-png-bytes')
            return upload_r2.subprocess.CompletedProcess(command, 0)

        with tempfile.TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / 'image.png'
            source_path.write_bytes(b'png-bytes')
            original_mtime = 1_700_000_123.25
            upload_r2.os.utime(source_path, (original_mtime, original_mtime))

            with patch.object(upload_r2.shutil, 'which', return_value='oxipng'), \
                 patch.object(upload_r2.subprocess, 'run', side_effect=fake_run):
                prepared = upload_r2.prepare_upload_file(source_path)

                self.assertAlmostEqual(prepared.upload_path.stat().st_mtime, original_mtime, places=6)

                upload_r2.cleanup_prepared_upload(prepared)
```

- [ ] **Step 2: Run the focused test and verify it fails before implementation**

Run:

```bash
python -m unittest tests.test_upload_r2.PrepareUploadFileTests.test_prepare_upload_file_preserves_source_mtime_on_compressed_temp_file
```

Expected: fail because the temp file currently gets a fresh mtime.

- [ ] **Step 3: Set temp-file timestamps from the source file after `oxipng` succeeds**

In `prepare_upload_file()` after verifying the temp file exists and is non-empty, add:

```python
        source_stat = path.stat()
        os.utime(temp_path, (source_stat.st_atime, source_stat.st_mtime))
```

Keep the existing cleanup behavior unchanged.

- [ ] **Step 4: Run the focused test again and verify it passes**

Run:

```bash
python -m unittest tests.test_upload_r2.PrepareUploadFileTests.test_prepare_upload_file_preserves_source_mtime_on_compressed_temp_file
```

Expected: pass.

### Task 3: Restore source mtime on Linux uploads

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:552-897`

- [ ] **Step 1: Write the failing Linux timestamp tests**

Add a helper-oriented test near `UploadToLinuxTests`:

```python
    def test_upload_to_linux_restores_remote_mtime_after_sftp_put(self):
        calls = []
        source_mtime = 1_700_000_555.75

        class FakeSFTP:
            def stat(self, path):
                raise FileNotFoundError

            def put(self, local_path, remote_path):
                calls.append(('put', local_path, remote_path))

            def utime(self, remote_path, times):
                calls.append(('utime', remote_path, times))

            def close(self):
                calls.append(('sftp_close',))

        class FakeSSHClient:
            def open_sftp(self):
                return FakeSFTP()

            def close(self):
                calls.append(('client_close',))

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')
            upload_r2.os.utime(image_path, (source_mtime, source_mtime))

            with patch.object(upload_r2, 'connect_linux_ssh_client', return_value=FakeSSHClient()), \
                 patch.object(upload_r2, 'ensure_linux_remote_dirs_sftp'):
                status, message = upload_r2.upload_to_linux(
                    image_path,
                    base_dir=base_dir,
                    remote_dir='/remote',
                    host='host',
                    user='user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    dry_run=False,
                    skip_existing=False,
                )

        self.assertEqual(status, 'uploaded')
        self.assertEqual(message, 'OK image.png -> user@host:/remote/image.png')
        self.assertIn(('utime', '/remote/image.png', (source_mtime, source_mtime)), calls)
```

Add a batch-path test:

```python
    def test_upload_files_to_linux_via_password_restores_remote_mtime_after_sftp_put(self):
        calls = []
        source_mtime = 1_700_000_777.5

        class FakeSFTP:
            def stat(self, path):
                raise FileNotFoundError

            def put(self, local_path, remote_path):
                calls.append(('put', local_path, remote_path))

            def utime(self, remote_path, times):
                calls.append(('utime', remote_path, times))

            def close(self):
                pass

        class FakeSSHClient:
            def open_sftp(self):
                return FakeSFTP()

            def close(self):
                pass

        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')
            upload_r2.os.utime(image_path, (source_mtime, source_mtime))
            prepared = upload_r2.PreparedUpload(
                source_path=image_path,
                upload_path=image_path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )

            with patch.object(upload_r2, 'connect_linux_ssh_client', return_value=FakeSSHClient()), \
                 patch.object(upload_r2, 'ensure_linux_remote_dirs_sftp'), \
                 patch.object(upload_r2, 'prepare_upload_file', return_value=prepared), \
                 patch.object(upload_r2, 'cleanup_prepared_upload'):
                results = upload_r2.upload_files_to_linux_via_password(
                    [image_path],
                    base_dir=base_dir,
                    remote_dir='/remote',
                    host='host',
                    user='user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    dry_run=False,
                    skip_existing=False,
                    existing_paths=None,
                )

        self.assertEqual(results, [('uploaded', 'OK image.png -> user@host:/remote/image.png')])
        self.assertIn(('utime', '/remote/image.png', (source_mtime, source_mtime)), calls)
```

- [ ] **Step 2: Run the focused Linux timestamp tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadToLinuxTests.test_upload_to_linux_restores_remote_mtime_after_sftp_put tests.test_upload_r2.UploadToLinuxTests.test_upload_files_to_linux_via_password_restores_remote_mtime_after_sftp_put
```

Expected: fail because no `utime(...)` call exists yet.

- [ ] **Step 3: Add a small helper to apply source timestamps to remote Linux files**

In `upload_r2.py` near the Linux SFTP helpers, add:

```python
def set_linux_remote_mtime(sftp: paramiko.SFTPClient, *, source_path: Path, remote_path: str) -> None:
    source_stat = source_path.stat()
    sftp.utime(remote_path, (source_stat.st_mtime, source_stat.st_mtime))
```

Then call it immediately after successful `sftp.put(...)` in:
- `upload_to_linux(...)`
- `upload_files_to_linux_via_password(...)`

Use the original `source_path`/`path`, not the temp upload path, so Linux ordering reflects source chronology.

- [ ] **Step 4: Run the focused Linux timestamp tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadToLinuxTests.test_upload_to_linux_restores_remote_mtime_after_sftp_put tests.test_upload_r2.UploadToLinuxTests.test_upload_files_to_linux_via_password_restores_remote_mtime_after_sftp_put
```

Expected: both pass.

### Task 4: Add source mtime metadata to R2 and Qiniu uploads

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:455-537`

- [ ] **Step 1: Write the failing R2 metadata test**

Add this near the existing `UploadToR2Tests`:

```python
    def test_upload_to_r2_includes_source_mtime_metadata(self):
        calls = []

        class FakeClient:
            def put_object(self, **kwargs):
                calls.append(kwargs)

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')
            source_mtime = 1_700_000_999.125
            upload_r2.os.utime(image_path, (source_mtime, source_mtime))

            with patch.object(upload_r2, 'make_r2_client', return_value=FakeClient()):
                result = upload_r2.upload_to_r2(
                    image_path,
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

        self.assertEqual(result, ('uploaded', 'OK image.png -> s3://static-bucket/gallery/image.png'))
        self.assertEqual(calls[0]['Metadata']['source-mtime'], str(source_mtime))
```

- [ ] **Step 2: Write the failing Qiniu metadata test**

Add this near the existing `QiniuUploadTests`:

```python
    def test_upload_to_qiniu_includes_source_mtime_metadata(self):
        captured = {}

        class FakeInfo:
            def ok(self):
                return True

        class FakeAuth:
            def __init__(self, access_key, secret_key):
                self.access_key = access_key
                self.secret_key = secret_key

            def upload_token(self, bucket, key, expires):
                return 'upload-token'

        def fake_put_file_v2(token, key, local_path, version='v2', params=None):
            captured['token'] = token
            captured['key'] = key
            captured['local_path'] = local_path
            captured['version'] = version
            captured['params'] = params
            return {'key': key}, FakeInfo()

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')
            source_mtime = 1_700_000_321.875
            upload_r2.os.utime(image_path, (source_mtime, source_mtime))

            with patch.object(upload_r2.qiniu, 'Auth', FakeAuth), \
                 patch.object(upload_r2.qiniu, 'put_file_v2', side_effect=fake_put_file_v2):
                result = upload_r2.upload_to_qiniu(
                    image_path,
                    base_dir=base_dir,
                    bucket='bucket-a',
                    prefix='gallery',
                    access_key='q-ak',
                    secret_key='q-sk',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                )

        self.assertEqual(result, ('uploaded', 'OK image.png -> qiniu://bucket-a/gallery/image.png'))
        self.assertEqual(captured['params']['x-qn-meta-source-mtime'], str(source_mtime))
```

- [ ] **Step 3: Run the focused metadata tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadToR2Tests.test_upload_to_r2_includes_source_mtime_metadata tests.test_upload_r2.QiniuUploadTests.test_upload_to_qiniu_includes_source_mtime_metadata
```

Expected: fail because no metadata is currently sent.

- [ ] **Step 4: Add a shared source mtime helper and wire it into upload requests**

In `upload_r2.py`, add:

```python
def get_source_mtime_metadata_value(source_path: Path) -> str:
    return str(source_path.stat().st_mtime)
```

Update `upload_to_r2(...)`:

```python
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            CacheControl='public, max-age=315360000, immutable',
            Metadata={'source-mtime': get_source_mtime_metadata_value(source_path)},
        )
```

Update `upload_to_qiniu(...)` to pass explicit params:

```python
        ret, info = qiniu.put_file_v2(
            token,
            key,
            str(upload_path),
            version='v2',
            params={'x-qn-meta-source-mtime': get_source_mtime_metadata_value(source_path)},
        )
```

- [ ] **Step 5: Run the focused metadata tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadToR2Tests.test_upload_to_r2_includes_source_mtime_metadata tests.test_upload_r2.QiniuUploadTests.test_upload_to_qiniu_includes_source_mtime_metadata
```

Expected: both pass.

### Task 5: Thread real upload-artifact semantics through cache updates

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:911-1407`

- [ ] **Step 1: Write the failing cache-update semantics tests**

Add these tests near the existing cache-update tests:

```python
class UploadCacheSemanticsTests(unittest.TestCase):
    def test_update_r2_cache_entry_records_compressed_upload_semantics(self):
        cache_data = build_empty_upload_cache()

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'png-bytes')

            changed = upload_r2.update_r2_cache_entry(
                cache_data,
                bucket='static-bucket',
                object_key='gallery/image.png',
                path=path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

        self.assertTrue(changed)
        self.assertEqual(
            cache_data['r2']['static-bucket|gallery/image.png']['compressed'],
            True,
        )
        self.assertEqual(
            cache_data['r2']['static-bucket|gallery/image.png']['compression_strategy'],
            upload_r2.PNG_COMPRESSION_STRATEGY,
        )
```

```python
    def test_update_linux_cache_entry_records_uncompressed_semantics_for_non_png(self):
        cache_data = build_empty_upload_cache()

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.jpg'
            path.write_bytes(b'jpg-bytes')

            changed = upload_r2.update_linux_cache_entry(
                cache_data,
                host='host',
                remote_path='/remote/image.jpg',
                path=path,
                compressed=False,
                compression_strategy=None,
            )

        self.assertTrue(changed)
        self.assertFalse(cache_data['linux']['host|/remote/image.jpg']['compressed'])
        self.assertIsNone(cache_data['linux']['host|/remote/image.jpg']['compression_strategy'])
```

- [ ] **Step 2: Run the focused cache-update tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadCacheSemanticsTests.test_update_r2_cache_entry_records_compressed_upload_semantics tests.test_upload_r2.UploadCacheSemanticsTests.test_update_linux_cache_entry_records_uncompressed_semantics_for_non_png
```

Expected: fail because the update helper signatures do not accept upload-artifact semantics yet, or still record old semantics.

- [ ] **Step 3: Add a small helper that derives cache semantics from `PreparedUpload`**

In `upload_r2.py`, add:

```python
def get_upload_cache_semantics(prepared: PreparedUpload | None) -> tuple[bool, str | None]:
    if prepared is None:
        return False, None
    return prepared.compressed, prepared.compression_strategy
```

Then update cache writes in `run_upload()` so they no longer assume `path` alone is enough.

- [ ] **Step 4: Thread `PreparedUpload` semantics into cache updates for all targets**

Adjust `maybe_update_cache_for_path(...)` so it accepts either a `PreparedUpload | None` or explicit `compressed/compression_strategy` values. For per-file uploads, use the `prepared` object created in `upload_one(...)`. For Linux batch uploads, derive semantics by calling `prepare_upload_file(path)` once in the batch helper, then return or expose the used semantics back to `run_upload()`.

A minimal approach is to change upload result items so Linux batch returns enough information for cache writes:

```python
(status, message, compressed, compression_strategy)
```

and keep non-batch paths internal to `upload_one(...)` by returning matching metadata alongside each target result.

Do not introduce a generic abstraction beyond what is required to carry the real upload semantics to cache updates.

- [ ] **Step 5: Update cached-online-hit writes to use the same semantics**

When online existence checks confirm an object already exists and the local file is unchanged, use the expected upload semantics for that source file:
- PNG -> `compressed=True`, `compression_strategy=PNG_COMPRESSION_STRATEGY`
- non-PNG -> `compressed=False`, `compression_strategy=None`

This keeps future skip decisions consistent with the actual upload policy.

- [ ] **Step 6: Run the focused cache-update tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadCacheSemanticsTests.test_update_r2_cache_entry_records_compressed_upload_semantics tests.test_upload_r2.UploadCacheSemanticsTests.test_update_linux_cache_entry_records_uncompressed_semantics_for_non_png
```

Expected: pass.

### Task 6: Run full verification and a real smoke test

**Files:**
- Modify: `tests/test_upload_r2.py` (no new edits expected in this task)
- Modify: `upload_r2.py` (no new edits expected in this task)

- [ ] **Step 1: Run the full unit test suite**

Run:

```bash
python -m unittest tests.test_upload_r2
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Run a Linux-only forced-upload smoke test**

Run:

```bash
python upload_r2.py --env-file upload_r2.env --target linux --no-skip-existing --workers 1
```

Expected: command completes without errors, Linux logs show upload activity, and compressed PNG uploads follow the fixed batch path.

- [ ] **Step 3: Run an all-target smoke test to verify no regression in mixed mode**

Run:

```bash
python upload_r2.py --env-file upload_r2.env --target both --workers 1
```

Expected: command completes without SSH banner errors, with Linux using batch mode and other targets still behaving normally.

- [ ] **Step 4: Inspect `.upload_target_cache.json` after a successful run**

Check that at least one PNG entry now looks like:

```json
{
  "size": 12345,
  "mtime": 1712300000.123456,
  "compressed": true,
  "compression_strategy": "oxipng:o_max:z:strip_safe"
}
```

and that non-PNG entries still use:

```json
{
  "compressed": false,
  "compression_strategy": null
}
```

- [ ] **Step 5: Verify remote timestamp behavior manually**

Use your existing Linux target to inspect one uploaded file and confirm its remote mtime matches the local source file mtime. If you have a script or shell access, compare the local `Path(...).stat().st_mtime` value with the remote file timestamp after upload.

- [ ] **Step 6: Verify object metadata manually where practical**

For one R2 object and one Qiniu object uploaded after this change, confirm source mtime metadata exists using your existing inspection tools or SDK helpers.
