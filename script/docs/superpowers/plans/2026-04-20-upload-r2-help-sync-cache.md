# Upload R2 Help and Sync Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add grouped Chinese `--help` output to `upload_r2.py`, add `--sync-cache-only` to rebuild local cache from remote state without uploading, and stop printing per-file `SKIP` lines during normal uploads.

**Architecture:** Keep the work inside `upload_r2.py` to match the existing single-file CLI structure. Add a parser-builder helper for grouped help and flag validation, a small cache-removal helper for target-level rebuilds, a dedicated `run_sync_cache_only()` branch that reuses existing remote existence checks, and a small logging switch in `apply_upload_result()` so skipped items still count and update cache without spamming logs.

**Tech Stack:** Python 3.14, unittest, argparse, pathlib, tempfile, boto3/botocore, paramiko, qiniu SDK

---

## File Map

- `upload_r2.py` — add `build_parser()`, add `--sync-cache-only`, validate conflicting flags, add grouped Chinese help text, add `clear_target_synced()`, suppress per-item skip logs in upload mode, add `run_sync_cache_only()`, and wire the new mode into `run_upload()`.
- `tests/test_upload_r2.py` — add parser/help tests, add target-cache removal tests, update upload logging regressions to require hidden skip lines, and add full `sync-cache-only` integration tests.
- `docs/superpowers/specs/2026-04-20-upload-r2-help-sync-cache-design.md` — already updated to include the extra “upload mode should not print per-file SKIP items” rule; reference only.

## Notes

- This working directory is not a git repository, so every task ends with a verification checkpoint instead of a commit.
- Keep existing CLI option names and behavior stable, including `both` as an alias for `all`.
- `--sync-cache-only` still needs real remote credentials/config because it performs remote existence checks.
- Normal upload mode must still increment `Skipped` in the final summary and still update cache for skipped results; only the per-item log lines disappear.
- Do not edit `upload_r2_gui.py` in this plan.

### Task 1: Build the grouped Chinese parser and validate the new mode flags

**Files:**
- Modify: `tests/test_upload_r2.py:1-10`
- Modify: `tests/test_upload_r2.py:2612-2617` (append parser/help tests after the existing `test_main_accepts_verify_remote_flag`)
- Modify: `upload_r2.py:2814-2840`

- [ ] **Step 1: Write the failing parser and help-output tests**

In `tests/test_upload_r2.py`, replace the import block and append a new parser test class after `test_main_accepts_verify_remote_flag`:

```python
import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import upload_r2
from upload_r2 import DEFAULT_BUCKET, DEFAULT_ENDPOINT, DEFAULT_PREFIX, resolve_runtime_config
```

```python
class CliParserTests(unittest.TestCase):
    def test_main_accepts_sync_cache_only_flag(self):
        with patch('upload_r2.run_upload', return_value=0) as run_upload_mock:
            exit_code = upload_r2.main(['--sync-cache-only'])

        self.assertEqual(0, exit_code)
        self.assertTrue(run_upload_mock.call_args.args[0].sync_cache_only)

    def test_main_rejects_sync_cache_only_with_dry_run(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as ctx:
            upload_r2.main(['--sync-cache-only', '--dry-run'])

        self.assertEqual(2, ctx.exception.code)
        self.assertIn('--sync-cache-only 不能与 --dry-run 同时使用。', stderr.getvalue())

    def test_main_rejects_sync_cache_only_with_verify_remote(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as ctx:
            upload_r2.main(['--sync-cache-only', '--verify-remote'])

        self.assertEqual(2, ctx.exception.code)
        self.assertIn('--sync-cache-only 不能与 --verify-remote 同时使用。', stderr.getvalue())

    def test_main_rejects_sync_cache_only_with_no_skip_existing(self):
        stderr = io.StringIO()
        with redirect_stderr(stderr), self.assertRaises(SystemExit) as ctx:
            upload_r2.main(['--sync-cache-only', '--no-skip-existing'])

        self.assertEqual(2, ctx.exception.code)
        self.assertIn('--sync-cache-only 不能与 --no-skip-existing 同时使用。', stderr.getvalue())

    def test_help_output_is_grouped_and_localized(self):
        stdout = io.StringIO()
        with redirect_stdout(stdout), self.assertRaises(SystemExit) as ctx:
            upload_r2.main(['--help'])

        self.assertEqual(0, ctx.exception.code)
        help_output = stdout.getvalue()
        self.assertIn('通用参数', help_output)
        self.assertIn('R2 参数', help_output)
        self.assertIn('Linux 参数', help_output)
        self.assertIn('七牛参数', help_output)
        self.assertIn('仅根据远端实际状态重建本地缓存，不上传文件。', help_output)
```

- [ ] **Step 2: Run the parser tests and verify they fail for the right reasons**

Run:

```bash
python -m unittest tests.test_upload_r2.CliParserTests -v
```

Expected:

- `test_main_accepts_sync_cache_only_flag` fails because `sync_cache_only` is not defined on parsed args.
- The conflict tests fail because `main()` does not reject those flag combinations yet.
- The help test fails because the help output is still English and ungrouped.

- [ ] **Step 3: Implement `build_parser()` and move CLI help text to grouped Chinese sections**

In `upload_r2.py`, replace the current `main()` parser block with this code:

```python
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='将本地图片上传到 Cloudflare R2、Linux 服务器或七牛云，并维护本地上传缓存。',
    )

    common_group = parser.add_argument_group('通用参数')
    common_group.add_argument('--dir', default='.', help='要扫描的目录，默认为当前目录。')
    common_group.add_argument('--env-file', default=None, help='要加载的环境变量文件，例如 .env。')
    common_group.add_argument('--recursive', action='store_true', help='递归扫描子目录中的图片。')
    common_group.add_argument('--workers', type=int, default=16, help='并发执行数，默认为 16。')
    common_group.add_argument('--target', choices=('r2', 'linux', 'qiniu', 'all', 'both'), default='both', help='上传目标，默认为 both（即 all）。')
    common_group.add_argument('--dry-run', action='store_true', help='仅预览将处理的目标，不发送上传请求。')
    common_group.add_argument('--refresh-cache', action='store_true', help='处理前清空本地上传缓存，再按本次结果重新写入。')
    common_group.add_argument('--verify-remote', action='store_true', help='仅对本地判定为待上传的项目执行远端存在性确认。')
    common_group.add_argument('--no-skip-existing', action='store_true', help='即使远端已存在也继续上传。')
    common_group.add_argument('--sync-cache-only', action='store_true', help='仅根据远端实际状态重建本地缓存，不上传文件。')

    r2_group = parser.add_argument_group('R2 参数')
    r2_group.add_argument('--bucket', default=None, help='R2 bucket 名称。')
    r2_group.add_argument('--prefix', default=None, help='对象 key 前缀，默认使用 gallery。')
    r2_group.add_argument('--endpoint', default=None, help='R2 的 S3 endpoint。')
    r2_group.add_argument('--region', default=None, help='签名 region，默认使用 auto。')
    r2_group.add_argument('--r2-proxy', default=None, help='R2 请求使用的代理地址，例如 http://127.0.0.1:7890。')

    linux_group = parser.add_argument_group('Linux 参数')
    linux_group.add_argument('--linux-host', default=None, help='Linux 服务器主机名或 IP。')
    linux_group.add_argument('--linux-user', default=None, help='Linux 服务器 SSH 用户名。')
    linux_group.add_argument('--linux-dir', default=None, help='Linux 服务器上的目标目录。')
    linux_group.add_argument('--linux-key', default=None, help='Linux 上传使用的 SSH 私钥路径。')
    linux_group.add_argument('--linux-password', default=None, help='Linux 上传使用的 SSH 密码。')
    linux_group.add_argument('--linux-port', type=int, default=None, help='Linux SSH 端口，默认使用 22。')
    linux_group.add_argument('--linux-proxy', default=None, help='Linux 上传使用的代理地址，例如 socks5://127.0.0.1:1080。')

    qiniu_group = parser.add_argument_group('七牛参数')
    qiniu_group.add_argument('--qiniu-bucket', default=None, help='七牛 bucket 名称，默认取 QINIU_BUCKET 或 --bucket。')
    qiniu_group.add_argument('--qiniu-prefix', default=None, help='七牛对象 key 前缀，默认取 QINIU_PREFIX 或 --prefix。')

    return parser



def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.sync_cache_only and args.dry_run:
        parser.error('--sync-cache-only 不能与 --dry-run 同时使用。')
    if args.sync_cache_only and args.verify_remote:
        parser.error('--sync-cache-only 不能与 --verify-remote 同时使用。')
    if args.sync_cache_only and args.no_skip_existing:
        parser.error('--sync-cache-only 不能与 --no-skip-existing 同时使用。')
    return run_upload(args)
```

- [ ] **Step 4: Run the parser tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.CliParserTests -v
```

Expected: all 5 tests pass.

- [ ] **Step 5: Verification checkpoint**

Run:

```bash
python -c "import upload_r2; print(upload_r2.build_parser().format_help())"
```

Expected: help output contains the four Chinese section headers and the new `--sync-cache-only` description.

### Task 2: Add target-cache removal and suppress per-item `SKIP` logs during uploads

**Files:**
- Modify: `tests/test_upload_r2.py:2490-2598`
- Modify: `tests/test_upload_r2.py:2756-2788` (append target-cache removal tests near the existing target-cache tests)
- Modify: `tests/test_upload_r2.py:3365-3412` (append one focused `apply_upload_result()` logging test near the existing apply-result tests)
- Modify: `upload_r2.py:213-255`
- Modify: `upload_r2.py:2003-2030`
- Modify: `upload_r2.py:2622-2797`

- [ ] **Step 1: Write the failing target-cache removal tests**

Append this class in `tests/test_upload_r2.py` right after `TargetResultCacheUpdateTests`:

```python
class TargetSyncStateRemovalTests(unittest.TestCase):
    def test_clear_target_synced_removes_only_requested_target(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.jpg'
            path.write_bytes(b'jpg-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket-name|gallery/image.jpg',
                compressed=False,
                compression_strategy=None,
            )
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='qiniu',
                target_id='qiniu-bucket|gallery/image.jpg',
                compressed=False,
                compression_strategy=None,
            )

            changed = upload_r2.clear_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
            )

        self.assertTrue(changed)
        self.assertNotIn('r2', cache_data['files']['image.jpg']['targets'])
        self.assertIn('qiniu', cache_data['files']['image.jpg']['targets'])

    def test_clear_target_synced_drops_empty_file_record_when_last_target_is_removed(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.jpg'
            path.write_bytes(b'jpg-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket-name|gallery/image.jpg',
                compressed=False,
                compression_strategy=None,
            )

            changed = upload_r2.clear_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
            )

        self.assertTrue(changed)
        self.assertNotIn('image.jpg', cache_data['files'])

    def test_clear_target_synced_preserves_prepared_png_metadata(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket-name|gallery/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            record = upload_r2.get_file_cache_record(cache_data, 'image.png', initialize=True)
            record['prepared_png'] = {
                'sha256': 'abc123',
                'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                'prepared_size': 42,
            }

            changed = upload_r2.clear_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
            )

        self.assertTrue(changed)
        self.assertIn('image.png', cache_data['files'])
        self.assertNotIn('targets', cache_data['files']['image.png'])
        self.assertIn('source', cache_data['files']['image.png'])
        self.assertIn('prepared_png', cache_data['files']['image.png'])
```

- [ ] **Step 2: Write the failing skip-log regression tests**

In `tests/test_upload_r2.py`, update the two existing verify-remote Linux hit tests so they require hidden skip lines, and append a focused unit test near the existing `ApplyUploadResultTests`:

```python
self.assertNotIn('[LINUX] SKIP verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg', logs)
self.assertIn('Finished. Uploaded: 0, Skipped: 1, Failed: 0', logs)
```

```python
self.assertNotIn('[LINUX] SKIP verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg', logs)
self.assertIn('Finished. Uploaded: 2, Skipped: 1, Failed: 0', logs)
```

```python
class ApplyUploadResultLoggingTests(unittest.TestCase):
    def test_apply_upload_result_can_skip_per_item_skip_log(self):
        messages = []
        counters = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}

        changed = upload_r2.apply_upload_result(
            target_label='linux',
            path=None,
            result=('skipped', 'SKIP image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg', False, None),
            counters=counters,
            on_message=messages.append,
            on_cache_update=lambda **kwargs: False,
            emit_skipped_message=False,
        )

        self.assertFalse(changed)
        self.assertEqual([], messages)
        self.assertEqual(1, counters['skipped'])
```

- [ ] **Step 3: Run the focused cache/logging tests and verify they fail**

Run:

```bash
python -m unittest tests.test_upload_r2.TargetSyncStateRemovalTests tests.test_upload_r2.ApplyUploadResultLoggingTests tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_with_verify_remote_linux_password_batch_hit_reports_skipped_without_batch_upload tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_with_verify_remote_all_mode_linux_password_batch_hit_reports_skipped -v
```

Expected:

- The removal tests fail because `clear_target_synced()` does not exist.
- The logging test fails because `apply_upload_result()` does not accept `emit_skipped_message`.
- The two verify-remote tests fail because `run_upload()` still emits per-item skip lines.

- [ ] **Step 4: Implement `clear_target_synced()` and make skip-message emission configurable**

In `upload_r2.py`, insert the new cache helper right after `get_file_cache_record()`:

```python
def clear_target_synced(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    target_label: str,
) -> bool:
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    files = cache_data.get('files')
    if not isinstance(files, dict):
        return False

    record = files.get(relative_path)
    if not isinstance(record, dict):
        return False

    targets = record.get('targets')
    if not isinstance(targets, dict) or target_label not in targets:
        return False

    del targets[target_label]
    if not targets:
        record.pop('targets', None)
        if 'prepared_png' not in record:
            record.pop('source', None)

    if not record:
        files.pop(relative_path, None)
    return True
```

Then replace `apply_upload_result()` with this version:

```python
def apply_upload_result(
    *,
    target_label: str,
    path: Path | None,
    result: tuple[str, str, bool, str | None],
    counters: dict[str, int],
    on_message,
    on_cache_update,
    emit_skipped_message: bool = True,
) -> bool:
    status, message, compressed, compression_strategy = result
    if status != 'skipped' or emit_skipped_message:
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

Finally, in `run_upload()`, add a local helper and route every loop through it so upload mode records skipped results without printing them:

```python
    def record_upload_result(
        target_label: str,
        path: Path | None,
        result: tuple[str, str, bool, str | None],
    ) -> bool:
        return apply_upload_result(
            target_label=target_label,
            path=path,
            result=result,
            counters=counters,
            on_message=lambda message: emit_message(message, log_callback),
            on_cache_update=maybe_update_cache_for_path,
            emit_skipped_message=False,
        )
```

Replace the loop section with this exact block:

```python
    if batch_linux_enabled and args.dry_run:
        results = [
            (
                'dry-run',
                f'DRY-RUN {item.source_path.name} -> {config.linux_user}@{config.linux_host}:{build_linux_remote_path(item.source_path, base_dir=folder, remote_dir=config.linux_dir or "")}',
                False,
                None,
            )
            for item in batch_linux_items
        ]
        for path, result in verified_linux_skip_results:
            cache_dirty = record_upload_result('linux', path, result) or cache_dirty
        for item, result in zip(batch_linux_items, results):
            cache_dirty = record_upload_result('linux', item.source_path, unpack_upload_result(item.source_path, result)) or cache_dirty
        verified_linux_skip_results = []
        batch_linux_items = []
```

```python
    for path, result in skipped_r2_results:
        cache_dirty = record_upload_result('r2', path, result) or cache_dirty
    for path, result in batched_r2_results:
        cache_dirty = record_upload_result('r2', path, unpack_upload_result(path, result)) or cache_dirty
    for path, result in skipped_qiniu_results:
        cache_dirty = record_upload_result('qiniu', path, result) or cache_dirty
    for path, result in batched_qiniu_results:
        cache_dirty = record_upload_result('qiniu', path, unpack_upload_result(path, result)) or cache_dirty
    for path, result in verified_linux_skip_results:
        cache_dirty = record_upload_result('linux', path, result) or cache_dirty
    for path, result in batched_linux_results:
        cache_dirty = record_upload_result('linux', path, unpack_upload_result(path, result)) or cache_dirty
```

- [ ] **Step 5: Run the focused cache/logging tests again and verify they pass**

Run:

```bash
python -m unittest tests.test_upload_r2.TargetSyncStateRemovalTests tests.test_upload_r2.ApplyUploadResultLoggingTests tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_with_verify_remote_linux_password_batch_hit_reports_skipped_without_batch_upload tests.test_upload_r2.PendingUploadPlanningTests.test_run_upload_with_verify_remote_all_mode_linux_password_batch_hit_reports_skipped -v
```

Expected: all tests pass, and the two integration tests still show the final `Skipped` count without any per-item skip line.

- [ ] **Step 6: Verification checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2.TargetSyncStateRemovalTests tests.test_upload_r2.ApplyUploadResultLoggingTests -v
```

Expected: all 4 tests pass.

### Task 3: Add `--sync-cache-only` end-to-end cache rebuild mode for all targets

**Files:**
- Modify: `tests/test_upload_r2.py:1287-1380` (reuse the existing runtime-config style as reference)
- Modify: `tests/test_upload_r2.py:2620-2754` (append new sync-cache-only integration tests after the run-upload cache regressions)
- Modify: `upload_r2.py:2210-2805`

- [ ] **Step 1: Write the failing `sync-cache-only` integration test**

Append this class in `tests/test_upload_r2.py` after `RunUploadCacheWriteRegressionTests`:

```python
class RunUploadSyncCacheOnlyTests(unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'dir': None,
            'env_file': None,
            'recursive': False,
            'refresh_cache': False,
            'dry_run': False,
            'no_skip_existing': False,
            'workers': 1,
            'target': 'all',
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
            'verify_remote': False,
            'sync_cache_only': False,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def make_runtime_config(self, **overrides):
        values = {
            'target': 'all',
            'bucket': 'bucket-name',
            'prefix': 'gallery',
            'region': 'auto',
            'endpoint': 'https://example.invalid',
            'r2_proxy': None,
            'linux_host': 'linux-host',
            'linux_user': 'linux-user',
            'linux_dir': '/srv/gallery',
            'linux_key': None,
            'linux_password': 'secret',
            'linux_port': 22,
            'linux_proxy': None,
            'qiniu_bucket': 'qiniu-bucket',
            'qiniu_prefix': 'gallery',
            'qiniu_access_key': 'qiniu-access',
            'qiniu_secret_key': 'qiniu-secret',
            'access_key': 'r2-access',
            'secret_key': 'r2-secret',
        }
        values.update(overrides)
        return upload_r2.UploadRuntimeConfig(**values)

    def test_run_upload_sync_cache_only_rebuilds_all_targets_without_uploading(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            present_path = folder / 'present.jpg'
            missing_path = folder / 'missing.jpg'
            present_path.write_bytes(b'present-bytes')
            missing_path.write_bytes(b'missing-bytes')
            args = self.make_args(dir=str(folder), target='all', sync_cache_only=True)
            config = self.make_runtime_config(target='all')
            cache_data = upload_r2.build_empty_upload_cache()
            logs = []

            upload_r2.set_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )
            upload_r2.set_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )
            upload_r2.set_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='qiniu',
                target_id=upload_r2.build_qiniu_cache_key('qiniu-bucket', 'gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )

            linux_skip_result = (
                'skipped',
                'SKIP present.jpg -> linux-user@linux-host:/srv/gallery/present.jpg',
                False,
                None,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[present_path, missing_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys', return_value=({'gallery/present.jpg'}, None)) as list_r2_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=({'gallery/present.jpg'}, None)) as list_qiniu_mock, \
                 patch('upload_r2.precheck_pending_linux_items', return_value=({'/srv/gallery/present.jpg'}, [(present_path, linux_skip_result)], 1)) as linux_precheck_mock, \
                 patch('upload_r2.upload_pending_r2_files') as batch_r2_mock, \
                 patch('upload_r2.upload_pending_qiniu_files') as batch_qiniu_mock, \
                 patch('upload_r2.upload_pending_linux_files') as batch_linux_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock:
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

        self.assertEqual(0, exit_code)
        self.assertEqual(['gallery/present.jpg', 'gallery/missing.jpg'], list_r2_mock.call_args.kwargs['object_keys'])
        self.assertEqual(
            ('qiniu-bucket', ['gallery/present.jpg', 'gallery/missing.jpg'], 'qiniu-access', 'qiniu-secret'),
            list_qiniu_mock.call_args.args,
        )
        linux_precheck_mock.assert_called_once()
        batch_r2_mock.assert_not_called()
        batch_qiniu_mock.assert_not_called()
        batch_linux_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(
            upload_r2.is_target_synced(
                cache_data,
                present_path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/present.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertFalse(
            upload_r2.is_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertTrue(
            upload_r2.is_target_synced(
                cache_data,
                present_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/present.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertFalse(
            upload_r2.is_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertTrue(
            upload_r2.is_target_synced(
                cache_data,
                present_path,
                base_dir=folder,
                target_label='qiniu',
                target_id=upload_r2.build_qiniu_cache_key('qiniu-bucket', 'gallery/present.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertFalse(
            upload_r2.is_target_synced(
                cache_data,
                missing_path,
                base_dir=folder,
                target_label='qiniu',
                target_id=upload_r2.build_qiniu_cache_key('qiniu-bucket', 'gallery/missing.jpg'),
                compressed=False,
                compression_strategy=None,
            )
        )
        self.assertFalse(any('[LINUX] SKIP' in message for message in logs))
        self.assertIn('Mode: sync-cache-only', logs)
        self.assertIn('R2 cache sync: remote present 1, updated 1, removed 1, unchanged 0, failed 0', logs)
        self.assertIn('Linux cache sync: remote present 1, updated 1, removed 1, unchanged 0, failed 0', logs)
        self.assertIn('Qiniu cache sync: remote present 1, updated 1, removed 1, unchanged 0, failed 0', logs)
        self.assertIn('Finished. Cache sync completed. Failed: 0', logs)
        save_mock.assert_called_once()

    def test_run_upload_sync_cache_only_with_refresh_cache_persists_rebuilt_state(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'present.jpg'
            path.write_bytes(b'present-bytes')
            args = self.make_args(dir=str(folder), target='r2', sync_cache_only=True, refresh_cache=True)
            config = self.make_runtime_config(target='r2')
            logs = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys', return_value=({'gallery/present.jpg'}, None)):
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

        self.assertEqual(0, exit_code)
        save_mock.assert_called_once()
        self.assertIn('R2 cache sync: remote present 1, updated 1, removed 0, unchanged 0, failed 0', logs)
```

- [ ] **Step 2: Run the sync-cache-only test and verify it fails**

Run:

```bash
python -m unittest tests.test_upload_r2.RunUploadSyncCacheOnlyTests -v
```

Expected: both tests fail because `run_upload()` has no `sync-cache-only` branch, still enters upload-mode logic, and still tries to call upload helpers or produce upload-style logging.

- [ ] **Step 3: Implement `run_sync_cache_only()` and wire it into `run_upload()`**

In `upload_r2.py`, add this helper right before `run_upload()`:

```python
def run_sync_cache_only(
    *,
    config: UploadRuntimeConfig,
    folder: Path,
    files: list[Path],
    cache_file: Path,
    cache_data: dict,
    log_callback=None,
) -> int:
    target_labels = targets_for_mode(config.target)
    normalized_prefix = config.prefix.strip('/')
    normalized_qiniu_prefix = config.qiniu_prefix.strip('/')
    cache_dirty = False

    emit_message('Mode: sync-cache-only', log_callback)

    def log_summary(label: str, *, present: int, updated: int, removed: int, unchanged: int, failed: int) -> None:
        emit_message(
            f'{label} cache sync: remote present {present}, updated {updated}, removed {removed}, unchanged {unchanged}, failed {failed}',
            log_callback,
        )

    if 'r2' in target_labels:
        object_keys = [build_object_key(path, base_dir=folder, prefix=normalized_prefix) for path in files]
        existing_keys, list_error = list_existing_keys(
            endpoint=config.endpoint,
            bucket=config.bucket,
            prefix=normalized_prefix,
            access_key=config.access_key or '',
            secret_key=config.secret_key or '',
            region=config.region,
            proxy_url=config.r2_proxy,
            object_keys=object_keys,
        )
        if list_error:
            emit_message(f'Failed to list existing objects: {list_error}', log_callback, stream=sys.stderr)
            return 1

        present = updated = removed = unchanged = 0
        for path in files:
            object_key = build_object_key(path, base_dir=folder, prefix=normalized_prefix)
            compressed, compression_strategy = get_expected_upload_cache_semantics(path)
            target_id = build_r2_cache_key(config.bucket, object_key)
            if object_key in existing_keys:
                present += 1
                if is_target_synced(
                    cache_data,
                    path,
                    base_dir=folder,
                    target_label='r2',
                    target_id=target_id,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                ):
                    unchanged += 1
                else:
                    set_target_synced(
                        cache_data,
                        path,
                        base_dir=folder,
                        target_label='r2',
                        target_id=target_id,
                        compressed=compressed,
                        compression_strategy=compression_strategy,
                    )
                    cache_dirty = True
                    updated += 1
            else:
                if clear_target_synced(cache_data, path, base_dir=folder, target_label='r2'):
                    cache_dirty = True
                    removed += 1
                else:
                    unchanged += 1
        log_summary('R2', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    if 'linux' in target_labels:
        planned_files = [
            PlannedUpload(
                source_path=path,
                relative_path=build_cache_relative_path(path, base_dir=folder),
                compressed=get_expected_upload_cache_semantics(path)[0],
                compression_strategy=get_expected_upload_cache_semantics(path)[1],
            )
            for path in files
        ]
        try:
            existing_linux_paths, _, confirmed = precheck_pending_linux_items(
                planned_files,
                base_dir=folder,
                config=config,
            )
        except RuntimeError as exc:
            emit_message(format_result_message('linux', str(exc)), log_callback)
            return 1

        present = updated = removed = unchanged = 0
        for path in files:
            remote_path = build_linux_remote_path(path, base_dir=folder, remote_dir=config.linux_dir or '')
            compressed, compression_strategy = get_expected_upload_cache_semantics(path)
            target_id = build_linux_cache_key(config.linux_host or '', remote_path)
            if remote_path in existing_linux_paths:
                present += 1
                if is_target_synced(
                    cache_data,
                    path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=target_id,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                ):
                    unchanged += 1
                else:
                    set_target_synced(
                        cache_data,
                        path,
                        base_dir=folder,
                        target_label='linux',
                        target_id=target_id,
                        compressed=compressed,
                        compression_strategy=compression_strategy,
                    )
                    cache_dirty = True
                    updated += 1
            else:
                if clear_target_synced(cache_data, path, base_dir=folder, target_label='linux'):
                    cache_dirty = True
                    removed += 1
                else:
                    unchanged += 1
        log_summary('Linux', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    if 'qiniu' in target_labels:
        object_keys = [build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix) for path in files]
        existing_keys, list_error = list_existing_qiniu_keys(
            config.qiniu_bucket,
            object_keys,
            config.qiniu_access_key or '',
            config.qiniu_secret_key or '',
        )
        if list_error:
            emit_message(f'Failed to list existing Qiniu objects: {list_error}', log_callback, stream=sys.stderr)
            return 1

        present = updated = removed = unchanged = 0
        for path in files:
            object_key = build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix)
            compressed, compression_strategy = get_expected_upload_cache_semantics(path)
            target_id = build_qiniu_cache_key(config.qiniu_bucket, object_key)
            if object_key in existing_keys:
                present += 1
                if is_target_synced(
                    cache_data,
                    path,
                    base_dir=folder,
                    target_label='qiniu',
                    target_id=target_id,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                ):
                    unchanged += 1
                else:
                    set_target_synced(
                        cache_data,
                        path,
                        base_dir=folder,
                        target_label='qiniu',
                        target_id=target_id,
                        compressed=compressed,
                        compression_strategy=compression_strategy,
                    )
                    cache_dirty = True
                    updated += 1
            else:
                if clear_target_synced(cache_data, path, base_dir=folder, target_label='qiniu'):
                    cache_dirty = True
                    removed += 1
                else:
                    unchanged += 1
        log_summary('Qiniu', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    if cache_dirty:
        save_upload_cache(cache_file, cache_data)
    emit_message('Finished. Cache sync completed. Failed: 0', log_callback)
    return 0
```

Then update the top of `run_upload()` so `sync-cache-only` requires remote credentials and exits through the new branch before any upload scheduling:

```python
def run_upload(args, log_callback=None) -> int:
    env_candidates: list[Path] = []
    if args.env_file:
        env_candidates.append(Path(args.env_file))
    else:
        env_candidates.extend([
            Path('.env'),
            Path('.env.local'),
            Path('upload_r2.env'),
            Path('r2.env'),
        ])
    for candidate in env_candidates:
        load_env_file(candidate)

    config = resolve_runtime_config(args)
    normalized_target = config.target
    sync_cache_only = getattr(args, 'sync_cache_only', False)
    needs_remote_access = sync_cache_only or not args.dry_run

    folder = Path(args.dir).resolve()
    if not folder.exists() or not folder.is_dir():
        emit_message(f'Folder not found: {folder}', log_callback, stream=sys.stderr)
        return 2

    files = collect_files(folder, args.recursive)
    cache_file = get_cache_file_path()
    refresh_cache = getattr(args, 'refresh_cache', False)
    cache_data = build_empty_upload_cache() if refresh_cache else load_upload_cache(cache_file)
    cache_dirty = False
    if refresh_cache:
        cache_dirty = True
    if not files:
        if cache_dirty:
            save_upload_cache(cache_file, cache_data)
        emit_message(f'No image files found in {folder}', log_callback)
        return 0

    emit_message(f'Found {len(files)} image file(s) in {folder}', log_callback)
    emit_message(f'Target: {normalized_target}', log_callback)

    normalized_prefix = config.prefix.strip('/')
    normalized_qiniu_prefix = config.qiniu_prefix.strip('/')

    if normalized_target in {'r2', 'all'}:
        if needs_remote_access and not config.endpoint:
            emit_message('Missing R2 endpoint. Set --endpoint, R2_ENDPOINT, or CLOUDFLARE_ACCOUNT_ID.', log_callback, stream=sys.stderr)
            return 2
        if needs_remote_access and (not config.access_key or not config.secret_key):
            emit_message('Missing R2 credentials. Set them in env or an env file using CLOUDFLARE_R2_ACCESS_KEY_ID/CLOUDFLARE_R2_SECRET_ACCESS_KEY or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.', log_callback, stream=sys.stderr)
            return 2

    if normalized_target in {'linux', 'all'} and (
        not config.linux_host
        or not config.linux_user
        or not config.linux_dir
        or (not config.linux_key and not config.linux_password)
    ):
        emit_message('Missing Linux upload config. Set --linux-host, --linux-user, --linux-dir, and either --linux-key or --linux-password, or matching env vars.', log_callback, stream=sys.stderr)
        return 2

    if normalized_target in {'qiniu', 'all'}:
        if not config.qiniu_bucket:
            emit_message('Missing Qiniu bucket. Set --qiniu-bucket, QINIU_BUCKET, or --bucket.', log_callback, stream=sys.stderr)
            return 2
        if needs_remote_access and (not config.qiniu_access_key or not config.qiniu_secret_key):
            emit_message('Missing Qiniu credentials. Set QINIU_ACCESS_KEY and QINIU_SECRET_KEY.', log_callback, stream=sys.stderr)
            return 2

    if sync_cache_only:
        return run_sync_cache_only(
            config=config,
            folder=folder,
            files=files,
            cache_file=cache_file,
            cache_data=cache_data,
            log_callback=log_callback,
        )
```

- [ ] **Step 4: Run the sync-cache-only test again and verify it passes**

Run:

```bash
python -m unittest tests.test_upload_r2.RunUploadSyncCacheOnlyTests -v
```

Expected: the test passes and proves that `run_upload()` rebuilt cache state without calling any upload helper.

- [ ] **Step 5: Verification checkpoint**

Run:

```bash
python -m unittest tests.test_upload_r2.RunUploadSyncCacheOnlyTests tests.test_upload_r2.CliParserTests tests.test_upload_r2.TargetSyncStateRemovalTests tests.test_upload_r2.ApplyUploadResultLoggingTests -v
```

Expected: all focused feature tests pass.

### Task 4: Run the final regression sweep and manual CLI verification

**Files:**
- Test: `tests/test_upload_r2.py`
- Test: `upload_r2.py`

- [ ] **Step 1: Run the focused upload/cache regression cluster**

Run:

```bash
python -m unittest tests.test_upload_r2.PendingUploadPlanningTests tests.test_upload_r2.RunUploadCacheWriteRegressionTests tests.test_upload_r2.RunUploadSyncCacheOnlyTests tests.test_upload_r2.CliParserTests tests.test_upload_r2.TargetSyncStateRemovalTests tests.test_upload_r2.ApplyUploadResultLoggingTests -v
```

Expected: pass. This confirms parser changes, skip-log suppression, cache removal, and sync-cache-only mode all work together.

- [ ] **Step 2: Run the full Python test file**

Run:

```bash
python -m unittest tests.test_upload_r2 -v
```

Expected: pass. No existing cache, upload, Linux, PNG, or runtime-config regressions.

- [ ] **Step 3: Manually inspect the final help output**

Run:

```bash
python upload_r2.py --help
```

Expected output characteristics:

- top description is Chinese,
- sections are `通用参数`, `R2 参数`, `Linux 参数`, `七牛参数`,
- `--sync-cache-only` appears under `通用参数`,
- existing flags keep their original option names.

- [ ] **Step 4: Manually inspect sync-cache-only argument validation**

Run:

```bash
python upload_r2.py --sync-cache-only --dry-run
```

Expected: exit code `2` and the message `--sync-cache-only 不能与 --dry-run 同时使用。`

Run:

```bash
python upload_r2.py --sync-cache-only --verify-remote
```

Expected: exit code `2` and the message `--sync-cache-only 不能与 --verify-remote 同时使用。`

- [ ] **Step 5: Verification checkpoint**

Record the three exact commands and their outputs in the task log / review notes before handing back the branch.
