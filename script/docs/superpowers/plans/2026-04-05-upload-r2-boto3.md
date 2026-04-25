# upload_r2.py boto3 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Cloudflare R2 `urllib` + manual SigV4 code in `upload_r2.py` with `boto3` while preserving the current CLI behavior and leaving Linux uploads unchanged.

**Architecture:** Add a small `make_r2_client()` factory that centralizes the R2 S3 client configuration, then route `list_existing_keys()` and `upload_to_r2()` through that client. Keep the rest of the script stable, and lock the migration down with focused `unittest` regression tests that fail if `urllib` is still used for R2 operations.

**Tech Stack:** Python 3.13, boto3/botocore, paramiko, unittest, Cloudflare R2 S3-compatible API

---

## File Map

- `upload_r2.py` — existing CLI script; modify imports, add `make_r2_client()`, replace R2 list/upload logic, remove dead SigV4 helpers.
- `requirements.txt` — new dependency manifest for third-party runtime packages used by the script.
- `tests/test_upload_r2.py` — new regression tests for R2 client creation, object listing, and object upload behavior.

## Notes

- The current working directory is **not** a git repository, so this plan uses verification checkpoints instead of commit steps.
- Keep all existing CLI flags, environment variable names, status strings, and Linux upload code paths unchanged.
- Do **not** add a fallback `urllib` path. The migration is all-in on `boto3` for R2.

### Task 1: Add boto3 dependency and the R2 client factory

**Files:**
- Create: `requirements.txt`
- Create: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:1-15`

- [ ] **Step 1: Write the failing test for `make_r2_client()`**

Add this to `tests/test_upload_r2.py`:

```python
import unittest
from unittest.mock import Mock, patch

import upload_r2


class MakeR2ClientTests(unittest.TestCase):
    def test_make_r2_client_builds_s3_client_with_r2_settings(self):
        fake_boto3 = Mock()
        fake_boto3.client.return_value = object()

        with patch.object(upload_r2, 'boto3', fake_boto3, create=True):
            client = upload_r2.make_r2_client(
                endpoint='https://example.r2.cloudflarestorage.com',
                access_key='ak',
                secret_key='sk',
                region='auto',
            )

        self.assertIs(client, fake_boto3.client.return_value)
        fake_boto3.client.assert_called_once()
        args, kwargs = fake_boto3.client.call_args
        self.assertEqual(args, ('s3',))
        self.assertEqual(kwargs['endpoint_url'], 'https://example.r2.cloudflarestorage.com')
        self.assertEqual(kwargs['aws_access_key_id'], 'ak')
        self.assertEqual(kwargs['aws_secret_access_key'], 'sk')
        self.assertEqual(kwargs['region_name'], 'auto')
        self.assertEqual(kwargs['config'].signature_version, 's3v4')
        self.assertEqual(kwargs['config'].retries['mode'], 'standard')
        self.assertEqual(kwargs['config'].retries['total_max_attempts'], 10)
```

- [ ] **Step 2: Run the test and verify it fails for the right reason**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `ERROR` or `FAIL` mentioning `module 'upload_r2' has no attribute 'make_r2_client'`.

- [ ] **Step 3: Create the dependency manifest**

Create `requirements.txt` with:

```txt
boto3
paramiko
```

- [ ] **Step 4: Install dependencies into the current environment**

Run:

```bash
python -m pip install -r requirements.txt
```

Expected: pip reports `Successfully installed boto3 ...` or shows `Requirement already satisfied` for both packages.

- [ ] **Step 5: Implement the minimal R2 client factory**

Update the imports in `upload_r2.py` and add `make_r2_client()` near the other small helpers:

```python
import boto3
from botocore.config import Config
```

```python
def make_r2_client(*, endpoint: str, access_key: str, secret_key: str, region: str):
    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(
            signature_version='s3v4',
            retries={
                'mode': 'standard',
                'total_max_attempts': 10,
            },
        ),
    )
```

- [ ] **Step 6: Run the test again and verify it passes**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `ok` for `test_make_r2_client_builds_s3_client_with_r2_settings`.

### Task 2: Migrate `list_existing_keys()` to boto3

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:146-205`

- [ ] **Step 1: Write the failing test for boto3-based listing**

Append this to `tests/test_upload_r2.py`:

```python
class FakePaginator:
    def __init__(self, pages):
        self.pages = pages
        self.calls = []

    def paginate(self, **kwargs):
        self.calls.append(kwargs)
        return iter(self.pages)


class FakeListClient:
    def __init__(self, pages):
        self.paginator = FakePaginator(pages)

    def get_paginator(self, name):
        if name != 'list_objects_v2':
            raise AssertionError(name)
        return self.paginator


class ListExistingKeysTests(unittest.TestCase):
    def test_list_existing_keys_uses_boto3_and_collects_all_pages(self):
        fake_client = FakeListClient([
            {'Contents': [{'Key': 'gallery/a.png'}]},
            {'Contents': [{'Key': 'gallery/b.png'}]},
        ])

        with patch.object(upload_r2, 'make_r2_client', return_value=fake_client), \
             patch.object(upload_r2.request, 'urlopen', side_effect=AssertionError('urllib should not be used')):
            keys, err = upload_r2.list_existing_keys(
                endpoint='https://example.r2.cloudflarestorage.com',
                bucket='static-bucket',
                prefix='gallery',
                access_key='ak',
                secret_key='sk',
                region='auto',
            )

        self.assertIsNone(err)
        self.assertEqual(keys, {'gallery/a.png', 'gallery/b.png'})
        self.assertEqual(
            fake_client.paginator.calls,
            [{'Bucket': 'static-bucket', 'Prefix': 'gallery/'}],
        )
```

- [ ] **Step 2: Run the new test and verify it fails because the old code still uses `urllib`**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `FAIL` mentioning `AssertionError: urllib should not be used` in `test_list_existing_keys_uses_boto3_and_collects_all_pages`.

- [ ] **Step 3: Replace the list implementation with boto3 pagination**

Replace `list_existing_keys()` in `upload_r2.py` with:

```python
def list_existing_keys(
    *,
    endpoint: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    region: str,
) -> tuple[set[str], str | None]:
    existing_keys: set[str] = set()

    try:
        client = make_r2_client(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
        )
        params = {'Bucket': bucket}
        if prefix:
            params['Prefix'] = prefix if prefix.endswith('/') else f'{prefix}/'

        paginator = client.get_paginator('list_objects_v2')
        for page in paginator.paginate(**params):
            for item in page.get('Contents', []):
                key = item.get('Key')
                if key:
                    existing_keys.add(key)
        return existing_keys, None
    except Exception as exc:
        return existing_keys, str(exc)
```

- [ ] **Step 4: Run the test again and verify it passes**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: both Task 1 and Task 2 tests report `ok`.

### Task 3: Migrate `upload_to_r2()` to boto3

**Files:**
- Modify: `tests/test_upload_r2.py`
- Modify: `upload_r2.py:214-262`

- [ ] **Step 1: Write the failing success-path upload test**

Append this to `tests/test_upload_r2.py`:

```python
import tempfile
from pathlib import Path
```

```python
class FakePutClient:
    def __init__(self):
        self.calls = []

    def put_object(self, **kwargs):
        self.calls.append(kwargs)
        return {'ETag': '"etag"'}


class UploadToR2Tests(unittest.TestCase):
    def test_upload_to_r2_uses_boto3_put_object(self):
        fake_client = FakePutClient()

        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2, 'make_r2_client', return_value=fake_client), \
                 patch.object(upload_r2.request, 'urlopen', side_effect=AssertionError('urllib should not be used')):
                status, message = upload_r2.upload_to_r2(
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

        self.assertEqual(status, 'uploaded')
        self.assertEqual(message, 'OK image.png -> s3://static-bucket/gallery/image.png')
        self.assertEqual(fake_client.calls[0]['Bucket'], 'static-bucket')
        self.assertEqual(fake_client.calls[0]['Key'], 'gallery/image.png')
        self.assertEqual(fake_client.calls[0]['Body'], b'png-bytes')
        self.assertEqual(fake_client.calls[0]['ContentType'], 'image/png')
```

- [ ] **Step 2: Run the upload test and verify it fails because `urllib` is still being called**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `FAIL` mentioning `AssertionError: urllib should not be used` in `test_upload_to_r2_uses_boto3_put_object`.

- [ ] **Step 3: Implement the minimal success-path boto3 upload**

Replace the request-building portion of `upload_to_r2()` with this minimal implementation:

```python
def upload_to_r2(
    path: Path,
    *,
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
) -> tuple[str, str]:
    key = build_object_key(path, base_dir=base_dir, prefix=prefix)

    if dry_run:
        return 'dry-run', f'DRY-RUN {path.name} -> s3://{bucket}/{key}'

    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'SKIP {path.name} -> s3://{bucket}/{key}'

    data = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    client = make_r2_client(
        endpoint=endpoint,
        access_key=access_key,
        secret_key=secret_key,
        region=region,
    )
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )
    return 'uploaded', f'OK {path.name} -> s3://{bucket}/{key}'
```

- [ ] **Step 4: Run the upload test again and verify the success path passes**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `ok` for the upload success-path test.

- [ ] **Step 5: Write the failing error-path upload test**

Append this to `tests/test_upload_r2.py`:

```python
class BrokenPutClient:
    def put_object(self, **kwargs):
        raise RuntimeError('boom')


class UploadToR2ErrorTests(unittest.TestCase):
    def test_upload_to_r2_returns_failed_status_when_boto3_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            image_path = base_dir / 'image.png'
            image_path.write_bytes(b'png-bytes')

            with patch.object(upload_r2, 'make_r2_client', return_value=BrokenPutClient()):
                status, message = upload_r2.upload_to_r2(
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

        self.assertEqual(status, 'failed')
        self.assertEqual(message, 'ERR image.png: boom')
```

- [ ] **Step 6: Run the error-path test and verify it fails by raising `RuntimeError: boom`**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: `ERROR` in `test_upload_to_r2_returns_failed_status_when_boto3_raises` because the minimal success-path implementation still lets the exception escape.

- [ ] **Step 7: Wrap boto3 upload failures and restore the script’s existing message contract**

Tighten `upload_to_r2()` to:

```python
    try:
        client = make_r2_client(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
        )
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
        return 'uploaded', f'OK {path.name} -> s3://{bucket}/{key}'
    except Exception as exc:
        return 'failed', f'ERR {path.name}: {exc}'
```

- [ ] **Step 8: Run the full test file and verify all upload tests pass**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: all tests from Tasks 1-3 report `ok`.

### Task 4: Remove dead urllib/SigV4 code and run final verification

**Files:**
- Modify: `upload_r2.py:1-15`
- Modify: `upload_r2.py:55-137`
- Modify: `upload_r2.py:146-262`
- Modify: `tests/test_upload_r2.py`

- [ ] **Step 1: Remove the now-unused manual signing helpers and dead imports**

Delete these unused imports from `upload_r2.py`:

```python
import hashlib
import hmac
from urllib import error, parse, request
import xml.etree.ElementTree as ET
```

Keep this import because `build_object_url()` and `build_object_key()` still use it:

```python
from urllib import parse
```

Delete these helper functions entirely because boto3 replaces them:

```python
def sha256_hex(data: bytes) -> str:
    ...


def hmac_sha256(key: bytes, msg: str) -> bytes:
    ...


def sign_v4_headers(...):
    ...
```

- [ ] **Step 2: Remove any leftover `urllib`-based R2 request code paths**

After cleanup, `upload_r2.py` should still contain:

```python
def make_r2_client(...):
    ...


def list_existing_keys(...):
    ...


def upload_to_r2(...):
    ...
```

and should **not** contain any remaining `request.urlopen(` calls for R2 work.

- [ ] **Step 3: Run the regression test suite one last time**

Run:

```bash
python -m unittest discover -s tests -p "test_upload_r2.py" -v
```

Expected: all tests pass with no errors.

- [ ] **Step 4: Run a read-only smoke test against the real R2 list path**

Run:

```bash
python - <<'PY'
from pathlib import Path
import upload_r2

for candidate in [Path('.env'), Path('.env.local'), Path('upload_r2.env'), Path('r2.env')]:
    upload_r2.load_env_file(candidate)

bucket = upload_r2.env_first('R2_BUCKET') or upload_r2.DEFAULT_BUCKET
prefix = (upload_r2.env_first('R2_PREFIX') or upload_r2.DEFAULT_PREFIX).strip('/')
region = upload_r2.env_first('AWS_REGION', 'AWS_DEFAULT_REGION', 'R2_REGION') or 'auto'
access_key = upload_r2.env_first('CLOUDFLARE_R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID') or ''
secret_key = upload_r2.env_first('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY') or ''
account_id = upload_r2.env_first('CLOUDFLARE_ACCOUNT_ID')
endpoint = upload_r2.env_first('R2_ENDPOINT') or (f'https://{account_id}.r2.cloudflarestorage.com' if account_id else upload_r2.DEFAULT_ENDPOINT)

keys, err = upload_r2.list_existing_keys(
    endpoint=endpoint,
    bucket=bucket,
    prefix=prefix,
    access_key=access_key,
    secret_key=secret_key,
    region=region,
)
print('error:', err)
print('count:', len(keys))
PY
```

Expected: `error: None` and a positive object count.

- [ ] **Step 5: Run a dry-run CLI smoke test to verify the user-facing command still works**

Run:

```bash
python upload_r2.py --target r2 --dry-run --workers 1 --dir .
```

Expected: the script prints the target summary and ends with `Finished. Dry-run: ... , Failed: 0`.
