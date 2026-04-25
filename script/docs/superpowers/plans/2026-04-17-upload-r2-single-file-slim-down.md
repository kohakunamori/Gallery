# Upload R2 Single-File Slim-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep `upload_r2.py` as a single file while removing the worst duplication, clarifying internal boundaries, and preserving current upload behavior.

**Architecture:** Introduce a few focused internal helpers and lightweight dataclasses inside `upload_r2.py` so the file stays single-file but stops mixing configuration resolution, cache mechanics, Linux transport details, and result accounting in one giant flow. Protect the refactor with TDD-first characterization tests in `tests/test_upload_r2.py`, then finish with a real `python upload_r2.py` smoke run as requested.

**Tech Stack:** Python 3.14, unittest, pathlib, tempfile, unittest.mock, boto3/botocore, paramiko, qiniu SDK

---

## File Map

- `upload_r2.py` — refactor in place; add focused helpers for runtime config resolution, cache access, Linux SFTP reuse, and upload-result accounting; delete obvious duplicate definitions.
- `tests/__init__.py` — create the test package so `python -m unittest tests.test_upload_r2 -v` works reliably.
- `tests/test_upload_r2.py` — add regression tests that pin current behavior before and during the refactor.
- `docs/superpowers/specs/2026-04-06-upload-r2-qiniu-png-design.md` — reference only; no changes.
- `docs/superpowers/specs/2026-04-07-upload-cache-metadata-design.md` — reference only; no changes.

## Notes

- The working directory is not a git repository, so use verification checkpoints instead of commit steps.
- This plan is intentionally single-file. Do not split `upload_r2.py` into new runtime modules.
- Do not change CLI flags, cache schema, target semantics, or upload behavior as part of this cleanup.
- The duplicate `get_cached_existing_linux_paths()` definition in `upload_r2.py` must be removed as part of the refactor.
- Final validation must include running `python upload_r2.py` exactly. If local credentials are absent, a user-facing config error is acceptable; a Python traceback is not.

### Task 1: Extract runtime configuration resolution out of `run_upload()`

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing runtime-config tests**

Create `tests/__init__.py` with:

```python
# Test package marker for unittest discovery.
```

Create `tests/test_upload_r2.py` with this initial test module:

```python
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import upload_r2


class ResolveRuntimeConfigTests(unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'target': 'both',
            'bucket': None,
            'prefix': None,
            'endpoint': None,
            'region': None,
            'r2_proxy': None,
            'linux_host': None,
            'linux_user': None,
            'linux_dir': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'qiniu_bucket': None,
            'qiniu_prefix': None,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_resolve_runtime_config_normalizes_both_to_all(self):
        args = self.make_args(target='both')

        with patch.dict(upload_r2.os.environ, {}, clear=True):
            config = upload_r2.resolve_runtime_config(args)

        self.assertEqual(config.target, 'all')

    def test_resolve_runtime_config_prefers_cli_over_env(self):
        args = self.make_args(
            bucket='cli-bucket',
            prefix='cli-prefix',
            linux_host='cli-host',
            linux_user='cli-user',
            linux_dir='/cli-dir',
            linux_password='cli-password',
            qiniu_bucket='cli-qiniu',
            qiniu_prefix='cli-qiniu-prefix',
        )

        with patch.dict(upload_r2.os.environ, {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'LINUX_UPLOAD_HOST': 'env-host',
            'LINUX_UPLOAD_USER': 'env-user',
            'LINUX_UPLOAD_DIR': '/env-dir',
            'LINUX_UPLOAD_PASSWORD': 'env-password',
            'QINIU_BUCKET': 'env-qiniu',
            'QINIU_PREFIX': 'env-qiniu-prefix',
        }, clear=True):
            config = upload_r2.resolve_runtime_config(args)

        self.assertEqual(config.bucket, 'cli-bucket')
        self.assertEqual(config.prefix, 'cli-prefix')
        self.assertEqual(config.linux_host, 'cli-host')
        self.assertEqual(config.linux_user, 'cli-user')
        self.assertEqual(config.linux_dir, '/cli-dir')
        self.assertEqual(config.linux_password, 'cli-password')
        self.assertEqual(config.qiniu_bucket, 'cli-qiniu')
        self.assertEqual(config.qiniu_prefix, 'cli-qiniu-prefix')

    def test_resolve_runtime_config_uses_env_defaults_when_cli_missing(self):
        args = self.make_args()

        with patch.dict(upload_r2.os.environ, {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'AWS_REGION': 'env-region',
            'R2_ENDPOINT': 'https://env-endpoint.example',
            'LINUX_UPLOAD_HOST': 'env-host',
            'LINUX_UPLOAD_USER': 'env-user',
            'LINUX_UPLOAD_DIR': '/env-dir',
            'LINUX_UPLOAD_PASSWORD': 'env-password',
            'QINIU_BUCKET': 'env-qiniu',
            'QINIU_PREFIX': 'env-qiniu-prefix',
        }, clear=True):
            config = upload_r2.resolve_runtime_config(args)

        self.assertEqual(config.bucket, 'env-bucket')
        self.assertEqual(config.prefix, 'env-prefix')
        self.assertEqual(config.region, 'env-region')
        self.assertEqual(config.endpoint, 'https://env-endpoint.example')
        self.assertEqual(config.linux_host, 'env-host')
        self.assertEqual(config.linux_user, 'env-user')
        self.assertEqual(config.linux_dir, '/env-dir')
        self.assertEqual(config.linux_password, 'env-password')
        self.assertEqual(config.qiniu_bucket, 'env-qiniu')
        self.assertEqual(config.qiniu_prefix, 'env-qiniu-prefix')
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.ResolveRuntimeConfigTests -v
```

Expected: `AttributeError` because `resolve_runtime_config` does not exist yet.

- [ ] **Step 3: Add a focused runtime-config dataclass and resolver**

In `upload_r2.py`, add this dataclass near the existing `PreparedUpload` dataclass:

```python
@dataclass(frozen=True)
class UploadRuntimeConfig:
    target: str
    bucket: str
    prefix: str
    region: str
    endpoint: str
    r2_proxy: str | None
    linux_host: str | None
    linux_user: str | None
    linux_dir: str | None
    linux_key: str | None
    linux_password: str | None
    linux_port: int
    linux_proxy: str | None
    qiniu_bucket: str
    qiniu_prefix: str
    qiniu_access_key: str | None
    qiniu_secret_key: str | None
    access_key: str | None
    secret_key: str | None
```

Add a resolver that moves the current config block out of `run_upload()`:

```python
def resolve_runtime_config(args) -> UploadRuntimeConfig:
    normalized_target = normalize_target(args.target)
    bucket = args.bucket or env_first('R2_BUCKET') or DEFAULT_BUCKET
    prefix = args.prefix if args.prefix is not None else (env_first('R2_PREFIX') or DEFAULT_PREFIX)
    region = args.region or env_first('AWS_REGION', 'AWS_DEFAULT_REGION', 'R2_REGION') or 'auto'
    access_key = env_first('CLOUDFLARE_R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
    secret_key = env_first('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
    account_id = env_first('CLOUDFLARE_ACCOUNT_ID')
    endpoint = args.endpoint or env_first('R2_ENDPOINT') or (
        f'https://{account_id}.r2.cloudflarestorage.com' if account_id else DEFAULT_ENDPOINT
    )
    linux_key = args.linux_key
    if linux_key is None and args.linux_password is None:
        linux_key = env_first('LINUX_UPLOAD_KEY')
    qiniu_prefix_arg = getattr(args, 'qiniu_prefix', None)
    return UploadRuntimeConfig(
        target=normalized_target,
        bucket=bucket,
        prefix=prefix,
        region=region,
        endpoint=endpoint,
        r2_proxy=args.r2_proxy or env_first('R2_PROXY'),
        linux_host=args.linux_host or env_first('LINUX_UPLOAD_HOST'),
        linux_user=args.linux_user or env_first('LINUX_UPLOAD_USER'),
        linux_dir=args.linux_dir or env_first('LINUX_UPLOAD_DIR'),
        linux_key=linux_key,
        linux_password=args.linux_password or env_first('LINUX_UPLOAD_PASSWORD'),
        linux_port=args.linux_port or int(env_first('LINUX_UPLOAD_PORT') or '22'),
        linux_proxy=args.linux_proxy or env_first('LINUX_PROXY'),
        qiniu_bucket=getattr(args, 'qiniu_bucket', None) or env_first('QINIU_BUCKET') or bucket,
        qiniu_prefix=qiniu_prefix_arg if qiniu_prefix_arg is not None else (env_first('QINIU_PREFIX') or prefix),
        qiniu_access_key=env_first('QINIU_ACCESS_KEY'),
        qiniu_secret_key=env_first('QINIU_SECRET_KEY'),
        access_key=access_key,
        secret_key=secret_key,
    )
```

Update `run_upload()` to call `config = resolve_runtime_config(args)` and replace direct references like `bucket`, `prefix`, `linux_host`, `qiniu_bucket`, and `normalized_target` with `config.bucket`, `config.prefix`, `config.linux_host`, `config.qiniu_bucket`, and `config.target`.

- [ ] **Step 4: Run the focused tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.ResolveRuntimeConfigTests -v
```

Expected: all three tests pass.

### Task 2: Replace duplicated cache-section code with shared cache helpers

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing cache-helper tests**

Append these tests to `tests/test_upload_r2.py`:

```python
from pathlib import Path
from tempfile import TemporaryDirectory


class CacheSectionHelperTests(unittest.TestCase):
    def test_get_cached_existing_targets_returns_matching_remote_ids(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')

            cache_entries = {
                'static-bucket|gallery/image.png': upload_r2.build_upload_cache_fingerprint(
                    image_path,
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                )
            }

            result = upload_r2.get_cached_existing_targets(
                [image_path],
                cache_entries=cache_entries,
                remote_id_builder=lambda path: f'gallery/{path.name}',
                cache_key_builder=lambda remote_id: f'static-bucket|{remote_id}',
                semantics_builder=upload_r2.get_expected_upload_cache_semantics,
            )

        self.assertEqual(result, {'gallery/image.png'})

    def test_store_cached_upload_target_updates_section_entry(self):
        cache_entries = {}

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.jpg'
            path.write_bytes(b'jpg-bytes')

            changed = upload_r2.store_cached_upload_target(
                cache_entries,
                'host|/remote/image.jpg',
                path,
                compressed=False,
                compression_strategy=None,
            )

        self.assertTrue(changed)
        self.assertIn('host|/remote/image.jpg', cache_entries)
        self.assertFalse(cache_entries['host|/remote/image.jpg']['compressed'])
```

- [ ] **Step 2: Run the focused cache-helper tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheSectionHelperTests -v
```

Expected: `AttributeError` because `get_cached_existing_targets` and `store_cached_upload_target` do not exist yet.

- [ ] **Step 3: Add shared cache primitives and thin target-specific wrappers**

In `upload_r2.py`, add these helpers near the cache functions:

```python
def get_cached_existing_targets(
    files: list[Path],
    *,
    cache_entries: dict,
    remote_id_builder,
    cache_key_builder,
    semantics_builder,
) -> set[str]:
    cached_existing: set[str] = set()
    for path in files:
        remote_id = remote_id_builder(path)
        cache_key = cache_key_builder(remote_id)
        compressed, compression_strategy = semantics_builder(path)
        if cache_entries.get(cache_key) == build_upload_cache_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        ):
            cached_existing.add(remote_id)
    return cached_existing


def store_cached_upload_target(
    cache_entries: dict,
    cache_key: str,
    path: Path,
    *,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    fingerprint = build_upload_cache_fingerprint(
        path,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
    if cache_entries.get(cache_key) == fingerprint:
        return False
    cache_entries[cache_key] = fingerprint
    return True
```

Then rewrite these existing functions as thin wrappers instead of repeating the whole loop/update logic:

```python
def get_cached_existing_r2_keys(...):
    r2_cache = cache_data.get('r2', {}) if isinstance(cache_data.get('r2', {}), dict) else {}
    return get_cached_existing_targets(
        files,
        cache_entries=r2_cache,
        remote_id_builder=lambda path: build_object_key(path, base_dir=base_dir, prefix=prefix),
        cache_key_builder=lambda object_key: build_r2_cache_key(bucket, object_key),
        semantics_builder=get_expected_upload_cache_semantics,
    )
```

```python
def update_r2_cache_entry(...):
    r2_cache = cache_data.setdefault('r2', {})
    return store_cached_upload_target(
        r2_cache,
        build_r2_cache_key(bucket, object_key),
        path,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
```

Do the same for Linux and Qiniu. Delete the duplicate second `get_cached_existing_linux_paths()` definition entirely.

- [ ] **Step 4: Run the focused cache-helper tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.CacheSectionHelperTests -v
```

Expected: both tests pass.

### Task 3: Collapse repeated Linux SFTP logic into shared helpers

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing Linux-helper tests**

Append these tests to `tests/test_upload_r2.py`:

```python
class LinuxTransferHelperTests(unittest.TestCase):
    def test_open_linux_sftp_client_returns_client_and_sftp(self):
        fake_client = object()
        fake_sftp = object()

        class ClientWrapper:
            def open_sftp(self):
                return fake_sftp

        with patch.object(upload_r2, 'connect_linux_ssh_client', return_value=ClientWrapper()):
            client, sftp = upload_r2.open_linux_sftp_client(
                host='host',
                user='user',
                ssh_key=None,
                password='secret',
                port=22,
                proxy_url=None,
            )

        self.assertIsNotNone(client)
        self.assertIs(sftp, fake_sftp)

    def test_upload_file_via_sftp_puts_file_and_restores_mtime(self):
        calls = []

        class FakeSFTP:
            def put(self, local_path, remote_path):
                calls.append(('put', local_path, remote_path))

            def utime(self, remote_path, times):
                calls.append(('utime', remote_path, times))

        with TemporaryDirectory() as tmpdir:
            source_path = Path(tmpdir) / 'image.png'
            upload_path = Path(tmpdir) / 'prepared.png'
            source_path.write_bytes(b'source')
            upload_path.write_bytes(b'prepared')
            upload_r2.os.utime(source_path, (1700000000.5, 1700000000.5))

            upload_r2.upload_file_via_sftp(
                FakeSFTP(),
                source_path=source_path,
                upload_path=upload_path,
                remote_path='/remote/image.png',
            )

        self.assertEqual(calls[0], ('put', str(upload_path), '/remote/image.png'))
        self.assertEqual(calls[1], ('utime', '/remote/image.png', (1700000000.5, 1700000000.5)))
```

- [ ] **Step 2: Run the focused Linux-helper tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.LinuxTransferHelperTests -v
```

Expected: `AttributeError` because `open_linux_sftp_client` and `upload_file_via_sftp` do not exist yet.

- [ ] **Step 3: Add reusable Linux SFTP helpers**

In `upload_r2.py`, add these helpers near the Linux SSH code:

```python
def open_linux_sftp_client(
    *,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
) -> tuple[paramiko.SSHClient, paramiko.SFTPClient]:
    client = connect_linux_ssh_client(
        host=host,
        user=user,
        ssh_key=ssh_key,
        password=password,
        port=port,
        proxy_url=proxy_url,
    )
    return client, client.open_sftp()


def upload_file_via_sftp(
    sftp: paramiko.SFTPClient,
    *,
    source_path: Path,
    upload_path: Path,
    remote_path: str,
) -> None:
    sftp.put(str(upload_path), remote_path)
    set_linux_remote_mtime(sftp, source_path=source_path, remote_path=remote_path)
```

Use them in three places:
- `upload_to_linux(...)` password branch
- `upload_to_linux(...)` proxy branch
- `upload_files_to_linux_via_password(...)`

After the refactor, the branch-specific bodies should only decide *whether* to use SFTP or shell commands; the actual SFTP upload work should go through `upload_file_via_sftp(...)`.

- [ ] **Step 4: Add a failing regression test for the password branch of `upload_to_linux()`**

Append this test to `tests/test_upload_r2.py`:

```python
class UploadToLinuxRefactorTests(unittest.TestCase):
    def test_upload_to_linux_password_branch_uses_shared_sftp_helper(self):
        fake_client = type('FakeClient', (), {'close': lambda self: None})()
        fake_sftp = type('FakeSFTP', (), {'close': lambda self: None})()

        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            source_path = base_dir / 'image.png'
            source_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2, 'open_linux_sftp_client', return_value=(fake_client, fake_sftp)), \
                 patch.object(upload_r2, 'ensure_linux_remote_dirs_sftp'), \
                 patch.object(upload_r2, 'upload_file_via_sftp') as upload_mock:
                status, _ = upload_r2.upload_to_linux(
                    source_path,
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
                    proxy_url=None,
                )

        self.assertEqual(status, 'uploaded')
        upload_mock.assert_called_once()
```

- [ ] **Step 5: Run the focused regression test and verify it fails before the branch is updated**

Run:

```bash
python -m unittest tests.test_upload_r2.UploadToLinuxRefactorTests.test_upload_to_linux_password_branch_uses_shared_sftp_helper -v
```

Expected: fail because `upload_to_linux()` still uses inline `sftp.put(...)` work.

- [ ] **Step 6: Update the Linux call sites and rerun all Linux-helper tests**

Run after refactoring:

```bash
python -m unittest tests.test_upload_r2.LinuxTransferHelperTests tests.test_upload_r2.UploadToLinuxRefactorTests -v
```

Expected: all pass.

### Task 4: Extract upload-result accounting so the two result loops stop duplicating work

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py`

- [ ] **Step 1: Write the failing result-accounting tests**

Append these tests to `tests/test_upload_r2.py`:

```python
class ApplyUploadResultTests(unittest.TestCase):
    def test_apply_upload_result_logs_message_and_updates_counts(self):
        counts = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
        messages = []

        changed = upload_r2.apply_upload_result(
            target_label='r2',
            path=None,
            result=('uploaded', 'OK image.png -> s3://bucket/gallery/image.png', False, None),
            counters=counts,
            on_message=messages.append,
            on_cache_update=lambda **kwargs: False,
        )

        self.assertFalse(changed)
        self.assertEqual(counts['uploaded'], 1)
        self.assertEqual(messages, ['[R2] OK image.png -> s3://bucket/gallery/image.png'])

    def test_apply_upload_result_calls_cache_update_for_uploaded_and_skipped(self):
        counts = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
        cache_calls = []

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'png-bytes')

            changed = upload_r2.apply_upload_result(
                target_label='linux',
                path=path,
                result=('skipped', 'SKIP image.png -> user@host:/remote/image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                counters=counts,
                on_message=lambda message: None,
                on_cache_update=lambda **kwargs: cache_calls.append(kwargs) or True,
            )

        self.assertTrue(changed)
        self.assertEqual(counts['skipped'], 1)
        self.assertEqual(cache_calls[0]['target_label'], 'linux')
        self.assertEqual(cache_calls[0]['status'], 'skipped')
```

- [ ] **Step 2: Run the focused result-accounting tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.ApplyUploadResultTests -v
```

Expected: `AttributeError` because `apply_upload_result` does not exist yet.

- [ ] **Step 3: Add a shared result-accounting helper**

In `upload_r2.py`, add:

```python
def apply_upload_result(
    *,
    target_label: str,
    path: Path | None,
    result: tuple[str, str, bool, str | None],
    counters: dict[str, int],
    on_message,
    on_cache_update,
) -> bool:
    status, message, compressed, compression_strategy = result
    on_message(format_result_message(target_label, message))
    if status == 'uploaded':
        counters['uploaded'] += 1
    elif status == 'skipped':
        counters['skipped'] += 1
    elif status == 'dry-run':
        counters['dry-run'] += 1
    else:
        counters['failed'] += 1
    if status in {'uploaded', 'skipped'} and path is not None:
        return on_cache_update(
            target_label=target_label,
            status=status,
            path=path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
    return False
```

Replace the duplicated per-result code in both result-consumption loops inside `run_upload()` with calls to `apply_upload_result(...)`.

- [ ] **Step 4: Run the focused result-accounting tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.ApplyUploadResultTests -v
```

Expected: both tests pass.

### Task 5: Run full verification and the requested smoke command

**Files:**
- Modify: `upload_r2.py` (no new edits expected in this task)
- Modify: `tests/test_upload_r2.py` (no new edits expected in this task)

- [ ] **Step 1: Run the full unit test file**

Run:

```bash
python -m unittest tests.test_upload_r2 -v
```

Expected: all tests pass.

- [ ] **Step 2: Run a syntax-only sanity check**

Run:

```bash
python -m py_compile upload_r2.py
```

Expected: no output.

- [ ] **Step 3: Run the exact smoke command requested by the user**

Run:

```bash
python upload_r2.py
```

Expected: no Python traceback. Acceptable outcomes are:
- normal startup plus upload/log output, or
- a clean user-facing validation error such as missing credentials/config.

Unacceptable outcome: a traceback caused by the refactor.

- [ ] **Step 4: If `python upload_r2.py` exits with a config error, confirm it is only configuration-related**

Check the output. If it says something like one of the existing messages below, the smoke test is acceptable and the code path is still healthy:

```text
Missing R2 credentials. Set them in env or an env file using CLOUDFLARE_R2_ACCESS_KEY_ID/CLOUDFLARE_R2_SECRET_ACCESS_KEY or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.
```

```text
Missing Linux upload config. Set --linux-host, --linux-user, --linux-dir, and either --linux-key or --linux-password, or matching env vars.
```

```text
Missing Qiniu credentials. Set QINIU_ACCESS_KEY and QINIU_SECRET_KEY.
```

- [ ] **Step 5: Manually inspect the top-level structure of `upload_r2.py`**

Confirm the file now reads in this order:
1. constants and dataclasses
2. cache helpers
3. transport helpers
4. target upload helpers
5. `run_upload()` orchestration
6. CLI entrypoint

The file may still be large, but the repeated logic should now be centralized instead of copied.
