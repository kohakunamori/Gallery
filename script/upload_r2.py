#!/usr/bin/env python3
import argparse
import boto3
from botocore.config import Config
import concurrent.futures
from dataclasses import dataclass
import json
import hashlib
import mimetypes
import os
from pathlib import Path, PurePosixPath
import paramiko
import shutil
import socks
import subprocess
import sys
import tempfile
from typing import Iterable
from urllib import parse

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.avif', '.heic'}
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE_NAMES = ('upload_r2.env', '.env', '.env.local', 'r2.env')
DEFAULT_BUCKET = 'static-bucket'
DEFAULT_PREFIX = 'gallery'
# No hard-coded Cloudflare account endpoint. Set R2_ENDPOINT or CLOUDFLARE_ACCOUNT_ID.
DEFAULT_ENDPOINT = ''
CACHE_FILE_NAME = '.upload_target_cache.json'
PENDING_CATALOG_FILE_NAME = '.upload_pending_catalog.json'
CACHE_SCHEMA_VERSION = 4
PREPARED_CACHE_DIR_NAME = '.upload_prepared_cache'
PNG_COMPRESSION_STRATEGY = 'oxipng:o_max:z:strip_safe'
AVIF_LOSSLESS_CHROMA = '444'
AVIF_LOSSLESS_CICP = '1/13/0/1'
AVIF_LOSSLESS_COMPRESSION_STRATEGY = 'imagemagick:avif:lossless_rgb:quality_100:chroma_444:cicp_1_13_0_1'
COMPRESSION_MODE_AVIF_LOSSLESS = 'avif-lossless'
COMPRESSION_MODE_PNG = 'png'
COMPRESSION_MODE_NONE = 'none'
DEFAULT_COMPRESSION_MODE = COMPRESSION_MODE_AVIF_LOSSLESS
COMPATIBILITY_COMPRESSION_MODE = COMPRESSION_MODE_PNG
COMPRESSION_MODE_CHOICES = (COMPRESSION_MODE_AVIF_LOSSLESS, COMPRESSION_MODE_PNG, COMPRESSION_MODE_NONE)
SORT_TIME_MODE_UPLOAD = 'upload'
SORT_TIME_MODE_SOURCE_MTIME = 'source-mtime'
SORT_TIME_MODE_CHOICES = (SORT_TIME_MODE_UPLOAD, SORT_TIME_MODE_SOURCE_MTIME)
SORT_TIME_MODE_ENV = 'UPLOAD_SORT_TIME_MODE'
DEFAULT_SORT_TIME_MODE = SORT_TIME_MODE_UPLOAD
AVIF_CONVERTIBLE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'}
AVIF_OUTPUT_SUFFIX = '.avif'
EXISTENCE_CHECK_MAX_WORKERS = 16
PHOTO_CATALOG_ENV = 'PHOTO_CATALOG_PATH'
PHOTO_CATALOG_REMOTE_ENV = 'PHOTO_CATALOG_REMOTE_PATH'
DISCARD_PREPARED_CACHE_ENV = 'UPLOAD_DISCARD_PREPARED_CACHE'
PHOTO_CATALOG_SCHEMA_VERSION = 1
SUBPROCESS_TEXT_KWARGS = {'text': True, 'encoding': 'utf-8', 'errors': 'replace'}


def configure_standard_streams() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8', errors='replace')


configure_standard_streams()


@dataclass(frozen=True)
class PreparedUpload:
    source_path: Path
    upload_path: Path
    temp_path: Path | None = None
    compressed: bool = False
    compression_strategy: str | None = None
    from_cache: bool = False


@dataclass(frozen=True)
class PlannedUpload:
    source_path: Path
    relative_path: str
    compressed: bool
    compression_strategy: str | None


@dataclass(frozen=True)
class UploadRuntimeConfig:
    target: str
    bucket: str
    prefix: str
    region: str
    endpoint: str
    r2_proxy: str | None
    # Catalog SSH only (not image upload)
    linux_host: str | None
    linux_user: str | None
    linux_key: str | None
    linux_password: str | None
    linux_port: int
    linux_proxy: str | None
    access_key: str | None
    secret_key: str | None
    compression: str = COMPATIBILITY_COMPRESSION_MODE
    replace_remote_png: bool = False
    replace_remote_avif: bool = False


def get_upload_cache_semantics(prepared: PreparedUpload | None) -> tuple[bool, str | None]:
    if prepared is None:
        return False, None
    return prepared.compressed, prepared.compression_strategy


def normalize_compression_mode(compression: str | None) -> str:
    if compression in COMPRESSION_MODE_CHOICES:
        return compression
    return DEFAULT_COMPRESSION_MODE


def should_convert_to_avif(path: Path) -> bool:
    return path.suffix.lower() in AVIF_CONVERTIBLE_EXTS


def is_avif_compression_strategy(compression_strategy: str | None) -> bool:
    return compression_strategy == AVIF_LOSSLESS_COMPRESSION_STRATEGY


def get_expected_upload_cache_semantics(
    path: Path,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
) -> tuple[bool, str | None]:
    compression = normalize_compression_mode(compression)
    if compression == COMPRESSION_MODE_AVIF_LOSSLESS and should_convert_to_avif(path):
        return True, AVIF_LOSSLESS_COMPRESSION_STRATEGY
    if compression == COMPRESSION_MODE_PNG and path.suffix.lower() == '.png':
        return True, PNG_COMPRESSION_STRATEGY
    return False, None


def get_cache_file_path() -> Path:
    cache_file = os.getenv('UPLOAD_TARGET_CACHE_FILE')
    if cache_file:
        return Path(cache_file).expanduser().resolve()

    return SCRIPT_DIR / CACHE_FILE_NAME


def get_pending_catalog_file_path() -> Path:
    """Queue of catalog items whose R2 upload succeeded but catalog write may still be pending."""
    pending_file = os.getenv('UPLOAD_PENDING_CATALOG_FILE')
    if pending_file:
        return Path(pending_file).expanduser().resolve()

    cache_file = os.getenv('UPLOAD_TARGET_CACHE_FILE')
    if cache_file:
        return Path(cache_file).expanduser().resolve().with_name(PENDING_CATALOG_FILE_NAME)

    return SCRIPT_DIR / PENDING_CATALOG_FILE_NAME


def load_pending_catalog_items(path: Path | None = None) -> dict[str, dict]:
    pending_path = path or get_pending_catalog_file_path()
    if not pending_path.is_file():
        return {}
    try:
        data = json.loads(pending_path.read_text(encoding='utf-8'))
    except Exception:
        return {}
    items = data.get('items', []) if isinstance(data, dict) else []
    if not isinstance(items, list):
        return {}
    by_path: dict[str, dict] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        item_path = item.get('path')
        if isinstance(item_path, str) and item_path.strip():
            by_path[item_path] = item
    return by_path


def save_pending_catalog_items(items_by_path: dict[str, dict], path: Path | None = None) -> None:
    pending_path = path or get_pending_catalog_file_path()
    pending_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        'version': 1,
        'updatedAt': _utc_now_iso(),
        'items': sorted(items_by_path.values(), key=lambda entry: entry.get('sortTime', ''), reverse=True),
    }
    temp_path = pending_path.with_suffix(pending_path.suffix + '.tmp')
    temp_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + '\n',
        encoding='utf-8',
    )
    os.replace(temp_path, pending_path)


def clear_pending_catalog_items(path: Path | None = None) -> None:
    pending_path = path or get_pending_catalog_file_path()
    try:
        if pending_path.is_file():
            pending_path.unlink()
    except OSError:
        pass


def queue_pending_catalog_items(items: list[dict], path: Path | None = None) -> dict[str, dict]:
    """Merge items into the durable pending queue and persist. Returns full queue by path."""
    pending = load_pending_catalog_items(path)
    for item in items:
        item_path = item.get('path') if isinstance(item, dict) else None
        if isinstance(item_path, str) and item_path:
            pending[item_path] = item
    if pending:
        save_pending_catalog_items(pending, path)
    else:
        clear_pending_catalog_items(path)
    return pending


def get_prepared_cache_dir() -> Path:
    cache_dir = os.getenv('UPLOAD_PREPARED_CACHE_DIR')
    if cache_dir:
        return Path(cache_dir).expanduser().resolve()

    return Path(__file__).resolve().parent / PREPARED_CACHE_DIR_NAME


def get_photo_catalog_path(explicit: str | Path | None = None) -> Path | None:
    """Resolve optional local photos-index.json path.

    Preference: CLI --catalog > PHOTO_CATALOG_PATH (usually from upload_r2.env).
    """
    catalog_path = str(explicit).strip() if explicit is not None else ''
    if not catalog_path:
        catalog_path = (os.getenv(PHOTO_CATALOG_ENV) or '').strip()
    if not catalog_path:
        return None
    return Path(catalog_path).expanduser().resolve()


def get_photo_catalog_remote_path(explicit: str | None = None) -> str | None:
    """Resolve remote photos-index.json path on the gallery server (SFTP).

    Preference: CLI --catalog-remote > PHOTO_CATALOG_REMOTE_PATH.
    Used when the upload script runs on a different machine than the API host.
    """
    remote_path = str(explicit).strip() if explicit is not None else ''
    if not remote_path:
        remote_path = (os.getenv(PHOTO_CATALOG_REMOTE_ENV) or '').strip()
    if not remote_path:
        return None
    # Normalize to posix absolute/relative path string for SFTP.
    return remote_path.replace('\\', '/')


def should_discard_prepared_cache() -> bool:
    value = (os.getenv(DISCARD_PREPARED_CACHE_ENV) or '').strip().lower()
    return value in {'1', 'true', 'yes', 'on'}


def discard_prepared_cache_dir() -> None:
    cache_dir = get_prepared_cache_dir()
    if not cache_dir.exists():
        return
    try:
        shutil.rmtree(cache_dir)
    except Exception:
        # Best-effort cleanup for ephemeral web uploads; callers already delete the batch root.
        pass


def build_empty_photo_catalog() -> dict:
    return {
        'version': PHOTO_CATALOG_SCHEMA_VERSION,
        'updatedAt': _utc_now_iso(),
        'items': [],
    }


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def _mtime_to_sort_time(mtime: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(mtime, timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def resolve_sort_time_mode(cli_value: str | None = None) -> str:
    """Resolve catalog sortTime mode.

    CLI ``--sort-time`` wins when set. Otherwise ``UPLOAD_SORT_TIME_MODE`` is
    read. Invalid or empty values fall back to upload (wall-clock) time.
    """
    if isinstance(cli_value, str):
        normalized = cli_value.strip().lower()
        if normalized in SORT_TIME_MODE_CHOICES:
            return normalized

    env_value = (os.getenv(SORT_TIME_MODE_ENV) or '').strip().lower()
    if env_value in SORT_TIME_MODE_CHOICES:
        return env_value

    return DEFAULT_SORT_TIME_MODE


def read_image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image  # type: ignore
    except Exception:
        Image = None

    if Image is not None:
        try:
            with Image.open(path) as image:
                width, height = image.size
                return int(width), int(height)
        except Exception:
            pass

    # Minimal PNG IHDR / JPEG SOF fallback without extra dependencies.
    try:
        with path.open('rb') as handle:
            header = handle.read(24)
            if header.startswith(b'\x89PNG\r\n\x1a\n') and len(header) >= 24:
                width = int.from_bytes(header[16:20], 'big')
                height = int.from_bytes(header[20:24], 'big')
                return width, height
            if header.startswith(b'\xff\xd8'):
                handle.seek(2)
                while True:
                    marker_prefix = handle.read(1)
                    if marker_prefix != b'\xff':
                        break
                    marker = handle.read(1)
                    if not marker:
                        break
                    marker_code = marker[0]
                    if marker_code in {0xC0, 0xC1, 0xC2}:
                        segment = handle.read(7)
                        if len(segment) < 7:
                            break
                        height = int.from_bytes(segment[3:5], 'big')
                        width = int.from_bytes(segment[5:7], 'big')
                        return width, height
                    if marker_code in {0xD8, 0xD9}:
                        continue
                    length_bytes = handle.read(2)
                    if len(length_bytes) < 2:
                        break
                    length = int.from_bytes(length_bytes, 'big')
                    if length < 2:
                        break
                    handle.seek(length - 2, os.SEEK_CUR)
    except Exception:
        pass

    return None, None


def build_photo_catalog_item(
    source_path: Path,
    *,
    relative_path: str,
    upload_path: Path | None = None,
    sort_time_mode: str | None = None,
) -> dict:
    normalized_path = str(PurePosixPath(relative_path.lstrip('/')))
    stat_path = upload_path if upload_path is not None and upload_path.is_file() else source_path
    size = stat_path.stat().st_size if stat_path.is_file() else source_path.stat().st_size
    mtime = source_path.stat().st_mtime
    # None resolves via UPLOAD_SORT_TIME_MODE env, then defaults to upload-time.
    mode = resolve_sort_time_mode(sort_time_mode)
    # Default product rule: sortTime is upload/catalog-write time so newest sort
    # surfaces just-published works. source-mtime restores prior chronology.
    if mode == SORT_TIME_MODE_SOURCE_MTIME:
        sort_time = _mtime_to_sort_time(mtime)
    else:
        sort_time = _utc_now_iso()
    width, height = read_image_dimensions(source_path)
    version = hashlib.sha1(f'{normalized_path}|{mtime}|{size}'.encode('utf-8')).hexdigest()
    return {
        'path': normalized_path,
        'filename': PurePosixPath(normalized_path).name,
        'takenAt': None,
        'sortTime': sort_time,
        'width': width,
        'height': height,
        'size': int(size),
        'version': version,
    }


def load_photo_catalog(catalog_path: Path) -> dict:
    if not catalog_path.is_file():
        return build_empty_photo_catalog()
    try:
        raw = catalog_path.read_text(encoding='utf-8')
    except Exception:
        return build_empty_photo_catalog()
    return decode_photo_catalog_text(raw)


def decode_photo_catalog_text(raw: str) -> dict:
    try:
        data = json.loads(raw)
    except Exception:
        return build_empty_photo_catalog()
    if not isinstance(data, dict):
        return build_empty_photo_catalog()
    items = data.get('items', [])
    if not isinstance(items, list):
        items = []
    normalized_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        path = item.get('path')
        if not isinstance(path, str) or not path.strip():
            continue
        normalized_path = str(PurePosixPath(path.replace('\\', '/').lstrip('/')))
        normalized_items.append({
            'path': normalized_path,
            'filename': item.get('filename') if isinstance(item.get('filename'), str) and item.get('filename') else PurePosixPath(normalized_path).name,
            'takenAt': item.get('takenAt') if isinstance(item.get('takenAt'), str) else None,
            'sortTime': item.get('sortTime') if isinstance(item.get('sortTime'), str) else _utc_now_iso(),
            'width': item.get('width') if isinstance(item.get('width'), int) else None,
            'height': item.get('height') if isinstance(item.get('height'), int) else None,
            'size': item.get('size') if isinstance(item.get('size'), int) and item.get('size') >= 0 else 0,
            'version': item.get('version') if isinstance(item.get('version'), str) and item.get('version') else hashlib.sha1(normalized_path.encode('utf-8')).hexdigest(),
        })
    return {
        'version': PHOTO_CATALOG_SCHEMA_VERSION,
        'updatedAt': data.get('updatedAt') if isinstance(data.get('updatedAt'), str) else _utc_now_iso(),
        'items': normalized_items,
    }


def merge_photo_catalog_items(catalog: dict, items: list[dict]) -> dict:
    by_path = {item['path']: item for item in catalog.get('items', []) if isinstance(item, dict) and item.get('path')}
    for item in items:
        path = item.get('path') if isinstance(item, dict) else None
        if not isinstance(path, str) or not path:
            continue
        by_path[path] = item
    return {
        'version': PHOTO_CATALOG_SCHEMA_VERSION,
        'updatedAt': _utc_now_iso(),
        'items': sorted(by_path.values(), key=lambda entry: entry.get('sortTime', ''), reverse=True),
    }


def write_photo_catalog(catalog_path: Path, catalog: dict) -> None:
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = catalog_path.with_suffix(catalog_path.suffix + '.tmp')
    temp_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=False) + '\n',
        encoding='utf-8',
    )
    os.replace(temp_path, catalog_path)


def upsert_photo_catalog_items(catalog_path: Path, items: list[dict]) -> None:
    if not items:
        return
    catalog = merge_photo_catalog_items(load_photo_catalog(catalog_path), items)
    write_photo_catalog(catalog_path, catalog)


def has_linux_ssh_credentials(
    *,
    host: str | None,
    user: str | None,
    ssh_key: str | None,
    password: str | None,
) -> bool:
    return bool(host and user and (ssh_key or password))


def load_photo_catalog_from_sftp(sftp: paramiko.SFTPClient, remote_path: str) -> dict:
    try:
        with sftp.open(remote_path, 'r') as handle:
            raw = handle.read()
    except FileNotFoundError:
        return build_empty_photo_catalog()
    except OSError:
        return build_empty_photo_catalog()
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8', errors='replace')
    if not isinstance(raw, str) or not raw.strip():
        return build_empty_photo_catalog()
    return decode_photo_catalog_text(raw)


def upsert_remote_photo_catalog_items(
    remote_path: str,
    items: list[dict],
    *,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
) -> int:
    """SFTP download → path-merge → upload photos-index.json on the gallery server.

    Does not upload image bytes. Returns total catalog item count after merge.
    """
    if not items:
        return 0
    if not has_linux_ssh_credentials(host=host, user=user, ssh_key=ssh_key, password=password):
        raise RuntimeError(
            '远程更新 photos-index.json 需要 LINUX_UPLOAD_HOST、LINUX_UPLOAD_USER，'
            '以及 LINUX_UPLOAD_KEY 或 LINUX_UPLOAD_PASSWORD（仅 SSH，不上传图片）。'
        )

    client: paramiko.SSHClient | None = None
    sftp: paramiko.SFTPClient | None = None
    local_temp: Path | None = None
    try:
        client, sftp = open_linux_sftp_client(
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            proxy_url=proxy_url,
        )
        catalog = merge_photo_catalog_items(load_photo_catalog_from_sftp(sftp, remote_path), items)
        payload = json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=False) + '\n'
        ensure_linux_remote_dirs_sftp(sftp, remote_path)
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', delete=False, suffix='.json') as handle:
            handle.write(payload)
            local_temp = Path(handle.name)
        sftp.put(str(local_temp), remote_path)
        return len(catalog['items'])
    finally:
        if local_temp is not None:
            try:
                local_temp.unlink(missing_ok=True)
            except Exception:
                pass
        close_linux_sftp_session(client, sftp)


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file_obj:
        while True:
            chunk = file_obj.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def get_prepared_output_suffix(compression_strategy: str | None) -> str:
    if compression_strategy == AVIF_LOSSLESS_COMPRESSION_STRATEGY:
        return AVIF_OUTPUT_SUFFIX
    return '.png'


def build_prepared_cache_key(sha256: str, *, compression_strategy: str, output_suffix: str | None = None) -> str:
    strategy_key = compression_strategy.replace(':', '_')
    suffix = output_suffix or get_prepared_output_suffix(compression_strategy)
    return f'{sha256}--{strategy_key}{suffix}'


def record_prepared_upload_metadata(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    sha256: str,
    compression_strategy: str,
    prepared_path: Path,
) -> None:
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    record = get_file_cache_record(cache_data, relative_path, initialize=True)
    artifacts = record.get('prepared_artifacts')
    if not isinstance(artifacts, dict):
        artifacts = {}
        record['prepared_artifacts'] = artifacts
    artifacts[compression_strategy] = {
        'sha256': sha256,
        'compression_strategy': compression_strategy,
        'output_suffix': prepared_path.suffix,
        'prepared_size': prepared_path.stat().st_size,
    }


def record_prepared_png_metadata(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    sha256: str,
    compression_strategy: str,
    prepared_path: Path,
) -> None:
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    record = get_file_cache_record(cache_data, relative_path, initialize=True)
    record['prepared_png'] = {
        'sha256': sha256,
        'compression_strategy': compression_strategy,
        'prepared_size': prepared_path.stat().st_size,
    }
    record_prepared_upload_metadata(
        cache_data,
        path,
        base_dir=base_dir,
        sha256=sha256,
        compression_strategy=compression_strategy,
        prepared_path=prepared_path,
    )


def normalize_target(target: str) -> str:
    """Images upload to R2 only. Accept legacy default/backend value 'r2'."""
    value = (target or 'r2').strip().lower()
    if value != 'r2':
        raise ValueError(
            f"不支持的上传目标 {target!r}：图片仅上传到 R2。"
            " Linux SSH 仅用于远程合并 photos-index.json（--catalog-remote）。"
        )
    return 'r2'


def targets_for_mode(target: str | None = None) -> tuple[str, ...]:
    if target is not None:
        normalize_target(target)
    return ('r2',)


def build_local_file_fingerprint(
    path: Path,
    *,
    compressed: bool | None = None,
    compression_strategy: str | None = None,
) -> dict[str, float | int | bool | str | None]:
    stat = path.stat()
    is_png = path.suffix.lower() == '.png'
    if compressed is None:
        compressed = is_png
        if compression_strategy is None and compressed:
            compression_strategy = PNG_COMPRESSION_STRATEGY if is_png else None
    if not compressed:
        compression_strategy = None
    return {
        'size': stat.st_size,
        'mtime': stat.st_mtime,
        'compressed': compressed,
        'compression_strategy': compression_strategy,
    }


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
    return build_upload_cache_fingerprint(
        path,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )


def build_cache_relative_path(path: Path, *, base_dir: Path) -> str:
    return path.relative_to(base_dir).as_posix()


def get_file_cache_record(cache_data: dict, relative_path: str, initialize: bool = False) -> dict:
    files = cache_data.get('files')
    if not isinstance(files, dict):
        if not initialize:
            return {}
        files = {}
        cache_data['files'] = files
    record = files.get(relative_path)
    if isinstance(record, dict):
        return record
    if initialize:
        record = {}
        files[relative_path] = record
        return record
    return {}


def set_target_synced(
    cache_data: dict,
    path: Path,
    *,
    base_dir: Path,
    target_label: str,
    target_id: str,
    compressed: bool,
    compression_strategy: str | None,
) -> None:
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    record = get_file_cache_record(cache_data, relative_path, initialize=True)
    record['source'] = build_source_cache_fingerprint(path)
    targets = record.get('targets')
    if not isinstance(targets, dict):
        targets = {}
        record['targets'] = targets
    targets[target_label] = {
        'id': target_id,
        'synced_fingerprint': build_synced_target_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        ),
    }


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
    changed = True

    if not targets:
        record.pop('targets', None)
        if 'prepared_png' not in record:
            record.pop('source', None)

    if not record:
        del files[relative_path]
    return changed


def build_r2_cache_key(bucket: str, object_key: str) -> str:
    return f'{bucket}|{object_key}'


def get_cached_existing_targets(
    files: list[Path],
    *,
    cache_entries: dict,
    remote_id_builder,
    cache_key_builder,
    semantics_builder,
) -> set[str]:
    cached_remote_ids: set[str] = set()
    for path in files:
        remote_id = remote_id_builder(path)
        cache_key = cache_key_builder(remote_id)
        compressed, compression_strategy = semantics_builder(path)
        if cache_entries.get(cache_key) == build_upload_cache_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        ):
            cached_remote_ids.add(remote_id)
    return cached_remote_ids


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


def get_cache_section(cache_data: dict, section_name: str, *, initialize: bool = False) -> dict:
    section = cache_data.get(section_name)
    if isinstance(section, dict):
        return section
    if initialize:
        section = {}
        cache_data[section_name] = section
        return section
    return {}


def get_cached_existing_targets_from_index(
    files: list[Path],
    *,
    cache_data: dict,
    base_dir: Path,
    target_label: str,
    remote_id_builder,
    target_id_builder,
    semantics_builder,
) -> set[str]:
    cached_remote_ids: set[str] = set()
    for path in files:
        relative_path = build_cache_relative_path(path, base_dir=base_dir)
        record = get_file_cache_record(cache_data, relative_path)
        targets = record.get('targets') if isinstance(record.get('targets'), dict) else {}
        target_record = targets.get(target_label)
        if not isinstance(target_record, dict):
            continue
        remote_id = remote_id_builder(path)
        if target_record.get('id') != target_id_builder(remote_id):
            continue
        compressed, compression_strategy = semantics_builder(path)
        if target_record.get('synced_fingerprint') == build_synced_target_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        ):
            cached_remote_ids.add(remote_id)
    return cached_remote_ids


def get_cached_existing_r2_keys(
    files: list[Path],
    *,
    base_dir: Path,
    bucket: str,
    prefix: str,
    cache_data: dict,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
) -> set[str]:
    return get_cached_existing_targets_from_index(
        files,
        cache_data=cache_data,
        base_dir=base_dir,
        target_label='r2',
        remote_id_builder=lambda path: build_effective_object_key(path, base_dir=base_dir, prefix=prefix, compression=compression),
        target_id_builder=lambda object_key: build_r2_cache_key(bucket, object_key),
        semantics_builder=lambda path: get_expected_upload_cache_semantics(path, compression),
    )


def get_target_cache_id(target_label: str, path: Path, *, base_dir: Path, config: UploadRuntimeConfig) -> str:
    if target_label != 'r2':
        raise ValueError(f'Unsupported target label: {target_label}')
    return build_r2_cache_key(
        config.bucket,
        build_effective_object_key(path, base_dir=base_dir, prefix=config.prefix.strip('/'), compression=config.compression),
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
    relative_path = build_cache_relative_path(path, base_dir=base_dir)
    record = get_file_cache_record(cache_data, relative_path)
    targets = record.get('targets') if isinstance(record.get('targets'), dict) else {}
    target_record = targets.get(target_label)
    if not isinstance(target_record, dict):
        return False
    return (
        target_record.get('id') == target_id
        and target_record.get('synced_fingerprint') == build_synced_target_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
    )


def should_replace_existing_avif(config: UploadRuntimeConfig, compression_strategy: str | None) -> bool:
    return config.replace_remote_avif and is_avif_compression_strategy(compression_strategy)


def should_skip_existing_for_planned_upload(config: UploadRuntimeConfig, planned: PlannedUpload) -> bool:
    return not should_replace_existing_avif(config, planned.compression_strategy)


def plan_pending_uploads(
    files: list[Path],
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
    target_labels: tuple[str, ...],
    cache_data: dict,
    skip_existing: bool = True,
) -> dict[str, list[PlannedUpload]]:
    pending_by_target = {target_label: [] for target_label in target_labels}
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
        relative_path = build_upload_relative_path(path, base_dir=base_dir, compression_strategy=compression_strategy)
        planned = PlannedUpload(
            source_path=path,
            relative_path=relative_path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
        for target_label in target_labels:
            if not skip_existing or should_replace_existing_avif(config, compression_strategy):
                pending_by_target[target_label].append(planned)
                continue
            target_id = get_target_cache_id(target_label, path, base_dir=base_dir, config=config)
            if not is_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label=target_label,
                target_id=target_id,
                compressed=compressed,
                compression_strategy=compression_strategy,
            ):
                pending_by_target[target_label].append(planned)
    return pending_by_target


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
    if is_target_synced(
        cache_data,
        path,
        base_dir=base_dir,
        target_label=target_label,
        target_id=target_id,
        compressed=compressed,
        compression_strategy=compression_strategy,
    ):
        return False
    set_target_synced(
        cache_data,
        path,
        base_dir=base_dir,
        target_label=target_label,
        target_id=target_id,
        compressed=compressed,
        compression_strategy=compression_strategy,
    )
    return True


def update_r2_cache_entry(
    cache_data: dict,
    *,
    base_dir: Path,
    bucket: str,
    object_key: str,
    path: Path,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    target_id = build_r2_cache_key(bucket, object_key)
    return apply_target_result_to_cache(
        cache_data,
        path,
        base_dir=base_dir,
        target_label='r2',
        target_id=target_id,
        status='uploaded',
        compressed=compressed,
        compression_strategy=compression_strategy,
    )


def get_legacy_target_sections(cache_data: dict) -> dict[str, dict]:
    sections = {'r2': {}, 'linux': {}, 'qiniu': {}}
    if not isinstance(cache_data, dict):
        return sections
    legacy_targets = cache_data.get('_legacy_targets')
    if not isinstance(legacy_targets, dict):
        return sections
    for target_label in ('r2', 'linux', 'qiniu'):
        section = legacy_targets.get(target_label)
        if isinstance(section, dict):
            sections[target_label] = section
    return sections


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
    if 'version' in data:
        if data.get('version') != CACHE_SCHEMA_VERSION:
            return empty_cache
        files = data.get('files')
        if not isinstance(files, dict):
            return empty_cache
        return {
            'version': CACHE_SCHEMA_VERSION,
            'files': files,
        }
    legacy_targets = {
        target_label: data[target_label]
        for target_label in ('r2', 'linux', 'qiniu')
        if isinstance(data.get(target_label), dict)
    }
    if not any(legacy_targets.values()):
        return empty_cache
    return {
        'version': CACHE_SCHEMA_VERSION,
        'files': {},
        '_legacy_targets': get_legacy_target_sections({'_legacy_targets': legacy_targets}),
    }


def find_matching_legacy_target_id(
    target_label: str,
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
    legacy_section: dict,
    fingerprint: dict[str, float | int | bool | str | None],
) -> str | None:
    target_id = get_target_cache_id(target_label, path, base_dir=base_dir, config=config)
    if legacy_section.get(target_id) == fingerprint:
        return target_id

    relative_parts = path.relative_to(base_dir).parts
    matching_target_ids: list[str] = []
    for legacy_target_id, legacy_fingerprint in legacy_section.items():
        if legacy_fingerprint != fingerprint or not isinstance(legacy_target_id, str):
            continue
        _, separator, remote_id = legacy_target_id.partition('|')
        if not separator:
            continue
        remote_parts = tuple(part for part in PurePosixPath(remote_id).parts if part != '/')
        if len(remote_parts) < len(relative_parts):
            continue
        if tuple(remote_parts[-len(relative_parts):]) != relative_parts:
            continue
        matching_target_ids.append(legacy_target_id)

    if len(matching_target_ids) == 1:
        return matching_target_ids[0]
    return None


def promote_legacy_cache_entries(
    files: list[Path],
    *,
    base_dir: Path,
    cache_data: dict,
    config: UploadRuntimeConfig,
    target_labels: tuple[str, ...],
) -> dict[str, int]:
    legacy_targets = get_legacy_target_sections(cache_data)
    migrated_counts = {target_label: 0 for target_label in ('r2', 'linux', 'qiniu')}
    if not any(legacy_targets.values()):
        return migrated_counts
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
        fingerprint = build_upload_cache_fingerprint(
            path,
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
        for target_label in target_labels:
            legacy_section = legacy_targets.get(target_label)
            if not isinstance(legacy_section, dict):
                continue
            target_id = find_matching_legacy_target_id(
                target_label,
                path,
                base_dir=base_dir,
                config=config,
                legacy_section=legacy_section,
                fingerprint=fingerprint,
            )
            if target_id is None:
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
                migrated_counts[target_label] += 1
    return migrated_counts


def save_upload_cache(path: Path, cache_data: dict) -> None:
    payload = {
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
        json.dump(payload, temp_file, ensure_ascii=False, indent=2, sort_keys=True)
        temp_path = Path(temp_file.name)
    os.replace(temp_path, path)


def build_r2_proxies(proxy_url: str | None) -> dict[str, str] | None:
    if not proxy_url:
        return None
    return {
        'http': proxy_url,
        'https': proxy_url,
    }


def make_r2_client(*, endpoint: str, access_key: str, secret_key: str, region: str, proxy_url: str | None = None):
    config_kwargs = {
        'signature_version': 's3v4',
        'retries': {
            'mode': 'standard',
            'total_max_attempts': 10,
        },
    }
    proxies = build_r2_proxies(proxy_url)
    if proxies:
        config_kwargs['proxies'] = proxies

    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(**config_kwargs),
    )


def load_env_file(path: Path) -> bool:
    resolved = Path(path).expanduser()
    try:
        resolved = resolved.resolve()
    except OSError:
        resolved = resolved.absolute()

    if not resolved.exists() or not resolved.is_file():
        return False

    for raw_line in resolved.read_text(encoding='utf-8-sig').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()
        if '=' not in line:
            continue

        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key and not os.getenv(key):
            os.environ[key] = value

    return True


def iter_default_env_file_candidates() -> list[Path]:
    """Env files searched when --env-file is omitted.

    Prefer the script directory (same folder as upload_r2.py), then the
    current working directory. Deduplicate by resolved path.
    """
    search_dirs = [SCRIPT_DIR, Path.cwd()]
    candidates: list[Path] = []
    seen: set[str] = set()
    for directory in search_dirs:
        for name in DEFAULT_ENV_FILE_NAMES:
            path = directory / name
            try:
                key = str(path.resolve())
            except OSError:
                key = str(path.absolute())
            if key in seen:
                continue
            seen.add(key)
            candidates.append(path)
    return candidates


def resolve_env_file_candidates(args) -> list[Path]:
    explicit = getattr(args, 'env_file', None)
    if explicit:
        return [Path(str(explicit)).expanduser()]
    return iter_default_env_file_candidates()


def _load_env_files(args) -> None:
    loaded: list[str] = []
    for candidate in resolve_env_file_candidates(args):
        if load_env_file(candidate):
            try:
                loaded.append(str(Path(candidate).expanduser().resolve()))
            except OSError:
                loaded.append(str(Path(candidate).expanduser().absolute()))
    # Stash for optional diagnostics by callers/tests.
    args._loaded_env_files = loaded  # type: ignore[attr-defined]


def env_first(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def build_object_url(endpoint: str, bucket: str, key: str) -> str:
    endpoint = endpoint.rstrip('/')
    encoded_key = parse.quote(key, safe='/-_.~')
    return f'{endpoint}/{bucket}/{encoded_key}'


def build_upload_relative_path(
    path: Path,
    *,
    base_dir: Path,
    compression_strategy: str | None,
) -> str:
    relative_path = Path(path.relative_to(base_dir))
    if is_avif_compression_strategy(compression_strategy):
        relative_path = relative_path.with_suffix(AVIF_OUTPUT_SUFFIX)
    return relative_path.as_posix()


def build_object_key(
    path: Path,
    *,
    base_dir: Path,
    prefix: str,
    compression_strategy: str | None = None,
) -> str:
    rel = build_upload_relative_path(path, base_dir=base_dir, compression_strategy=compression_strategy)
    key = f'{prefix}/{rel}' if prefix else rel
    return key.lstrip('/')


def build_effective_object_key(path: Path, *, base_dir: Path, prefix: str, compression: str | None) -> str:
    _, compression_strategy = get_expected_upload_cache_semantics(path, compression)
    return build_object_key(path, base_dir=base_dir, prefix=prefix, compression_strategy=compression_strategy)


def resolve_runtime_config(args) -> UploadRuntimeConfig:
    target = normalize_target(getattr(args, 'target', None) or 'r2')
    compression = normalize_compression_mode(getattr(args, 'compression', None) or env_first('UPLOAD_COMPRESSION'))
    bucket = getattr(args, 'bucket', None) or env_first('R2_BUCKET') or DEFAULT_BUCKET
    prefix_arg = getattr(args, 'prefix', None)
    prefix = prefix_arg if prefix_arg is not None else (env_first('R2_PREFIX') or DEFAULT_PREFIX)
    region = getattr(args, 'region', None) or env_first('AWS_REGION', 'AWS_DEFAULT_REGION', 'R2_REGION') or 'auto'

    access_key = env_first('CLOUDFLARE_R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
    secret_key = env_first('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
    account_id = env_first('CLOUDFLARE_ACCOUNT_ID')
    endpoint = getattr(args, 'endpoint', None) or env_first('R2_ENDPOINT') or (f'https://{account_id}.r2.cloudflarestorage.com' if account_id else DEFAULT_ENDPOINT)

    r2_proxy = getattr(args, 'r2_proxy', None) or env_first('R2_PROXY')

    # SSH credentials only for remote catalog merge (not image upload).
    linux_host = getattr(args, 'linux_host', None) or env_first('LINUX_UPLOAD_HOST')
    linux_user = getattr(args, 'linux_user', None) or env_first('LINUX_UPLOAD_USER')
    linux_key = getattr(args, 'linux_key', None)
    linux_password_arg = getattr(args, 'linux_password', None)
    if linux_key is None and linux_password_arg is None:
        linux_key = env_first('LINUX_UPLOAD_KEY')
    linux_password = linux_password_arg or env_first('LINUX_UPLOAD_PASSWORD')
    linux_port = getattr(args, 'linux_port', None) or int(env_first('LINUX_UPLOAD_PORT') or '22')
    linux_proxy = getattr(args, 'linux_proxy', None) or env_first('LINUX_PROXY')

    return UploadRuntimeConfig(
        target=target,
        bucket=bucket,
        prefix=prefix,
        region=region,
        endpoint=endpoint,
        r2_proxy=r2_proxy,
        linux_host=linux_host,
        linux_user=linux_user,
        linux_key=linux_key,
        linux_password=linux_password,
        linux_port=linux_port,
        linux_proxy=linux_proxy,
        access_key=access_key,
        secret_key=secret_key,
        compression=compression,
        replace_remote_png=getattr(args, 'replace_remote_png', False),
        replace_remote_avif=getattr(args, 'replace_remote_avif', False),
    )


def list_existing_keys(
    *,
    endpoint: str,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    region: str,
    proxy_url: str | None = None,
    object_keys: list[str] | None = None,
) -> tuple[set[str], str | None]:
    existing_keys: set[str] = set()

    try:
        client = make_r2_client(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
            proxy_url=proxy_url,
        )
        if object_keys is not None:
            max_workers = max(1, min(EXISTENCE_CHECK_MAX_WORKERS, len(object_keys)))

            def check_one(object_key: str) -> tuple[str, bool]:
                response = client.list_objects_v2(Bucket=bucket, Prefix=object_key, MaxKeys=1)
                found = any(item.get('Key') == object_key for item in response.get('Contents', []))
                return object_key, found

            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
                future_to_key = {
                    pool.submit(check_one, object_key): object_key
                    for object_key in object_keys
                }
                for future in concurrent.futures.as_completed(future_to_key):
                    object_key, found = future.result()
                    if found:
                        existing_keys.add(object_key)
            return existing_keys, None

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


def collect_files(folder: Path, recursive: bool) -> list[Path]:
    iterator: Iterable[Path] = folder.rglob('*') if recursive else folder.iterdir()
    files = [p for p in iterator if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    return sorted(files, key=lambda p: p.name)


def build_prepared_png_command(executable: str, source_path: Path, temp_path: Path) -> list[str]:
    return [
        executable,
        '-o', 'max',
        '-z',
        '--strip', 'safe',
        '--out', str(temp_path),
        str(source_path),
    ]


def build_prepared_avif_command(executable: str, source_path: Path, temp_path: Path) -> list[str]:
    return [
        executable,
        str(source_path),
        '-define', f'heic:chroma={AVIF_LOSSLESS_CHROMA}',
        '-define', f'heic:cicp={AVIF_LOSSLESS_CICP}',
        '-quality', '100',
        str(temp_path),
    ]


def resolve_imagemagick_executable() -> tuple[str, str]:
    executable = shutil.which('magick')
    if executable:
        return executable, 'magick'

    executable = shutil.which('convert')
    if executable:
        return executable, 'convert'

    raise RuntimeError('未在 PATH 中找到 ImageMagick CLI。请安装 ImageMagick 7 的 magick，或安装 ImageMagick 6 的 convert，并启用 AVIF/libheif 支持')


def run_prepared_file_command(command: list[str], *, tool_name: str, temp_path: Path) -> None:
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            **SUBPROCESS_TEXT_KWARGS,
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or '').strip() or (exc.stdout or '').strip() or str(exc)
        raise RuntimeError(f'{tool_name} 执行失败：{detail}') from exc
    if not temp_path.is_file():
        raise RuntimeError(f'{tool_name} 未生成输出文件：{temp_path}')
    if temp_path.stat().st_size <= 0:
        raise RuntimeError(f'{tool_name} 生成了空输出文件：{temp_path}')


def call_prepare_upload_file(path: Path, compression: str | None) -> PreparedUpload:
    if normalize_compression_mode(compression) == COMPATIBILITY_COMPRESSION_MODE:
        return prepare_upload_file(path)
    return prepare_upload_file(path, compression)


def prepare_upload_file(path: Path, compression: str | None = COMPATIBILITY_COMPRESSION_MODE) -> PreparedUpload:
    compressed, compression_strategy = get_expected_upload_cache_semantics(path, compression)
    if not compressed or compression_strategy is None:
        return PreparedUpload(
            source_path=path,
            upload_path=path,
            compressed=False,
            compression_strategy=None,
        )

    sha256 = compute_file_sha256(path)
    cache_dir = get_prepared_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    output_suffix = get_prepared_output_suffix(compression_strategy)
    cache_path = cache_dir / build_prepared_cache_key(
        sha256,
        compression_strategy=compression_strategy,
        output_suffix=output_suffix,
    )
    if cache_path.is_file() and cache_path.stat().st_size > 0:
        return PreparedUpload(
            source_path=path,
            upload_path=cache_path,
            temp_path=None,
            compressed=True,
            compression_strategy=compression_strategy,
            from_cache=True,
        )

    if compression_strategy == PNG_COMPRESSION_STRATEGY:
        executable = shutil.which('oxipng')
        if not executable:
            raise RuntimeError('未在 PATH 中找到 oxipng CLI，请先安装 oxipng')
        tool_name = 'oxipng'
        command_builder = build_prepared_png_command
    elif compression_strategy == AVIF_LOSSLESS_COMPRESSION_STRATEGY:
        executable, tool_name = resolve_imagemagick_executable()
        command_builder = build_prepared_avif_command
    else:
        raise RuntimeError(f'不支持的压缩策略：{compression_strategy}')

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=output_suffix)
    temp_path = Path(temp_file.name)
    temp_file.close()
    temp_path.unlink(missing_ok=True)

    try:
        run_prepared_file_command(command_builder(executable, path, temp_path), tool_name=tool_name, temp_path=temp_path)
        source_stat = path.stat()
        os.utime(temp_path, (source_stat.st_atime, source_stat.st_mtime))
        os.replace(temp_path, cache_path)
    except Exception:
        cleanup_prepared_upload(PreparedUpload(source_path=path, upload_path=temp_path, temp_path=temp_path))
        raise

    return PreparedUpload(
        source_path=path,
        upload_path=cache_path,
        temp_path=None,
        compressed=True,
        compression_strategy=compression_strategy,
    )


def cleanup_prepared_upload(prepared: PreparedUpload) -> None:
    if prepared.temp_path is not None:
        try:
            prepared.temp_path.unlink(missing_ok=True)
        except Exception:
            pass


def get_source_mtime_metadata_value(source_path: Path) -> str:
    return str(source_path.stat().st_mtime)


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
    compression_strategy: str | None = None,
    proxy_url: str | None = None,
    client=None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    key = build_object_key(source_path, base_dir=base_dir, prefix=prefix, compression_strategy=compression_strategy)

    if dry_run:
        return 'dry-run', f'演练 {source_path.name} -> s3://{bucket}/{key}'

    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'跳过 {source_path.name} -> s3://{bucket}/{key}'

    try:
        data = upload_path.read_bytes()
        content_type = mimetypes.guess_type(key)[0] or 'application/octet-stream'
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
        return 'uploaded', f'已上传 {source_path.name} -> s3://{bucket}/{key}'
    except Exception as exc:
        return 'failed', f'失败 {source_path.name}：{exc}'


def should_replace_remote_png(path: Path, compression_strategy: str | None) -> bool:
    return path.suffix.lower() == '.png' and is_avif_compression_strategy(compression_strategy)


def is_r2_object_present(client, *, bucket: str, object_key: str) -> bool:
    response = client.list_objects_v2(Bucket=bucket, Prefix=object_key, MaxKeys=1)
    return any(item.get('Key') == object_key for item in response.get('Contents', []))


def delete_replaced_png_from_r2(
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[str, str]:
    old_key = build_object_key(path, base_dir=base_dir, prefix=config.prefix.strip('/'))
    avif_key = build_object_key(
        path,
        base_dir=base_dir,
        prefix=config.prefix.strip('/'),
        compression_strategy=AVIF_LOSSLESS_COMPRESSION_STRATEGY,
    )
    try:
        client = make_r2_client(
            endpoint=config.endpoint,
            access_key=config.access_key or '',
            secret_key=config.secret_key or '',
            region=config.region,
            proxy_url=config.r2_proxy,
        )
        if not is_r2_object_present(client, bucket=config.bucket, object_key=avif_key):
            return 'failed', f'旧 PNG 替换失败 {path.name}：未确认 AVIF 存在 s3://{config.bucket}/{avif_key}'
        if not is_r2_object_present(client, bucket=config.bucket, object_key=old_key):
            return 'skipped', f'旧 PNG 不存在 {path.name} -> s3://{config.bucket}/{old_key}'
        client.delete_object(Bucket=config.bucket, Key=old_key)
        return 'deleted', f'已删除旧 PNG {path.name} -> s3://{config.bucket}/{old_key}'
    except Exception as exc:
        return 'failed', f'旧 PNG 替换失败 {path.name}：{exc}'


def delete_replaced_remote_png(
    target_label: str,
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[str, str]:
    if target_label != 'r2':
        return 'failed', f'旧 PNG 替换失败 {path.name}：不支持的目标 {target_label}'
    return delete_replaced_png_from_r2(path, base_dir=base_dir, config=config)


def linux_sftp_path_exists(sftp: paramiko.SFTPClient, remote_path: str) -> bool:
    try:
        sftp.stat(remote_path)
        return True
    except FileNotFoundError:
        return False


def ensure_linux_remote_dirs_sftp(sftp: paramiko.SFTPClient, remote_path: str) -> None:
    current = PurePosixPath('/')
    for part in PurePosixPath(remote_path).parent.parts[1:]:
        current /= part
        current_path = current.as_posix()
        if not linux_sftp_path_exists(sftp, current_path):
            sftp.mkdir(current_path)


def build_linux_proxy_sock(proxy_url: str, *, host: str, port: int):
    parsed = parse.urlparse(proxy_url)
    scheme = parsed.scheme.lower()
    proxy_host = parsed.hostname
    proxy_port = parsed.port
    if not proxy_host or not proxy_port:
        raise ValueError('Linux 代理地址无效')

    proxy_types = {
        'socks5': socks.SOCKS5,
        'socks5h': socks.SOCKS5,
        'socks4': socks.SOCKS4,
        'http': socks.HTTP,
        'https': socks.HTTP,
    }
    proxy_type = proxy_types.get(scheme)
    if proxy_type is None:
        raise ValueError(f'不支持的 Linux 代理协议：{scheme}')

    sock = socks.socksocket()
    sock.set_proxy(
        proxy_type,
        proxy_host,
        proxy_port,
        username=parsed.username or None,
        password=parsed.password or None,
        rdns=scheme in {'socks5h'},
    )
    sock.connect((host, port))
    return sock


def connect_linux_ssh_client(
    *,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = {
        'hostname': host,
        'port': port,
        'username': user,
        'password': password,
        'key_filename': ssh_key or None,
        'look_for_keys': False,
        'allow_agent': False,
    }
    if proxy_url:
        connect_kwargs['sock'] = build_linux_proxy_sock(proxy_url, host=host, port=port)
    client.connect(**connect_kwargs)
    return client


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
    try:
        return client, client.open_sftp()
    except Exception:
        client.close()
        raise


def close_linux_sftp_session(
    client: paramiko.SSHClient | None,
    sftp: paramiko.SFTPClient | None,
) -> None:
    if sftp is not None:
        try:
            sftp.close()
        except Exception:
            pass
    if client is not None:
        try:
            client.close()
        except Exception:
            pass


def is_linux_sftp_connection_error(exc: Exception) -> bool:
    connection_error_types = (ConnectionError, EOFError, OSError)
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, connection_error_types):
            if getattr(current, 'errno', None) == 10054:
                return True
            detail = str(current).lower()
            if any(token in detail for token in (
                'socket exception',
                'connection reset',
                '10054',
                'server connection dropped',
                'channel closed',
                'connection is dead',
                'eof during negotiation',
                'broken pipe',
            )):
                return True
        current = current.__cause__ or current.__context__
    return False


def get_target_display_name(target: str) -> str:
    return 'R2' if target == 'r2' else target.upper()


def format_result_message(target: str, message: str) -> str:
    return f'[{get_target_display_name(target)}] {message}'


def emit_compression_progress(
    target_label: str,
    *,
    index: int,
    total: int,
    prepared: PreparedUpload,
    log_callback=None,
) -> None:
    if not prepared.compressed:
        return
    action = '复用已压缩缓存' if prepared.from_cache else '压缩完成'
    emit_message(
        format_result_message(target_label, _format_progress(index, total, f'{action} {prepared.source_path.name}')),
        log_callback,
    )


def count_preparable_uploads(items: list[PlannedUpload]) -> int:
    return sum(1 for item in items if item.compressed)


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
    dry_run: bool,
    skip_existing: bool,
    existing_keys: set[str] | None,
    proxy_url: str | None,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
    log_callback=None,
) -> list[tuple[PlannedUpload, tuple[str, str, bool, str | None]]]:
    if not items:
        return []
    client = None
    if not dry_run:
        try:
            client = make_r2_client(
                endpoint=endpoint,
                access_key=access_key,
                secret_key=secret_key,
                region=region,
                proxy_url=proxy_url,
            )
        except Exception as exc:
            return [(item, ('failed', f'失败 {item.source_path.name}：{exc}', False, None)) for item in items]
    results: list[tuple[PlannedUpload, tuple[str, str, bool, str | None]]] = []
    compression = normalize_compression_mode(compression)
    compression_total = 0 if dry_run else count_preparable_uploads(items)
    compression_index = 0
    for item in items:
        prepared = PreparedUpload(
            source_path=item.source_path,
            upload_path=item.source_path,
            temp_path=None,
            compressed=item.compressed,
            compression_strategy=item.compression_strategy,
        ) if dry_run else None
        try:
            if prepared is None:
                try:
                    prepared = call_prepare_upload_file(item.source_path, compression)
                    if prepared.compressed:
                        compression_index += 1
                        emit_compression_progress(
                            'r2',
                            index=compression_index,
                            total=compression_total,
                            prepared=prepared,
                            log_callback=log_callback,
                        )
                except Exception as exc:
                    results.append((item, ('failed', f'失败 {item.source_path.name}：压缩失败，{exc}', False, None)))
                    continue
            status, message = upload_to_r2(
                item.source_path,
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
                compression_strategy=prepared.compression_strategy,
                proxy_url=proxy_url,
                client=client,
            )
            semantics = get_upload_cache_semantics(prepared) if status != 'failed' else (False, None)
            results.append((item, (status, message, *semantics)))
        finally:
            if prepared is not None:
                cleanup_prepared_upload(prepared)
    return results


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


def emit_message(message: str, log_callback=None, *, stream=None) -> None:
    if log_callback is not None:
        log_callback(message)
        return
    print(message, file=stream or sys.stdout, flush=True)


def run_sync_cache_only(
    *,
    config: UploadRuntimeConfig,
    folder: Path,
    files: list[Path],
    cache_file: Path,
    cache_data: dict,
    log_callback=None,
) -> int:
    _ = cache_file
    normalized_prefix = config.prefix.strip('/')

    emit_message('模式：仅同步缓存', log_callback)

    def log_summary(*, present: int, updated: int, removed: int, unchanged: int, failed: int) -> None:
        emit_message(
            f'R2 缓存同步：远端存在 {present}，已更新 {updated}，已移除 {removed}，未变化 {unchanged}，失败 {failed}',
            log_callback,
        )

    object_keys = [
        build_effective_object_key(path, base_dir=folder, prefix=normalized_prefix, compression=config.compression)
        for path in files
    ]
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
        emit_message(f'列出现有 R2 对象失败：{list_error}', log_callback, stream=sys.stderr)
        return 1

    present = updated = removed = unchanged = 0
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
        object_key = build_object_key(path, base_dir=folder, prefix=normalized_prefix, compression_strategy=compression_strategy)
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
                updated += 1
        else:
            if clear_target_synced(cache_data, path, base_dir=folder, target_label='r2'):
                removed += 1
            else:
                unchanged += 1
    log_summary(present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    emit_message('完成。缓存同步已完成，失败 0', log_callback)
    return 0


def _validate_target_config(config: UploadRuntimeConfig, target_labels: tuple[str, ...], needs_remote: bool, *, log_callback=None) -> str | None:
    """Validate R2 image-upload config; returns error message or None."""
    _ = target_labels, log_callback
    if needs_remote and not config.endpoint:
        return '缺少 R2 Endpoint。请设置 --endpoint、R2_ENDPOINT 或 CLOUDFLARE_ACCOUNT_ID。'
    if needs_remote and (not config.access_key or not config.secret_key):
        return '缺少 R2 凭据。请在环境变量或 env 文件中设置 CLOUDFLARE_R2_ACCESS_KEY_ID/CLOUDFLARE_R2_SECRET_ACCESS_KEY 或 AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY。'
    return None


def _collect_image_files(args, *, log_callback=None) -> tuple[Path, list[Path]]:
    folder = Path(args.dir).resolve()
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f'目录不存在：{folder}')
    files = collect_files(folder, args.recursive)
    return folder, files


def _build_existing_sets_from_cache(
    target_labels: tuple[str, ...],
    files: list[Path],
    pending_by_target: dict[str, list[PlannedUpload]],
    config: UploadRuntimeConfig,
    folder: Path,
    *,
    skip_existing: bool,
) -> set[str] | None:
    """Build initial R2 existing-key set from cache hits (non-pending items)."""
    _ = target_labels
    if not skip_existing:
        return None
    normalized_prefix = config.prefix.strip('/')
    pending_r2_paths = {p.source_path for p in pending_by_target.get('r2', [])}
    return {
        build_effective_object_key(p, base_dir=folder, prefix=normalized_prefix, compression=config.compression)
        for p in files if p not in pending_r2_paths
    }


def _precheck_object_store_target(
    target_label: str,
    pending_items: list[PlannedUpload],
    *,
    config: UploadRuntimeConfig,
    folder: Path,
    files: list[Path],
    cache_data: dict,
    existing_keys: set[str] | None,
    skip_existing: bool,
    dry_run: bool,
    verify_remote: bool,
    log_callback=None,
) -> tuple[set[str] | None, int, bool]:
    """Precheck R2 object store. Returns (updated_existing_keys, confirmed_count, cache_dirty)."""
    if target_label != 'r2':
        return existing_keys, 0, False
    if not should_precheck_pending_targets(
        skip_existing=skip_existing,
        dry_run=dry_run,
        verify_remote=verify_remote,
        cache_data=cache_data,
        target_label=target_label,
    ):
        return existing_keys, 0, False

    cache_dirty = False
    prefix = config.prefix.strip('/')
    pending_keys = [
        build_object_key(
            item.source_path,
            base_dir=folder,
            prefix=prefix,
            compression_strategy=item.compression_strategy,
        )
        for item in pending_items
    ]
    if not pending_keys:
        return existing_keys, 0, False
    emit_message(f'正在预检待上传的 R2 对象（{len(pending_keys)} 个）...', log_callback)
    online_keys, list_error = list_existing_keys(
        endpoint=config.endpoint, bucket=config.bucket, prefix=prefix,
        access_key=config.access_key or '', secret_key=config.secret_key or '',
        region=config.region, proxy_url=config.r2_proxy, object_keys=pending_keys,
    )
    if list_error:
        emit_message(f'R2 预检失败：{list_error}', log_callback, stream=sys.stderr)
        raise RuntimeError(f'R2 预检失败：{list_error}')
    existing_keys = (existing_keys or set()) | online_keys
    files_by_key = {
        build_effective_object_key(p, base_dir=folder, prefix=prefix, compression=config.compression): p
        for p in files
    }
    for object_key in online_keys:
        path = files_by_key.get(object_key)
        if path is None:
            continue
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
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
    return existing_keys, len(online_keys), cache_dirty


def _print_preflight_summary(
    config: UploadRuntimeConfig,
    pending_by_target: dict[str, list[PlannedUpload]],
    local_cache_hits: dict[str, int],
    remote_precheck_counts: dict[str, int],
    legacy_promotions: dict[str, int],
    target_labels: tuple[str, ...],
    skip_existing: bool,
    dry_run: bool,
    *,
    log_callback=None,
) -> None:
    _ = target_labels
    emit_message('========== 上传摘要 ==========', log_callback)
    emit_message('目标：R2', log_callback)
    emit_message(f'模式：{"演练" if dry_run else "上传"}', log_callback)
    emit_message(f'跳过已存在文件：{"是" if skip_existing else "否"}', log_callback)
    if config.replace_remote_avif:
        emit_message('替换远端 AVIF：是', log_callback)
    pending = len(pending_by_target.get('r2', []))
    cache_hits = local_cache_hits.get('r2', 0)
    remote_confirmed = remote_precheck_counts.get('r2', 0)
    existing = cache_hits + remote_confirmed
    emit_message(
        f'  R2：待处理 {pending} | 已存在 {existing}（缓存命中 {cache_hits}，远端确认 {remote_confirmed}）',
        log_callback,
    )
    emit_message(f'    旧缓存迁移：{legacy_promotions.get("r2", 0)}', log_callback)
    emit_message('=' * 32, log_callback)


def _format_progress(index: int, total: int, message: str) -> str:
    return f'[{index}/{total}] {message}'


def run_upload(args, log_callback=None) -> int:
    _load_env_files(args)
    config = resolve_runtime_config(args)
    sync_cache_only = getattr(args, 'sync_cache_only', False)
    needs_remote_access = sync_cache_only or not args.dry_run

    try:
        folder, files = _collect_image_files(args, log_callback=log_callback)
    except FileNotFoundError as exc:
        emit_message(str(exc), log_callback, stream=sys.stderr)
        return 2

    cache_file = get_cache_file_path()
    refresh_cache = getattr(args, 'refresh_cache', False)
    cache_data = build_empty_upload_cache() if refresh_cache else load_upload_cache(cache_file)
    cache_dirty = refresh_cache
    if not files:
        if cache_dirty:
            save_upload_cache(cache_file, cache_data)
        emit_message(f'未在 {folder} 中找到图片文件', log_callback)
        return 0

    target_labels = ('r2',)
    emit_message(f'在 {folder} 中共发现 {len(files)} 个图片文件', log_callback)
    emit_message('目标：R2', log_callback)

    error_msg = _validate_target_config(config, target_labels, needs_remote_access, log_callback=log_callback)
    if error_msg:
        emit_message(error_msg, log_callback, stream=sys.stderr)
        return 2

    normalized_prefix = config.prefix.strip('/')

    if sync_cache_only:
        cache_snapshot = json.dumps(cache_data, sort_keys=True)
        legacy_promotions = promote_legacy_cache_entries(
            files, base_dir=folder, cache_data=cache_data, config=config,
            target_labels=('r2',),
        )
        exit_code = run_sync_cache_only(
            config=config, folder=folder, files=files,
            cache_file=cache_file, cache_data=cache_data, log_callback=log_callback,
        )
        if exit_code == 0 and (
            cache_dirty or any(legacy_promotions.values())
            or json.dumps(cache_data, sort_keys=True) != cache_snapshot
        ):
            save_upload_cache(cache_file, cache_data)
        return exit_code

    skip_existing = not args.no_skip_existing
    legacy_promotions = {'r2': 0}
    if skip_existing and not refresh_cache:
        legacy_promotions = promote_legacy_cache_entries(
            files, base_dir=folder, cache_data=cache_data, config=config,
            target_labels=target_labels,
        )
        if any(legacy_promotions.values()):
            cache_dirty = True

    pending_by_target = plan_pending_uploads(
        files, base_dir=folder, config=config,
        target_labels=target_labels, cache_data=cache_data, skip_existing=skip_existing,
    )

    existing_keys = _build_existing_sets_from_cache(
        target_labels, files, pending_by_target, config, folder, skip_existing=skip_existing,
    )

    local_cache_hits = {
        'r2': max(0, len(existing_keys or set()) - legacy_promotions.get('r2', 0)),
    }
    remote_precheck_counts = {'r2': 0}
    verify_remote = getattr(args, 'verify_remote', False)

    pending_items = pending_by_target.get('r2', [])
    if pending_items:
        r2_precheck_items = [item for item in pending_items if should_skip_existing_for_planned_upload(config, item)]
        existing_keys, confirmed, dirty = _precheck_object_store_target(
            'r2', r2_precheck_items, config=config, folder=folder, files=files,
            cache_data=cache_data, existing_keys=existing_keys,
            skip_existing=skip_existing, dry_run=args.dry_run,
            verify_remote=verify_remote, log_callback=log_callback,
        )
        remote_precheck_counts['r2'] = confirmed
        cache_dirty = cache_dirty or dirty

    _print_preflight_summary(
        config, pending_by_target, local_cache_hits, remote_precheck_counts,
        legacy_promotions, target_labels, skip_existing, args.dry_run,
        log_callback=log_callback,
    )

    batch_r2_items: list[PlannedUpload] = []
    skipped_r2_results: list[tuple[Path, tuple[str, str, bool, str | None]]] = []
    for planned in pending_by_target.get('r2', []):
        object_key = build_object_key(
            planned.source_path,
            base_dir=folder,
            prefix=normalized_prefix,
            compression_strategy=planned.compression_strategy,
        )
        if should_skip_existing_for_planned_upload(config, planned) and existing_keys is not None and object_key in existing_keys:
            skipped_r2_results.append(
                (
                    planned.source_path,
                    (
                        'skipped',
                        f'跳过 {planned.source_path.name} -> s3://{config.bucket}/{object_key}',
                        planned.compressed,
                        planned.compression_strategy,
                    ),
                )
            )
            continue
        batch_r2_items.append(planned)
    if existing_keys is not None:
        pending_r2_paths = {p.source_path for p in pending_by_target.get('r2', [])}
        for path in files:
            if path in pending_r2_paths:
                continue
            compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            object_key = build_object_key(
                path,
                base_dir=folder,
                prefix=normalized_prefix,
                compression_strategy=compression_strategy,
            )
            if object_key in existing_keys:
                skipped_r2_results.append(
                    (
                        path,
                        (
                            'skipped',
                            f'跳过 {path.name} -> s3://{config.bucket}/{object_key}',
                            compressed,
                            compression_strategy,
                        ),
                    )
                )

    counters = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
    catalog_items_by_path: dict[str, dict] = {}
    sort_time_mode = resolve_sort_time_mode(getattr(args, 'sort_time', None))
    batch_log_kwargs = {'log_callback': log_callback} if log_callback is not None else {}
    batch_compression_kwargs = {'compression': config.compression} if config.compression != COMPATIBILITY_COMPRESSION_MODE else {}

    def maybe_update_cache(
        target_label: str, status: str, path: Path | None, *,
        compressed: bool = False, compression_strategy: str | None = None,
    ) -> bool:
        if path is None or target_label != 'r2' or status != 'uploaded':
            return False
        target_id = get_target_cache_id('r2', path, base_dir=folder, config=config)
        dirty = apply_target_result_to_cache(
            cache_data, path, base_dir=folder, target_label='r2',
            target_id=target_id, status=status,
            compressed=compressed, compression_strategy=compression_strategy,
        )
        if dirty and status == 'uploaded' and compressed and compression_strategy:
            sha256 = compute_file_sha256(path)
            prepared_path = get_prepared_cache_dir() / build_prepared_cache_key(sha256, compression_strategy=compression_strategy)
            if prepared_path.is_file() and prepared_path.stat().st_size > 0:
                relative_path = build_cache_relative_path(path, base_dir=folder)
                record = get_file_cache_record(cache_data, relative_path)
                if compression_strategy == PNG_COMPRESSION_STRATEGY:
                    previous = record.get('prepared_png') if isinstance(record, dict) else None
                    record_prepared_png_metadata(
                        cache_data, path, base_dir=folder, sha256=sha256,
                        compression_strategy=compression_strategy, prepared_path=prepared_path,
                    )
                    current = get_file_cache_record(cache_data, relative_path).get('prepared_png')
                else:
                    artifacts = record.get('prepared_artifacts') if isinstance(record.get('prepared_artifacts'), dict) else {}
                    previous = artifacts.get(compression_strategy)
                    record_prepared_upload_metadata(
                        cache_data, path, base_dir=folder, sha256=sha256,
                        compression_strategy=compression_strategy, prepared_path=prepared_path,
                    )
                    current = get_file_cache_record(cache_data, relative_path).get('prepared_artifacts', {}).get(compression_strategy)
                if current != previous:
                    dirty = True
        return dirty

    def record_result(
        target_label: str, path: Path,
        result: tuple[str, str, bool, str | None] | tuple[str, str],
        emit_skipped: bool = False,
    ) -> None:
        nonlocal cache_dirty
        if len(result) >= 4:
            status, message, compressed, compression_strategy = result[:4]
        else:
            status, message = result[:2]
            if status in {'uploaded', 'skipped'}:
                compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            else:
                compressed, compression_strategy = False, None
        cache_dirty = apply_upload_result(
            target_label=target_label, path=path,
            result=(status, message, compressed, compression_strategy),
            counters=counters,
            on_message=lambda msg: emit_message(msg, log_callback),
            on_cache_update=maybe_update_cache,
            emit_skipped_message=emit_skipped,
        ) or cache_dirty
        if status == 'uploaded' and target_label == 'r2' and not args.dry_run:
            relative_path = build_upload_relative_path(
                path,
                base_dir=folder,
                compression_strategy=compression_strategy,
            )
            catalog_items_by_path[relative_path] = build_photo_catalog_item(
                path,
                relative_path=relative_path,
                sort_time_mode=sort_time_mode,
            )
        if (
            config.replace_remote_png
            and status == 'uploaded'
            and should_replace_remote_png(path, compression_strategy)
        ):
            delete_status, delete_message = delete_replaced_remote_png(
                target_label,
                path,
                base_dir=folder,
                config=config,
            )
            emit_message(format_result_message(target_label, delete_message), log_callback)
            if delete_status == 'failed':
                counters['failed'] += 1

    if batch_r2_items:
        emit_message(f'开始上传到 R2（{len(batch_r2_items)} 个文件）...', log_callback)
        for i, (item, result) in enumerate(upload_pending_r2_files(
            batch_r2_items, base_dir=folder, endpoint=config.endpoint,
            bucket=config.bucket, prefix=normalized_prefix,
            access_key=config.access_key or '', secret_key=config.secret_key or '',
            region=config.region, dry_run=args.dry_run,
            skip_existing=False, existing_keys=None, proxy_url=config.r2_proxy,
            **batch_compression_kwargs,
            **batch_log_kwargs,
        ), 1):
            path = item.source_path if isinstance(item, PlannedUpload) else item
            progress_msg = _format_progress(i, len(batch_r2_items), result[1])
            progress_result = (result[0], progress_msg, *result[2:]) if len(result) >= 4 else (result[0], progress_msg)
            record_result('r2', path, progress_result, emit_skipped=args.dry_run)

    for path, result in skipped_r2_results:
        record_result('r2', path, result, emit_skipped=args.dry_run)

    if cache_dirty:
        save_upload_cache(cache_file, cache_data)

    # Durable queue: R2 may already be done while photos-index.json write failed (e.g. SSH auth).
    # Reload pending so a later run with zero new uploads still retries catalog sync.
    pending_catalog_path = get_pending_catalog_file_path()
    pending_before = load_pending_catalog_items(pending_catalog_path)
    if catalog_items_by_path and not args.dry_run:
        pending_before = queue_pending_catalog_items(
            list(catalog_items_by_path.values()),
            pending_catalog_path,
        )
    elif pending_before and not args.dry_run:
        # Keep file as-is; work from loaded pending.
        pass

    catalog_items_by_path = {**pending_before, **catalog_items_by_path}
    catalog_items = list(catalog_items_by_path.values())
    catalog_path = get_photo_catalog_path(getattr(args, 'catalog', None))
    catalog_remote_path = get_photo_catalog_remote_path(getattr(args, 'catalog_remote', None))
    catalog_destinations_configured = catalog_path is not None or catalog_remote_path is not None

    if catalog_items and not args.dry_run and catalog_destinations_configured:
        local_ok = catalog_path is None
        remote_ok = catalog_remote_path is None
        if pending_before:
            emit_message(
                f'待同步图库目录条目：{len(catalog_items)} 条（含历史未完成）',
                log_callback,
            )

        if catalog_path is not None:
            try:
                upsert_photo_catalog_items(catalog_path, catalog_items)
                emit_message(f'已更新本地图库目录：{catalog_path}（{len(catalog_items)} 条）', log_callback)
                local_ok = True
            except Exception as exc:
                emit_message(f'更新本地图库目录失败：{exc}', log_callback, stream=sys.stderr)
                counters['failed'] += 1
                local_ok = False

        if catalog_remote_path is not None:
            try:
                total_items = upsert_remote_photo_catalog_items(
                    catalog_remote_path,
                    catalog_items,
                    host=config.linux_host or '',
                    user=config.linux_user or '',
                    ssh_key=config.linux_key,
                    password=config.linux_password,
                    port=config.linux_port,
                    proxy_url=config.linux_proxy,
                )
                remote_target = f'{(config.linux_user or "")}@{(config.linux_host or "")}:{catalog_remote_path}'
                emit_message(
                    f'已远程合并图库目录：{remote_target}（本批/待同步 {len(catalog_items)} 条，合计 {total_items} 条）',
                    log_callback,
                )
                remote_ok = True
            except Exception as exc:
                emit_message(f'远程更新图库目录失败：{exc}', log_callback, stream=sys.stderr)
                counters['failed'] += 1
                remote_ok = False

        if local_ok and remote_ok:
            clear_pending_catalog_items(pending_catalog_path)
        else:
            # Keep queue so the next run retries without re-uploading R2 objects.
            save_pending_catalog_items(catalog_items_by_path, pending_catalog_path)
            emit_message(
                f'图库目录仍有未完成同步，已保留队列：{pending_catalog_path}（{len(catalog_items_by_path)} 条）',
                log_callback,
            )
    elif catalog_items and not args.dry_run and not catalog_destinations_configured:
        # R2 uploaded but no catalog destination configured — still queue for later.
        save_pending_catalog_items(catalog_items_by_path, pending_catalog_path)
        emit_message(
            '未设置 PHOTO_CATALOG_PATH / --catalog，也未设置 PHOTO_CATALOG_REMOTE_PATH / --catalog-remote；'
            f'已保留待同步队列 {pending_catalog_path}（{len(catalog_items_by_path)} 条）',
            log_callback,
        )
    elif pending_before and not args.dry_run and not catalog_destinations_configured:
        emit_message(
            f'存在待同步图库目录队列（{len(pending_before)} 条），但未配置 catalog 路径：{pending_catalog_path}',
            log_callback,
        )

    if should_discard_prepared_cache():
        discard_prepared_cache_dir()
        emit_message('已清理临时 prepared cache', log_callback)

    uploaded = counters['uploaded']
    skipped = counters['skipped']
    dry = counters['dry-run']
    failed = counters['failed']

    if args.dry_run:
        emit_message(f'完成。演练 {dry}，失败 {failed}', log_callback)
    else:
        emit_message(f'完成。上传 {uploaded}，跳过 {skipped}，失败 {failed}', log_callback)
    return 0 if failed == 0 else 1


class ChineseArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault('add_help', False)
        super().__init__(*args, **kwargs)
        self._positionals.title = '位置参数'
        self._optionals.title = '选项'
        self.add_argument('-h', '--help', action='help', default=argparse.SUPPRESS, help='显示此帮助信息并退出')


def build_parser() -> argparse.ArgumentParser:
    parser = ChineseArgumentParser(
        description=(
            '上传本地图片到 Cloudflare R2。'
            '成功后可合并更新 photos-index.json：'
            '本机用 --catalog / PHOTO_CATALOG_PATH；'
            '脚本与 API 不在同一机时用 --catalog-remote / PHOTO_CATALOG_REMOTE_PATH + LINUX SSH（只传 JSON，不传图）。'
        ),
    )

    common_group = parser.add_argument_group('通用参数')
    common_group.add_argument('--dir', default='.', help='要扫描的目录，默认当前目录。')
    common_group.add_argument(
        '--env-file',
        default=None,
        help=(
            '从指定配置文件加载变量。'
            '省略时自动读取脚本同目录 upload_r2.env / .env，再尝试当前工作目录同名文件。'
        ),
    )
    common_group.add_argument('--recursive', action='store_true', help='递归扫描子目录。')
    common_group.add_argument('--workers', type=int, default=16, help='并行上传数量，默认 16。')
    common_group.add_argument('--no-skip-existing', action='store_true', help='即使目标已存在也继续上传。')
    common_group.add_argument('--refresh-cache', action='store_true', help='检查目标前先清空本地上传缓存。')
    common_group.add_argument('--dry-run', action='store_true', help='只列出上传目标，不实际发送请求。')
    common_group.add_argument('--verify-remote', action='store_true', help='仅对本地待上传目标精确校验远端是否存在。')
    common_group.add_argument('--sync-cache-only', action='store_true', help='仅同步本地缓存，不执行实际上传。')
    common_group.add_argument('--compression', choices=COMPRESSION_MODE_CHOICES, default=DEFAULT_COMPRESSION_MODE, help='上传前压缩方式，默认 avif-lossless。')
    common_group.add_argument('--replace-remote-png', action='store_true', help='AVIF 上传确认成功后删除同路径旧 PNG 文件。')
    common_group.add_argument('--replace-remote-avif', action='store_true', help='即使同路径 AVIF 已存在也重新上传，用于替换旧有损 AVIF。')
    common_group.add_argument(
        '--target',
        choices=('r2',),
        default='r2',
        help='上传目标，仅支持 r2（兼容后端/脚本传参）。',
    )
    common_group.add_argument(
        '--catalog',
        default=None,
        help=(
            '本机 photos-index.json 路径。上传成功后按 path 合并写入；'
            '未传时使用 upload_r2.env / PHOTO_CATALOG_PATH。'
        ),
    )
    common_group.add_argument(
        '--catalog-remote',
        default=None,
        help=(
            '远端服务器上的 photos-index.json 路径（SFTP）。'
            '脚本与 API 不在同一机时使用；需 LINUX_UPLOAD_HOST/USER + KEY 或 PASSWORD。'
            '未传时使用 PHOTO_CATALOG_REMOTE_PATH。不会上传图片到 Linux。'
        ),
    )
    common_group.add_argument(
        '--sort-time',
        choices=SORT_TIME_MODE_CHOICES,
        default=None,
        help=(
            '写入 catalog 时 sortTime 的来源。默认 upload（UTC 当前时间，新作品出现在 newest 排序顶部）；'
            'source-mtime 使用源文件修改时间（历史批量归档）。'
            f'未传时读取环境变量 {SORT_TIME_MODE_ENV}；无效或空则回退 upload。CLI 优先于环境变量。'
        ),
    )

    r2_group = parser.add_argument_group('R2 参数')
    r2_group.add_argument('--bucket', default=None, help='目标桶名称。')
    r2_group.add_argument('--prefix', default=None, help='对象键前缀，默认 gallery。')
    r2_group.add_argument('--endpoint', default=None, help='R2 的 S3 Endpoint。')
    r2_group.add_argument('--region', default=None, help='签名区域，默认 auto。')
    r2_group.add_argument('--r2-proxy', default=None, help='R2 请求代理地址，例如 http://127.0.0.1:7890。')

    linux_group = parser.add_argument_group('目录远程 SSH 参数（仅 photos-index.json）')
    linux_group.add_argument('--linux-host', default=None, help='远程目录服务器主机名或 IP。')
    linux_group.add_argument('--linux-user', default=None, help='远程目录服务器 SSH 用户名。')
    linux_group.add_argument('--linux-key', default=None, help='远程目录合并使用的 SSH 私钥路径。')
    linux_group.add_argument('--linux-password', default=None, help='远程目录合并使用的 SSH 密码。')
    linux_group.add_argument('--linux-port', type=int, default=None, help='SSH 端口，默认 22。')
    linux_group.add_argument('--linux-proxy', default=None, help='SSH 代理地址，例如 socks5://127.0.0.1:1080。')

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.sync_cache_only and args.dry_run:
        parser.error('--sync-cache-only 与 --dry-run 不能同时使用。')
    if args.sync_cache_only and args.verify_remote:
        parser.error('--sync-cache-only 与 --verify-remote 不能同时使用。')
    if args.sync_cache_only and args.no_skip_existing:
        parser.error('--sync-cache-only 与 --no-skip-existing 不能同时使用。')

    return run_upload(args)


if __name__ == '__main__':
    raise SystemExit(main())
