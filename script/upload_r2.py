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
import qiniu
import shutil
import socks
import subprocess
import sys
import tempfile
from typing import Iterable
from urllib import parse

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg', '.avif', '.heic'}
DEFAULT_BUCKET = 'static-bucket'
DEFAULT_PREFIX = 'gallery'
DEFAULT_ENDPOINT = 'https://f0133bcc4ae158edd8a2784b257d6024.r2.cloudflarestorage.com'
CACHE_FILE_NAME = '.upload_target_cache.json'
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
AVIF_CONVERTIBLE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'}
AVIF_OUTPUT_SUFFIX = '.avif'
EXISTENCE_CHECK_MAX_WORKERS = 16
QINIU_EXISTENCE_CHECK_MAX_WORKERS = 4
QINIU_STAT_RETRY_STATUS_CODES = {502}
QINIU_STAT_MAX_ATTEMPTS = 3
LINUX_EXISTING_PHOTOS_API_URL = 'https://aigc.nyaneko.cn/api/photos?mediaSource=local'


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
    return Path(__file__).resolve().parent / CACHE_FILE_NAME


def get_prepared_cache_dir() -> Path:
    return Path(__file__).resolve().parent / PREPARED_CACHE_DIR_NAME


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
    return 'all' if target == 'both' else target


def targets_for_mode(target: str) -> tuple[str, ...]:
    normalized_target = normalize_target(target)
    if normalized_target == 'r2':
        return ('r2',)
    if normalized_target == 'linux':
        return ('linux',)
    if normalized_target == 'qiniu':
        return ('qiniu',)
    return ('r2', 'linux', 'qiniu')


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


def build_qiniu_cache_key(bucket: str, object_key: str) -> str:
    return f'{bucket}|{object_key}'


def build_linux_cache_key(host: str, remote_path: str) -> str:
    return f'{host}|{remote_path}'


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


def get_cached_existing_linux_paths(
    files: list[Path],
    *,
    base_dir: Path,
    remote_dir: str,
    host: str,
    cache_data: dict,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
) -> set[str]:
    return get_cached_existing_targets_from_index(
        files,
        cache_data=cache_data,
        base_dir=base_dir,
        target_label='linux',
        remote_id_builder=lambda path: build_effective_linux_remote_path(path, base_dir=base_dir, remote_dir=remote_dir, compression=compression),
        target_id_builder=lambda remote_path: build_linux_cache_key(host, remote_path),
        semantics_builder=lambda path: get_expected_upload_cache_semantics(path, compression),
    )


def list_existing_linux_filenames(api_url: str = LINUX_EXISTING_PHOTOS_API_URL) -> tuple[set[str], str | None]:
    from urllib import request

    existing_filenames: set[str] = set()
    try:
        with request.urlopen(api_url) as response:
            payload = response.read()
        data = json.loads(payload.decode('utf-8'))
        items = data.get('items', [])
        if not isinstance(items, list):
            return existing_filenames, 'invalid linux existing photos payload: items is not a list'
        for item in items:
            if not isinstance(item, dict):
                continue
            filename = item.get('filename')
            if isinstance(filename, str) and filename:
                existing_filenames.add(filename)
        return existing_filenames, None
    except Exception as exc:
        return existing_filenames, str(exc)


def has_unique_basenames(files: list[Path]) -> bool:
    basenames = [path.name for path in files]
    return len(basenames) == len(set(basenames))


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

    if items and has_unique_basenames([Path(item.relative_path) for item in items]):
        filename_hits, filename_error = list_existing_linux_filenames(LINUX_EXISTING_PHOTOS_API_URL)
        if filename_error:
            raise RuntimeError(filename_error)

    for item in items:
        path = item.source_path
        remote_path = build_linux_remote_path(
            path,
            base_dir=base_dir,
            remote_dir=config.linux_dir or '',
            compression_strategy=item.compression_strategy,
        )
        upload_name = Path(item.relative_path).name
        if upload_name in filename_hits:
            message = f'跳过 {path.name} -> {(config.linux_user or "")}@{(config.linux_host or "")}:{remote_path}'
            existing_paths.add(remote_path)
            skip_results.append((path, ('skipped', message, item.compressed, item.compression_strategy)))
            confirmed += 1
            continue

        remote_skip_kwargs = {
            'base_dir': base_dir,
            'remote_dir': config.linux_dir or '',
            'host': config.linux_host or '',
            'user': config.linux_user or '',
            'ssh_key': config.linux_key,
            'password': config.linux_password,
            'port': config.linux_port,
            'proxy_url': config.linux_proxy,
        }
        if is_avif_compression_strategy(item.compression_strategy):
            remote_skip_kwargs['compression_strategy'] = item.compression_strategy
        remote_skip_result = check_linux_remote_skip_result(path, **remote_skip_kwargs)
        if remote_skip_result is None:
            continue

        status, message = remote_skip_result
        if status != 'skipped':
            raise RuntimeError(message)
        existing_paths.add(remote_path)
        skip_results.append((path, ('skipped', message, item.compressed, item.compression_strategy)))
        confirmed += 1

    return existing_paths, skip_results, confirmed


def get_cached_existing_qiniu_keys(
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
        target_label='qiniu',
        remote_id_builder=lambda path: build_effective_object_key(path, base_dir=base_dir, prefix=prefix, compression=compression),
        target_id_builder=lambda object_key: build_qiniu_cache_key(bucket, object_key),
        semantics_builder=lambda path: get_expected_upload_cache_semantics(path, compression),
    )


def get_target_cache_id(target_label: str, path: Path, *, base_dir: Path, config: UploadRuntimeConfig) -> str:
    if target_label == 'r2':
        return build_r2_cache_key(
            config.bucket,
            build_effective_object_key(path, base_dir=base_dir, prefix=config.prefix.strip('/'), compression=config.compression),
        )
    if target_label == 'linux':
        return build_linux_cache_key(
            config.linux_host or '',
            build_effective_linux_remote_path(path, base_dir=base_dir, remote_dir=config.linux_dir or '', compression=config.compression),
        )
    if target_label == 'qiniu':
        return build_qiniu_cache_key(
            config.qiniu_bucket,
            build_effective_object_key(path, base_dir=base_dir, prefix=config.qiniu_prefix.strip('/'), compression=config.compression),
        )
    raise ValueError(f'Unsupported target label: {target_label}')


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


def update_linux_cache_entry(
    cache_data: dict,
    *,
    base_dir: Path,
    host: str,
    remote_path: str,
    path: Path,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    target_id = build_linux_cache_key(host, remote_path)
    return apply_target_result_to_cache(
        cache_data,
        path,
        base_dir=base_dir,
        target_label='linux',
        target_id=target_id,
        status='uploaded',
        compressed=compressed,
        compression_strategy=compression_strategy,
    )


def update_qiniu_cache_entry(
    cache_data: dict,
    *,
    base_dir: Path,
    bucket: str,
    object_key: str,
    path: Path,
    compressed: bool,
    compression_strategy: str | None,
) -> bool:
    target_id = build_qiniu_cache_key(bucket, object_key)
    return apply_target_result_to_cache(
        cache_data,
        path,
        base_dir=base_dir,
        target_label='qiniu',
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
    if not path.exists() or not path.is_file():
        return False

    for raw_line in path.read_text(encoding='utf-8-sig').splitlines():
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
    target = normalize_target(args.target)
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

    linux_host = getattr(args, 'linux_host', None) or env_first('LINUX_UPLOAD_HOST')
    linux_user = getattr(args, 'linux_user', None) or env_first('LINUX_UPLOAD_USER')
    linux_dir = getattr(args, 'linux_dir', None) or env_first('LINUX_UPLOAD_DIR')
    linux_key = getattr(args, 'linux_key', None)
    linux_password_arg = getattr(args, 'linux_password', None)
    if linux_key is None and linux_password_arg is None:
        linux_key = env_first('LINUX_UPLOAD_KEY')
    linux_password = linux_password_arg or env_first('LINUX_UPLOAD_PASSWORD')
    linux_port = getattr(args, 'linux_port', None) or int(env_first('LINUX_UPLOAD_PORT') or '22')
    linux_proxy = getattr(args, 'linux_proxy', None) or env_first('LINUX_PROXY')

    qiniu_bucket = getattr(args, 'qiniu_bucket', None) or env_first('QINIU_BUCKET') or bucket
    qiniu_prefix_arg = getattr(args, 'qiniu_prefix', None)
    qiniu_prefix = qiniu_prefix_arg if qiniu_prefix_arg is not None else (env_first('QINIU_PREFIX') or prefix)
    qiniu_access_key = env_first('QINIU_ACCESS_KEY')
    qiniu_secret_key = env_first('QINIU_SECRET_KEY')

    return UploadRuntimeConfig(
        target=target,
        bucket=bucket,
        prefix=prefix,
        region=region,
        endpoint=endpoint,
        r2_proxy=r2_proxy,
        linux_host=linux_host,
        linux_user=linux_user,
        linux_dir=linux_dir,
        linux_key=linux_key,
        linux_password=linux_password,
        linux_port=linux_port,
        linux_proxy=linux_proxy,
        qiniu_bucket=qiniu_bucket,
        qiniu_prefix=qiniu_prefix,
        qiniu_access_key=qiniu_access_key,
        qiniu_secret_key=qiniu_secret_key,
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


def list_existing_qiniu_keys(
    bucket: str,
    object_keys: list[str],
    access_key: str,
    secret_key: str,
) -> tuple[set[str], str | None]:
    existing_keys: set[str] = set()

    try:
        auth = qiniu.Auth(access_key, secret_key)
        bucket_manager = qiniu.BucketManager(auth)
        max_workers = max(1, min(QINIU_EXISTENCE_CHECK_MAX_WORKERS, len(object_keys)))

        def check_one(object_key: str) -> tuple[str, bool]:
            last_detail = '未知七牛状态检查错误'
            for _ in range(QINIU_STAT_MAX_ATTEMPTS):
                _, info = bucket_manager.stat(bucket, object_key)
                status_code = getattr(info, 'status_code', None)
                if status_code == 612:
                    return object_key, False
                if info is not None and info.ok():
                    return object_key, True
                detail = getattr(info, 'text_body', None) or getattr(info, 'error', None) or str(info)
                if not detail or detail == 'None':
                    detail = str(info)
                if not detail or detail == 'None':
                    detail = '未知七牛状态检查错误'
                last_detail = detail
                if status_code not in QINIU_STAT_RETRY_STATUS_CODES:
                    break
            raise RuntimeError(f'{object_key}: {last_detail}')

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


def run_prepared_file_command(command: list[str], *, tool_name: str, temp_path: Path) -> None:
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
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
        executable = shutil.which('magick')
        if not executable:
            raise RuntimeError('未在 PATH 中找到 ImageMagick magick CLI，请先安装 ImageMagick 并启用 AVIF/libheif 支持')
        tool_name = 'magick'
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
    compression_strategy: str | None = None,
    auth=None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    key = build_object_key(source_path, base_dir=base_dir, prefix=prefix, compression_strategy=compression_strategy)

    if dry_run:
        return 'dry-run', f'演练 {source_path.name} -> qiniu://{bucket}/{key}'

    if skip_existing and existing_keys is not None and key in existing_keys:
        return 'skipped', f'跳过 {source_path.name} -> qiniu://{bucket}/{key}'

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
            return 'uploaded', f'已上传 {source_path.name} -> qiniu://{bucket}/{key}'
        detail = getattr(info, 'text_body', None) or getattr(info, 'error', None) or str(info)
        if not detail or detail == 'None':
            detail = str(ret)
        if not detail or detail == 'None':
            detail = '未知七牛上传错误'
        return 'failed', f'失败 {source_path.name}：{detail}'
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


def format_qiniu_error(info, ret=None, *, default: str) -> str:
    detail = getattr(info, 'text_body', None) or getattr(info, 'error', None) or str(info)
    if not detail or detail == 'None':
        detail = str(ret)
    if not detail or detail == 'None':
        detail = default
    return detail


def delete_replaced_png_from_qiniu(
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[str, str]:
    old_key = build_object_key(path, base_dir=base_dir, prefix=config.qiniu_prefix.strip('/'))
    avif_key = build_object_key(
        path,
        base_dir=base_dir,
        prefix=config.qiniu_prefix.strip('/'),
        compression_strategy=AVIF_LOSSLESS_COMPRESSION_STRATEGY,
    )
    try:
        auth = qiniu.Auth(config.qiniu_access_key or '', config.qiniu_secret_key or '')
        bucket_manager = qiniu.BucketManager(auth)
        _, avif_info = bucket_manager.stat(config.qiniu_bucket, avif_key)
        if getattr(avif_info, 'status_code', None) == 612 or avif_info is None or not avif_info.ok():
            detail = format_qiniu_error(avif_info, default='未确认 AVIF 存在')
            return 'failed', f'旧 PNG 替换失败 {path.name}：{detail}'
        ret, delete_info = bucket_manager.delete(config.qiniu_bucket, old_key)
        if delete_info is not None and delete_info.ok():
            return 'deleted', f'已删除旧 PNG {path.name} -> qiniu://{config.qiniu_bucket}/{old_key}'
        if getattr(delete_info, 'status_code', None) == 612:
            return 'skipped', f'旧 PNG 不存在 {path.name} -> qiniu://{config.qiniu_bucket}/{old_key}'
        detail = format_qiniu_error(delete_info, ret, default='未知七牛删除错误')
        return 'failed', f'旧 PNG 替换失败 {path.name}：{detail}'
    except Exception as exc:
        return 'failed', f'旧 PNG 替换失败 {path.name}：{exc}'


def delete_replaced_png_from_linux(
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[str, str]:
    old_path = build_linux_remote_path(path, base_dir=base_dir, remote_dir=config.linux_dir or '')
    avif_path = build_linux_remote_path(
        path,
        base_dir=base_dir,
        remote_dir=config.linux_dir or '',
        compression_strategy=AVIF_LOSSLESS_COMPRESSION_STRATEGY,
    )
    target = f'{config.linux_user or ""}@{config.linux_host or ""}'
    try:
        client, sftp = open_linux_sftp_client(
            host=config.linux_host or '',
            user=config.linux_user or '',
            ssh_key=config.linux_key,
            password=config.linux_password,
            port=config.linux_port,
            proxy_url=config.linux_proxy,
        )
        try:
            if not linux_sftp_path_exists(sftp, avif_path):
                return 'failed', f'旧 PNG 替换失败 {path.name}：未确认 AVIF 存在 {target}:{avif_path}'
            try:
                sftp.remove(old_path)
            except FileNotFoundError:
                return 'skipped', f'旧 PNG 不存在 {path.name} -> {target}:{old_path}'
            return 'deleted', f'已删除旧 PNG {path.name} -> {target}:{old_path}'
        finally:
            close_linux_sftp_session(client, sftp)
    except Exception as exc:
        return 'failed', f'旧 PNG 替换失败 {path.name}：{exc}'


def delete_replaced_remote_png(
    target_label: str,
    path: Path,
    *,
    base_dir: Path,
    config: UploadRuntimeConfig,
) -> tuple[str, str]:
    if target_label == 'r2':
        return delete_replaced_png_from_r2(path, base_dir=base_dir, config=config)
    if target_label == 'linux':
        return delete_replaced_png_from_linux(path, base_dir=base_dir, config=config)
    if target_label == 'qiniu':
        return delete_replaced_png_from_qiniu(path, base_dir=base_dir, config=config)
    return 'failed', f'旧 PNG 替换失败 {path.name}：不支持的目标 {target_label}'


def build_linux_remote_path(
    path: Path,
    *,
    base_dir: Path,
    remote_dir: str,
    compression_strategy: str | None = None,
) -> str:
    remote_root = PurePosixPath((remote_dir.rstrip('/') or '/'))
    relative_parts = PurePosixPath(build_upload_relative_path(
        path,
        base_dir=base_dir,
        compression_strategy=compression_strategy,
    )).parts
    if str(remote_root) == '/':
        remote_path = PurePosixPath('/')
    else:
        remote_path = remote_root
    for part in relative_parts:
        remote_path /= part
    return remote_path.as_posix()


def build_effective_linux_remote_path(path: Path, *, base_dir: Path, remote_dir: str, compression: str | None) -> str:
    _, compression_strategy = get_expected_upload_cache_semantics(path, compression)
    return build_linux_remote_path(
        path,
        base_dir=base_dir,
        remote_dir=remote_dir,
        compression_strategy=compression_strategy,
    )


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


def set_linux_remote_mtime(sftp: paramiko.SFTPClient, *, source_path: Path, remote_path: str) -> None:
    mtime = source_path.stat().st_mtime
    sftp.utime(remote_path, (mtime, mtime))


def set_linux_remote_mtime_via_ssh(
    *,
    source_path: Path,
    remote_path: str,
    target: str,
    ssh_key: str | None,
    port: int,
) -> None:
    mtime = source_path.stat().st_mtime
    ssh_cmd = [
        'ssh', '-i', ssh_key or '',
        '-p', str(port),
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        target,
        f'touch -m -d @{mtime} -- {remote_path}',
    ]
    subprocess.run(ssh_cmd, check=True, capture_output=True, text=True)


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


def upload_file_via_sftp(
    sftp: paramiko.SFTPClient,
    *,
    source_path: Path,
    upload_path: Path,
    remote_path: str,
) -> None:
    sftp.put(str(upload_path), remote_path)
    set_linux_remote_mtime(sftp, source_path=source_path, remote_path=remote_path)


def upload_linux_file_with_sftp(
    sftp: paramiko.SFTPClient,
    *,
    source_path: Path,
    upload_path: Path,
    remote_path: str,
    target: str,
    skip_existing: bool,
) -> tuple[str, str]:
    ensure_linux_remote_dirs_sftp(sftp, remote_path)
    if skip_existing and linux_sftp_path_exists(sftp, remote_path):
        return 'skipped', f'跳过 {source_path.name} -> {target}:{remote_path}'
    upload_file_via_sftp(
        sftp,
        source_path=source_path,
        upload_path=upload_path,
        remote_path=remote_path,
    )
    return 'uploaded', f'已上传 {source_path.name} -> {target}:{remote_path}'


def upload_to_linux_via_sftp(
    source_path: Path,
    *,
    upload_path: Path,
    remote_path: str,
    target: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    skip_existing: bool,
    proxy_url: str | None,
) -> tuple[str, str]:
    try:
        client, sftp = open_linux_sftp_client(
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            proxy_url=proxy_url,
        )
        try:
            return upload_linux_file_with_sftp(
                sftp,
                source_path=source_path,
                upload_path=upload_path,
                remote_path=remote_path,
                target=target,
                skip_existing=skip_existing,
            )
        finally:
            sftp.close()
    except Exception as exc:
        return 'failed', f'失败 {source_path.name}：{exc}'
    finally:
        if 'client' in locals():
            client.close()


def check_linux_remote_skip_via_sftp(
    source_path: Path,
    *,
    remote_path: str,
    target: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
) -> tuple[str, str] | None:
    try:
        client, sftp = open_linux_sftp_client(
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            proxy_url=proxy_url,
        )
        try:
            if linux_sftp_path_exists(sftp, remote_path):
                return 'skipped', f'跳过 {source_path.name} -> {target}:{remote_path}'
            return None
        finally:
            sftp.close()
    except Exception as exc:
        return 'failed', f'失败 {source_path.name}：{exc}'
    finally:
        if 'client' in locals():
            client.close()


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
    existing_paths: set[str] | None = None,
    compression_strategy: str | None = None,
    proxy_url: str | None = None,
) -> tuple[str, str]:
    upload_path = upload_path or source_path
    remote_path = build_linux_remote_path(source_path, base_dir=base_dir, remote_dir=remote_dir, compression_strategy=compression_strategy)
    target = f'{user}@{host}'

    if dry_run:
        return 'dry-run', f'演练 {source_path.name} -> {target}:{remote_path}'

    if skip_existing and existing_paths is not None and remote_path in existing_paths:
        return 'skipped', f'跳过 {source_path.name} -> {target}:{remote_path}'

    use_sftp = (password and not ssh_key) or proxy_url
    if use_sftp:
        return upload_to_linux_via_sftp(
            source_path,
            upload_path=upload_path,
            remote_path=remote_path,
            target=target,
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            skip_existing=skip_existing,
            proxy_url=proxy_url,
        )

    ssh_base_cmd = [
        'ssh', '-i', ssh_key or '',
        '-p', str(port),
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        target,
    ]
    mkdir_cmd = [*ssh_base_cmd, 'mkdir', '-p', str(PurePosixPath(remote_path).parent)]
    exists_cmd = [*ssh_base_cmd, 'test', '!', '-e', remote_path]
    scp_cmd = [
        'scp', '-i', ssh_key or '',
        '-P', str(port),
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        str(upload_path),
        f'{target}:{remote_path}',
    ]

    try:
        subprocess.run(mkdir_cmd, check=True, capture_output=True, text=True)
        if skip_existing:
            try:
                subprocess.run(exists_cmd, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError as exc:
                if exc.returncode == 1:
                    return 'skipped', f'跳过 {source_path.name} -> {target}:{remote_path}'
                detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
                return 'failed', f'失败 {source_path.name}：{detail}'
        subprocess.run(scp_cmd, check=True, capture_output=True, text=True)
        set_linux_remote_mtime_via_ssh(
            source_path=source_path,
            remote_path=remote_path,
            target=target,
            ssh_key=ssh_key,
            port=port,
        )
        return 'uploaded', f'已上传 {source_path.name} -> {target}:{remote_path}'
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        return 'failed', f'失败 {source_path.name}：{detail}'


def check_linux_remote_skip_result(
    source_path: Path,
    *,
    base_dir: Path,
    remote_dir: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str | None,
    port: int,
    proxy_url: str | None,
    compression_strategy: str | None = None,
) -> tuple[str, str] | None:
    remote_path = build_linux_remote_path(source_path, base_dir=base_dir, remote_dir=remote_dir, compression_strategy=compression_strategy)
    target = f'{user}@{host}'

    use_sftp = (password and not ssh_key) or proxy_url
    if use_sftp:
        return check_linux_remote_skip_via_sftp(
            source_path,
            remote_path=remote_path,
            target=target,
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            proxy_url=proxy_url,
        )

    ssh_base_cmd = [
        'ssh', '-i', ssh_key or '',
        '-p', str(port),
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        target,
    ]
    exists_cmd = [*ssh_base_cmd, 'test', '-e', remote_path]
    try:
        subprocess.run(exists_cmd, check=True, capture_output=True, text=True)
        return 'skipped', f'跳过 {source_path.name} -> {target}:{remote_path}'
    except subprocess.CalledProcessError as exc:
        if exc.returncode == 1:
            return None
        detail = exc.stderr.strip() or exc.stdout.strip() or str(exc)
        return 'failed', f'失败 {source_path.name}：{detail}'


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
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
    log_callback=None,
) -> list[tuple[PlannedUpload, tuple[str, str]]]:
    if not items:
        return []

    target = f'{user}@{host}'
    client: paramiko.SSHClient | None = None
    sftp: paramiko.SFTPClient | None = None
    needs_reconnect = True
    use_legacy_per_file_upload = False
    allow_legacy_fallback = ssh_key is not None and password is None and not proxy_url
    results: list[tuple[PlannedUpload, tuple[str, str]]] = []
    compression = normalize_compression_mode(compression)
    compression_total = count_preparable_uploads(items)
    compression_index = 0

    try:
        for item in items:
            path = item.source_path
            remote_path = build_linux_remote_path(path, base_dir=base_dir, remote_dir=remote_dir, compression_strategy=item.compression_strategy)
            prepared: PreparedUpload | None = None
            try:
                if not use_legacy_per_file_upload and needs_reconnect:
                    try:
                        client, sftp = open_linux_sftp_client(
                            host=host,
                            user=user,
                            ssh_key=ssh_key,
                            password=password,
                            port=port,
                            proxy_url=proxy_url,
                        )
                        needs_reconnect = False
                    except Exception:
                        if not allow_legacy_fallback:
                            raise
                        use_legacy_per_file_upload = True

                prepared = call_prepare_upload_file(path, compression)
                if prepared.compressed:
                    compression_index += 1
                    emit_compression_progress(
                        'linux',
                        index=compression_index,
                        total=compression_total,
                        prepared=prepared,
                        log_callback=log_callback,
                    )
                if use_legacy_per_file_upload:
                    status, message = upload_to_linux(
                        path,
                        upload_path=prepared.upload_path,
                        base_dir=base_dir,
                        remote_dir=remote_dir,
                        host=host,
                        user=user,
                        ssh_key=ssh_key,
                        password=password,
                        port=port,
                        dry_run=False,
                        skip_existing=False,
                        existing_paths=None,
                        proxy_url=proxy_url,
                    )
                    results.append((item, (status, message)))
                    continue

                try:
                    status, message = upload_linux_file_with_sftp(
                        sftp,
                        source_path=path,
                        upload_path=prepared.upload_path,
                        remote_path=remote_path,
                        target=target,
                        skip_existing=False,
                    )
                except Exception as exc:
                    if not is_linux_sftp_connection_error(exc):
                        raise
                    close_linux_sftp_session(client, sftp)
                    client = None
                    sftp = None
                    needs_reconnect = True
                    try:
                        client, sftp = open_linux_sftp_client(
                            host=host,
                            user=user,
                            ssh_key=ssh_key,
                            password=password,
                            port=port,
                            proxy_url=proxy_url,
                        )
                        needs_reconnect = False
                    except Exception:
                        if not allow_legacy_fallback:
                            raise
                        use_legacy_per_file_upload = True
                        status, message = upload_to_linux(
                            path,
                            upload_path=prepared.upload_path,
                            base_dir=base_dir,
                            remote_dir=remote_dir,
                            host=host,
                            user=user,
                            ssh_key=ssh_key,
                            password=password,
                            port=port,
                            dry_run=False,
                            skip_existing=False,
                            existing_paths=None,
                            compression_strategy=prepared.compression_strategy,
                            proxy_url=proxy_url,
                        )
                        results.append((item, (status, message)))
                        continue
                    try:
                        status, message = upload_linux_file_with_sftp(
                            sftp,
                            source_path=path,
                            upload_path=prepared.upload_path,
                            remote_path=remote_path,
                            target=target,
                            skip_existing=False,
                        )
                    except Exception as retry_exc:
                        if not is_linux_sftp_connection_error(retry_exc):
                            raise
                        close_linux_sftp_session(client, sftp)
                        client = None
                        sftp = None
                        needs_reconnect = True
                        if not allow_legacy_fallback:
                            raise
                        use_legacy_per_file_upload = True
                        status, message = upload_to_linux(
                            path,
                            upload_path=prepared.upload_path,
                            base_dir=base_dir,
                            remote_dir=remote_dir,
                            host=host,
                            user=user,
                            ssh_key=ssh_key,
                            password=password,
                            port=port,
                            dry_run=False,
                            skip_existing=False,
                            existing_paths=None,
                            compression_strategy=prepared.compression_strategy,
                            proxy_url=proxy_url,
                        )
                        results.append((item, (status, message)))
                        continue
                results.append((item, (status, message)))
            except Exception as exc:
                if is_linux_sftp_connection_error(exc):
                    close_linux_sftp_session(client, sftp)
                    client = None
                    sftp = None
                    needs_reconnect = True
                error_prefix = 'Linux 连接失败，' if prepared is None else '压缩失败，'
                results.append((item, ('failed', f'失败 {path.name}：{error_prefix}{exc}')))
            finally:
                if prepared is not None:
                    cleanup_prepared_upload(prepared)
    finally:
        close_linux_sftp_session(client, sftp)
    return results


def upload_files_to_linux_via_password(
    files: list[Path],
    *,
    base_dir: Path,
    remote_dir: str,
    host: str,
    user: str,
    ssh_key: str | None,
    password: str,
    port: int,
    dry_run: bool,
    skip_existing: bool,
    existing_paths: set[str] | None,
    proxy_url: str | None = None,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
) -> list[tuple[str, str, bool, str | None]]:
    compression = normalize_compression_mode(compression)
    if dry_run:
        return [
            (
                'dry-run',
                f'演练 {path.name} -> {user}@{host}:{build_effective_linux_remote_path(path, base_dir=base_dir, remote_dir=remote_dir, compression=compression)}',
                *get_expected_upload_cache_semantics(path, compression),
            )
            for path in files
        ]

    target = f'{user}@{host}'
    planned_results: list[tuple[Path, PlannedUpload | None, tuple[str, str, bool, str | None] | None]] = []
    pending_items: list[PlannedUpload] = []
    for path in files:
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, compression)
        remote_path = build_linux_remote_path(
            path,
            base_dir=base_dir,
            remote_dir=remote_dir,
            compression_strategy=compression_strategy,
        )
        cached_result = None
        if skip_existing and existing_paths is not None and remote_path in existing_paths:
            cached_result = (
                'skipped',
                f'跳过 {path.name} -> {target}:{remote_path}',
                compressed,
                compression_strategy,
            )
            planned_results.append((path, None, cached_result))
            continue
        item = PlannedUpload(
            source_path=path,
            relative_path=build_upload_relative_path(path, base_dir=base_dir, compression_strategy=compression_strategy),
            compressed=compressed,
            compression_strategy=compression_strategy,
        )
        pending_items.append(item)
        planned_results.append((path, item, None))

    if not pending_items:
        return [cached_result for _, _, cached_result in planned_results if cached_result is not None]

    pending_results = {
        item.source_path: result
        for item, result in upload_pending_linux_files(
            pending_items,
            base_dir=base_dir,
            remote_dir=remote_dir,
            host=host,
            user=user,
            ssh_key=ssh_key,
            password=password,
            port=port,
            proxy_url=proxy_url,
            compression=compression,
        )
    }
    results: list[tuple[str, str, bool, str | None]] = []
    for path, item, cached_result in planned_results:
        if cached_result is not None:
            results.append(cached_result)
            continue
        status, message = pending_results[path]
        semantics = (item.compressed, item.compression_strategy) if item is not None and status == 'uploaded' else (False, None)
        results.append((status, message, *semantics))
    return results


def get_target_display_name(target: str) -> str:
    return {
        'r2': 'R2',
        'linux': 'Linux',
        'qiniu': '七牛',
    }.get(target, target.upper())


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


def upload_pending_qiniu_files(
    items: list[PlannedUpload],
    *,
    base_dir: Path,
    bucket: str,
    prefix: str,
    access_key: str,
    secret_key: str,
    dry_run: bool,
    skip_existing: bool,
    existing_keys: set[str] | None,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
    log_callback=None,
) -> list[tuple[PlannedUpload, tuple[str, str, bool, str | None]]]:
    if not items:
        return []
    auth = None
    if not dry_run:
        try:
            auth = qiniu.Auth(access_key, secret_key)
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
                            'qiniu',
                            index=compression_index,
                            total=compression_total,
                            prepared=prepared,
                            log_callback=log_callback,
                        )
                except Exception as exc:
                    results.append((item, ('failed', f'失败 {item.source_path.name}：压缩失败，{exc}', False, None)))
                    continue
            status, message = upload_to_qiniu(
                item.source_path,
                upload_path=prepared.upload_path,
                base_dir=base_dir,
                bucket=bucket,
                prefix=prefix,
                access_key=access_key,
                secret_key=secret_key,
                dry_run=dry_run,
                skip_existing=skip_existing,
                existing_keys=existing_keys,
                compression_strategy=prepared.compression_strategy,
                auth=auth,
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
    existing_linux_paths: set[str] | None,
    existing_linux_filenames: set[str] | None = None,
    verify_remote: bool = False,
    linux_verify_checked: bool = False,
    r2_proxy: str | None,
    linux_host: str | None,
    linux_user: str | None,
    linux_dir: str | None,
    linux_key: str | None,
    linux_password: str | None,
    linux_port: int,
    linux_proxy: str | None,
    qiniu_bucket: str,
    qiniu_prefix: str,
    qiniu_access_key: str,
    qiniu_secret_key: str,
    qiniu_existing_keys: set[str] | None,
    target_labels: tuple[str, ...] | None = None,
    compression: str | None = COMPATIBILITY_COMPRESSION_MODE,
) -> list[tuple[str, str, bool, str | None]]:
    normalized_target = normalize_target(target)
    compression = normalize_compression_mode(compression)
    label_order = tuple(target_labels) if target_labels is not None else targets_for_mode(normalized_target)
    compressed, compression_strategy = get_expected_upload_cache_semantics(path, compression)
    r2_object_key = build_object_key(path, base_dir=base_dir, prefix=prefix, compression_strategy=compression_strategy)
    linux_remote_path = build_linux_remote_path(path, base_dir=base_dir, remote_dir=linux_dir or '', compression_strategy=compression_strategy)
    qiniu_object_key = build_object_key(path, base_dir=base_dir, prefix=qiniu_prefix, compression_strategy=compression_strategy)

    if dry_run:
        prepared = PreparedUpload(
            source_path=path,
            upload_path=path,
            temp_path=None,
            compressed=False,
            compression_strategy=None,
        )
    else:
        prepared = None

    results: list[tuple[str, str, bool, str | None]] = []
    try:
        for target_label in label_order:
            if target_label == 'r2' and skip_existing and existing_keys is not None and r2_object_key in existing_keys:
                results.append(('skipped', f'跳过 {path.name} -> s3://{bucket}/{r2_object_key}', compressed, compression_strategy))
                continue
            if target_label == 'r2':
                if prepared is None:
                    try:
                        prepared = call_prepare_upload_file(path, compression)
                    except Exception as exc:
                        results.append(('failed', f'失败 {path.name}：压缩失败，{exc}', False, None))
                        continue
                status, message = upload_to_r2(
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
                    compression_strategy=prepared.compression_strategy,
                    proxy_url=r2_proxy,
                )
                semantics = get_upload_cache_semantics(prepared) if status != 'failed' else (False, None)
                results.append((status, message, *semantics))
                continue
            if target_label == 'linux' and skip_existing and existing_linux_paths is not None and linux_remote_path in existing_linux_paths:
                results.append(('skipped', f'跳过 {path.name} -> {(linux_user or "")}@{(linux_host or "")}:{linux_remote_path}', compressed, compression_strategy))
                continue
            if target_label == 'linux' and skip_existing and existing_linux_filenames is not None and path.name in existing_linux_filenames:
                results.append(('skipped', f'跳过 {path.name} -> {(linux_user or "")}@{(linux_host or "")}:{linux_remote_path}', compressed, compression_strategy))
                continue
            if target_label == 'linux':
                remote_skip_result = None
                remote_skip_checked = linux_verify_checked
                if skip_existing and verify_remote and not linux_verify_checked:
                    remote_skip_checked = True
                    remote_skip_kwargs = {
                        'base_dir': base_dir,
                        'remote_dir': linux_dir or '',
                        'host': linux_host or '',
                        'user': linux_user or '',
                        'ssh_key': linux_key,
                        'password': linux_password,
                        'port': linux_port,
                        'proxy_url': linux_proxy,
                    }
                    if is_avif_compression_strategy(compression_strategy):
                        remote_skip_kwargs['compression_strategy'] = compression_strategy
                    remote_skip_result = check_linux_remote_skip_result(path, **remote_skip_kwargs)
                if remote_skip_result is not None:
                    status, message = remote_skip_result
                    semantics = (compressed, compression_strategy) if status == 'skipped' else (False, None)
                    results.append((status, message, *semantics))
                    continue
                if prepared is None:
                    try:
                        prepared = call_prepare_upload_file(path, compression)
                    except Exception as exc:
                        results.append(('failed', f'失败 {path.name}：压缩失败，{exc}', False, None))
                        continue
                linux_pending_selected = skip_existing and (
                    (existing_linux_paths is not None and linux_remote_path not in existing_linux_paths)
                    or (existing_linux_filenames is not None and path.name not in existing_linux_filenames)
                )
                linux_skip_existing = skip_existing
                if remote_skip_checked and remote_skip_result is None:
                    linux_skip_existing = False
                elif not verify_remote and linux_pending_selected:
                    linux_skip_existing = False
                upload_linux_kwargs = {
                    'upload_path': prepared.upload_path,
                    'base_dir': base_dir,
                    'remote_dir': linux_dir or '',
                    'host': linux_host or '',
                    'user': linux_user or '',
                    'ssh_key': linux_key,
                    'password': linux_password,
                    'port': linux_port,
                    'dry_run': dry_run,
                    'skip_existing': linux_skip_existing,
                    'existing_paths': existing_linux_paths,
                    'proxy_url': linux_proxy,
                }
                if prepared.compression_strategy is not None:
                    upload_linux_kwargs['compression_strategy'] = prepared.compression_strategy
                status, message = upload_to_linux(path, **upload_linux_kwargs)
                semantics = get_upload_cache_semantics(prepared) if status != 'failed' else (False, None)
                results.append((status, message, *semantics))
                continue
            if target_label == 'qiniu' and skip_existing and qiniu_existing_keys is not None and qiniu_object_key in qiniu_existing_keys:
                results.append(('skipped', f'跳过 {path.name} -> qiniu://{qiniu_bucket}/{qiniu_object_key}', compressed, compression_strategy))
                continue
            if prepared is None:
                try:
                    prepared = call_prepare_upload_file(path, compression)
                except Exception as exc:
                    results.append(('failed', f'失败 {path.name}：压缩失败，{exc}', False, None))
                    continue
            status, message = upload_to_qiniu(
                path,
                upload_path=prepared.upload_path,
                base_dir=base_dir,
                bucket=qiniu_bucket,
                prefix=qiniu_prefix,
                access_key=qiniu_access_key,
                secret_key=qiniu_secret_key,
                dry_run=dry_run,
                skip_existing=skip_existing,
                existing_keys=qiniu_existing_keys,
                compression_strategy=prepared.compression_strategy,
            )
            semantics = get_upload_cache_semantics(prepared) if status != 'failed' else (False, None)
            results.append((status, message, *semantics))
        return results
    finally:
        if not dry_run and prepared is not None:
            cleanup_prepared_upload(prepared)


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
    target_labels = targets_for_mode(config.target)
    normalized_prefix = config.prefix.strip('/')
    normalized_qiniu_prefix = config.qiniu_prefix.strip('/')

    emit_message('模式：仅同步缓存', log_callback)

    def log_summary(label: str, *, present: int, updated: int, removed: int, unchanged: int, failed: int) -> None:
        emit_message(
            f'{label} 缓存同步：远端存在 {present}，已更新 {updated}，已移除 {removed}，未变化 {unchanged}，失败 {failed}',
            log_callback,
        )

    if 'r2' in target_labels:
        object_keys = [build_effective_object_key(path, base_dir=folder, prefix=normalized_prefix, compression=config.compression) for path in files]
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
        log_summary('R2', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    if 'linux' in target_labels:
        planned_files = []
        for path in files:
            compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            planned_files.append(PlannedUpload(
                source_path=path,
                relative_path=build_upload_relative_path(path, base_dir=folder, compression_strategy=compression_strategy),
                compressed=compressed,
                compression_strategy=compression_strategy,
            ))
        try:
            existing_linux_paths, _, _ = precheck_pending_linux_items(
                planned_files,
                base_dir=folder,
                config=config,
            )
        except RuntimeError as exc:
            emit_message(format_result_message('linux', str(exc)), log_callback)
            return 1

        present = updated = removed = unchanged = 0
        for path in files:
            compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            remote_path = build_linux_remote_path(path, base_dir=folder, remote_dir=config.linux_dir or '', compression_strategy=compression_strategy)
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
                    updated += 1
            else:
                if clear_target_synced(cache_data, path, base_dir=folder, target_label='linux'):
                    removed += 1
                else:
                    unchanged += 1
        log_summary('Linux', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    if 'qiniu' in target_labels:
        object_keys = [build_effective_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix, compression=config.compression) for path in files]
        existing_keys, list_error = list_existing_qiniu_keys(
            config.qiniu_bucket,
            object_keys,
            config.qiniu_access_key or '',
            config.qiniu_secret_key or '',
        )
        if list_error:
            emit_message(f'列出现有七牛对象失败：{list_error}', log_callback, stream=sys.stderr)
            return 1

        present = updated = removed = unchanged = 0
        for path in files:
            compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            object_key = build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix, compression_strategy=compression_strategy)
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
                    updated += 1
            else:
                if clear_target_synced(cache_data, path, base_dir=folder, target_label='qiniu'):
                    removed += 1
                else:
                    unchanged += 1
        log_summary('七牛', present=present, updated=updated, removed=removed, unchanged=unchanged, failed=0)

    emit_message('完成。缓存同步已完成，失败 0', log_callback)
    return 0



@dataclass(frozen=True)
class PrecheckResult:
    existing_keys: set[str]
    existing_linux_paths: set[str]
    existing_linux_filenames: set[str]
    qiniu_existing_keys: set[str]
    verified_linux_skip_results: list[tuple[Path, tuple[str, str, bool, str | None]]]
    remote_precheck_counts: dict[str, int]
    cache_dirty: bool


def _load_env_files(args) -> None:
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


def _validate_target_config(config: UploadRuntimeConfig, target_labels: tuple[str, ...], needs_remote: bool, *, log_callback=None) -> str | None:
    """Validate config; returns error message or None."""
    normalized_target = config.target
    if normalized_target in {'r2', 'all'}:
        if needs_remote and not config.endpoint:
            return '缺少 R2 Endpoint。请设置 --endpoint、R2_ENDPOINT 或 CLOUDFLARE_ACCOUNT_ID。'
        if needs_remote and (not config.access_key or not config.secret_key):
            return '缺少 R2 凭据。请在环境变量或 env 文件中设置 CLOUDFLARE_R2_ACCESS_KEY_ID/CLOUDFLARE_R2_SECRET_ACCESS_KEY 或 AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY。'
    if normalized_target in {'linux', 'all'} and (
        not config.linux_host or not config.linux_user or not config.linux_dir
        or (not config.linux_key and not config.linux_password)
    ):
        return '缺少 Linux 上传配置。请设置 --linux-host、--linux-user、--linux-dir，并提供 --linux-key 或 --linux-password，或使用对应环境变量。'
    if normalized_target in {'qiniu', 'all'}:
        if not config.qiniu_bucket:
            return '缺少七牛桶名称。请设置 --qiniu-bucket、QINIU_BUCKET 或 --bucket。'
        if needs_remote and (not config.qiniu_access_key or not config.qiniu_secret_key):
            return '缺少七牛凭据。请设置 QINIU_ACCESS_KEY 和 QINIU_SECRET_KEY。'
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
) -> tuple[set[str] | None, set[str] | None, set[str] | None, set[str] | None]:
    """Build initial existing sets from cache hits (non-pending items)."""
    normalized_prefix = config.prefix.strip('/')
    normalized_qiniu_prefix = config.qiniu_prefix.strip('/')
    existing_keys: set[str] | None = None
    existing_linux_paths: set[str] | None = None
    existing_linux_filenames: set[str] | None = None
    qiniu_existing_keys: set[str] | None = None

    if 'r2' in target_labels and skip_existing:
        pending_r2_paths = {p.source_path for p in pending_by_target.get('r2', [])}
        existing_keys = {
            build_effective_object_key(p, base_dir=folder, prefix=normalized_prefix, compression=config.compression)
            for p in files if p not in pending_r2_paths
        }
    if 'linux' in target_labels and skip_existing:
        pending_linux_paths = {p.source_path for p in pending_by_target.get('linux', [])}
        existing_linux_paths = {
            build_effective_linux_remote_path(p, base_dir=folder, remote_dir=config.linux_dir or '', compression=config.compression)
            for p in files if p not in pending_linux_paths
        }
    if 'qiniu' in target_labels and skip_existing:
        pending_qiniu_paths = {p.source_path for p in pending_by_target.get('qiniu', [])}
        qiniu_existing_keys = {
            build_effective_object_key(p, base_dir=folder, prefix=normalized_qiniu_prefix, compression=config.compression)
            for p in files if p not in pending_qiniu_paths
        }
    return existing_keys, existing_linux_paths, existing_linux_filenames, qiniu_existing_keys


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
    """Generic precheck for R2 and Qiniu object stores. Returns (updated_existing_keys, confirmed_count, cache_dirty)."""
    if not should_precheck_pending_targets(
        skip_existing=skip_existing,
        dry_run=dry_run,
        verify_remote=verify_remote,
        cache_data=cache_data,
        target_label=target_label,
    ):
        return existing_keys, 0, False

    cache_dirty = False
    if target_label == 'r2':
        prefix = config.prefix.strip('/')
        pending_keys = [build_object_key(item.source_path, base_dir=folder, prefix=prefix, compression_strategy=item.compression_strategy) for item in pending_items]
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
        files_by_key = {build_effective_object_key(p, base_dir=folder, prefix=prefix, compression=config.compression): p for p in files}
        for object_key in online_keys:
            path = files_by_key.get(object_key)
            if path is None:
                continue
            compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
            if update_r2_cache_entry(cache_data, base_dir=folder, bucket=config.bucket,
                                     object_key=object_key, path=path,
                                     compressed=compressed, compression_strategy=compression_strategy):
                cache_dirty = True
        return existing_keys, len(online_keys), cache_dirty

    # qiniu
    prefix = config.qiniu_prefix.strip('/')
    pending_keys = [build_object_key(item.source_path, base_dir=folder, prefix=prefix, compression_strategy=item.compression_strategy) for item in pending_items]
    if not pending_keys:
        return existing_keys, 0, False
    emit_message(f'正在预检待上传的七牛对象（{len(pending_keys)} 个）...', log_callback)
    online_keys, list_error = list_existing_qiniu_keys(
        config.qiniu_bucket, pending_keys,
        config.qiniu_access_key or '', config.qiniu_secret_key or '',
    )
    if list_error:
        emit_message(f'七牛预检失败：{list_error}', log_callback, stream=sys.stderr)
        raise RuntimeError(f'七牛预检失败：{list_error}')
    existing_keys = (existing_keys or set()) | online_keys
    files_by_key = {build_effective_object_key(p, base_dir=folder, prefix=prefix, compression=config.compression): p for p in files}
    for object_key in online_keys:
        path = files_by_key.get(object_key)
        if path is None:
            continue
        compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
        if update_qiniu_cache_entry(cache_data, base_dir=folder, bucket=config.qiniu_bucket,
                                    object_key=object_key, path=path,
                                    compressed=compressed, compression_strategy=compression_strategy):
            cache_dirty = True
    return existing_keys, len(online_keys), cache_dirty


def _precheck_linux_target(
    pending_items: list[PlannedUpload],
    *,
    config: UploadRuntimeConfig,
    folder: Path,
    cache_data: dict,
    skip_existing: bool,
    dry_run: bool,
    verify_remote: bool,
    log_callback=None,
) -> tuple[set[str] | None, list[tuple[Path, tuple[str, str, bool, str | None]]], int, bool, bool]:
    """Returns (existing_linux_paths, verified_skip_results, confirmed, precheck_completed, cache_dirty)."""
    if not should_precheck_pending_targets(
        skip_existing=skip_existing, dry_run=dry_run, verify_remote=verify_remote,
        cache_data=cache_data, target_label='linux',
    ):
        return None, [], 0, False, False

    cache_dirty = False
    try:
        prechecked_paths, verified_skip_results, confirmed = precheck_pending_linux_items(
            pending_items, base_dir=folder, config=config,
        )
    except RuntimeError as exc:
        emit_message(format_result_message('linux', str(exc)), log_callback)
        raise
    for path, result in verified_skip_results:
        remote_path = build_linux_remote_path(
            path,
            base_dir=folder,
            remote_dir=config.linux_dir or '',
            compression_strategy=result[3],
        )
        if update_linux_cache_entry(cache_data, base_dir=folder, host=config.linux_host or '',
                                    remote_path=remote_path, path=path,
                                    compressed=result[2], compression_strategy=result[3]):
            cache_dirty = True
    return prechecked_paths, verified_skip_results, confirmed, True, cache_dirty


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
    emit_message('========== 上传摘要 ==========', log_callback)
    target_names = {'r2': 'R2', 'linux': 'Linux', 'qiniu': '七牛'}
    active = [target_names[t] for t in target_labels]
    emit_message(f'目标：{" + ".join(active)}', log_callback)
    emit_message(f'模式：{"演练" if dry_run else "上传"}', log_callback)
    emit_message(f'跳过已存在文件：{"是" if skip_existing else "否"}', log_callback)
    if config.replace_remote_avif:
        emit_message('替换远端 AVIF：是', log_callback)
    for label in target_labels:
        name = target_names[label]
        pending = len(pending_by_target.get(label, []))
        cache_hits = local_cache_hits.get(label, 0)
        remote_confirmed = remote_precheck_counts.get(label, 0)
        existing = cache_hits + remote_confirmed
        emit_message(f'  {name}：待处理 {pending} | 已存在 {existing}（缓存命中 {cache_hits}，远端确认 {remote_confirmed}）', log_callback)
        emit_message(f'    旧缓存迁移：{legacy_promotions.get(label, 0)}', log_callback)
    emit_message('=' * 32, log_callback)


def _format_progress(index: int, total: int, message: str) -> str:
    return f'[{index}/{total}] {message}'


def run_upload(args, log_callback=None) -> int:
    _load_env_files(args)
    config = resolve_runtime_config(args)
    normalized_target = config.target
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

    target_labels = targets_for_mode(normalized_target)
    emit_message(f'在 {folder} 中共发现 {len(files)} 个图片文件', log_callback)
    emit_message(f'目标：{" + ".join(get_target_display_name(label) for label in target_labels)}', log_callback)

    error_msg = _validate_target_config(config, target_labels, needs_remote_access, log_callback=log_callback)
    if error_msg:
        emit_message(error_msg, log_callback, stream=sys.stderr)
        return 2

    normalized_prefix = config.prefix.strip('/')
    normalized_qiniu_prefix = config.qiniu_prefix.strip('/')

    if sync_cache_only:
        cache_snapshot = json.dumps(cache_data, sort_keys=True)
        legacy_promotions = promote_legacy_cache_entries(
            files, base_dir=folder, cache_data=cache_data, config=config,
            target_labels=('r2', 'linux', 'qiniu'),
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
    legacy_promotions = {'r2': 0, 'linux': 0, 'qiniu': 0}
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

    existing_keys, existing_linux_paths, existing_linux_filenames, qiniu_existing_keys = \
        _build_existing_sets_from_cache(
            target_labels, files, pending_by_target, config, folder, skip_existing=skip_existing,
        )

    local_cache_hits = {
        'r2': max(0, len(existing_keys or set()) - legacy_promotions.get('r2', 0)),
        'linux': max(0, len(existing_linux_paths or set()) - legacy_promotions.get('linux', 0)),
        'qiniu': max(0, len(qiniu_existing_keys or set()) - legacy_promotions.get('qiniu', 0)),
    }
    remote_precheck_counts = {'r2': 0, 'linux': 0, 'qiniu': 0}
    verified_linux_skip_results: list[tuple[Path, tuple[str, str, bool, str | None]]] = []
    linux_precheck_completed = False
    verify_remote = getattr(args, 'verify_remote', False)

    # --- Precheck phase ---
    for label in target_labels:
        pending_items = pending_by_target.get(label, [])
        if not pending_items:
            continue
        if label == 'r2':
            r2_precheck_items = [item for item in pending_items if should_skip_existing_for_planned_upload(config, item)]
            existing_keys, confirmed, dirty = _precheck_object_store_target(
                'r2', r2_precheck_items, config=config, folder=folder, files=files,
                cache_data=cache_data, existing_keys=existing_keys,
                skip_existing=skip_existing, dry_run=args.dry_run,
                verify_remote=verify_remote, log_callback=log_callback,
            )
            remote_precheck_counts['r2'] = confirmed
            cache_dirty = cache_dirty or dirty
        elif label == 'linux':
            try:
                linux_precheck_items = [item for item in pending_items if should_skip_existing_for_planned_upload(config, item)]
                prechecked_paths, verified_linux_skip_results, confirmed, linux_precheck_completed, dirty = \
                    _precheck_linux_target(
                        linux_precheck_items, config=config, folder=folder, cache_data=cache_data,
                        skip_existing=skip_existing, dry_run=args.dry_run,
                        verify_remote=verify_remote, log_callback=log_callback,
                    )
                if prechecked_paths:
                    existing_linux_paths = (existing_linux_paths or set()) | prechecked_paths
                remote_precheck_counts['linux'] = confirmed
                cache_dirty = cache_dirty or dirty
            except RuntimeError:
                return 1
        elif label == 'qiniu':
            qiniu_precheck_items = [item for item in pending_items if should_skip_existing_for_planned_upload(config, item)]
            qiniu_existing_keys, confirmed, dirty = _precheck_object_store_target(
                'qiniu', qiniu_precheck_items, config=config, folder=folder, files=files,
                cache_data=cache_data, existing_keys=qiniu_existing_keys,
                skip_existing=skip_existing, dry_run=args.dry_run,
                verify_remote=verify_remote, log_callback=log_callback,
            )
            remote_precheck_counts['qiniu'] = confirmed
            cache_dirty = cache_dirty or dirty

    # --- Preflight summary ---
    _print_preflight_summary(
        config, pending_by_target, local_cache_hits, remote_precheck_counts,
        legacy_promotions, target_labels, skip_existing, args.dry_run,
        log_callback=log_callback,
    )

    # --- Build batch upload lists ---
    batch_r2_items: list[PlannedUpload] = []
    skipped_r2_results: list[tuple[Path, tuple[str, str, bool, str | None]]] = []
    if 'r2' in target_labels:
        for planned in pending_by_target.get('r2', []):
            object_key = build_object_key(planned.source_path, base_dir=folder, prefix=normalized_prefix, compression_strategy=planned.compression_strategy)
            if should_skip_existing_for_planned_upload(config, planned) and existing_keys is not None and object_key in existing_keys:
                skipped_r2_results.append(
                    (planned.source_path, ('skipped', f'跳过 {planned.source_path.name} -> s3://{config.bucket}/{object_key}', planned.compressed, planned.compression_strategy))
                )
                continue
            batch_r2_items.append(planned)
        # Also count files that were fully excluded by cache (not in pending_by_target at all)
        if existing_keys is not None:
            pending_r2_paths = {p.source_path for p in pending_by_target.get('r2', [])}
            for path in files:
                if path in pending_r2_paths:
                    continue
                compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
                object_key = build_object_key(path, base_dir=folder, prefix=normalized_prefix, compression_strategy=compression_strategy)
                if object_key in existing_keys:
                    skipped_r2_results.append(
                        (path, ('skipped', f'跳过 {path.name} -> s3://{config.bucket}/{object_key}', compressed, compression_strategy))
                    )

    batch_linux_items: list[PlannedUpload] = []
    if 'linux' in target_labels:
        for planned in pending_by_target.get('linux', []):
            remote_path = build_linux_remote_path(planned.source_path, base_dir=folder, remote_dir=config.linux_dir or '', compression_strategy=planned.compression_strategy)
            if should_skip_existing_for_planned_upload(config, planned) and existing_linux_paths is not None and remote_path in existing_linux_paths:
                continue
            batch_linux_items.append(planned)

    batch_qiniu_items: list[PlannedUpload] = []
    skipped_qiniu_results: list[tuple[Path, tuple[str, str, bool, str | None]]] = []
    if 'qiniu' in target_labels:
        for planned in pending_by_target.get('qiniu', []):
            object_key = build_object_key(planned.source_path, base_dir=folder, prefix=normalized_qiniu_prefix, compression_strategy=planned.compression_strategy)
            if should_skip_existing_for_planned_upload(config, planned) and qiniu_existing_keys is not None and object_key in qiniu_existing_keys:
                skipped_qiniu_results.append(
                    (planned.source_path, ('skipped', f'跳过 {planned.source_path.name} -> qiniu://{config.qiniu_bucket}/{object_key}', planned.compressed, planned.compression_strategy))
                )
                continue
            batch_qiniu_items.append(planned)
        # Also count files that were fully excluded by cache
        if qiniu_existing_keys is not None:
            pending_qiniu_paths = {p.source_path for p in pending_by_target.get('qiniu', [])}
            for path in files:
                if path in pending_qiniu_paths:
                    continue
                compressed, compression_strategy = get_expected_upload_cache_semantics(path, config.compression)
                object_key = build_object_key(path, base_dir=folder, prefix=normalized_qiniu_prefix, compression_strategy=compression_strategy)
                if object_key in qiniu_existing_keys:
                    skipped_qiniu_results.append(
                        (path, ('skipped', f'跳过 {path.name} -> qiniu://{config.qiniu_bucket}/{object_key}', compressed, compression_strategy))
                    )

    counters = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
    batch_log_kwargs = {'log_callback': log_callback} if log_callback is not None else {}
    batch_compression_kwargs = {'compression': config.compression} if config.compression != COMPATIBILITY_COMPRESSION_MODE else {}

    def maybe_update_cache(
        target_label: str, status: str, path: Path | None, *,
        compressed: bool = False, compression_strategy: str | None = None,
    ) -> bool:
        if path is None:
            return False
        target_id: str | None = None
        if target_label == 'r2' and status == 'uploaded':
            target_id = get_target_cache_id('r2', path, base_dir=folder, config=config)
        elif target_label == 'linux' and status in {'uploaded', 'skipped'}:
            target_id = get_target_cache_id('linux', path, base_dir=folder, config=config)
        elif target_label == 'qiniu' and status == 'uploaded':
            target_id = get_target_cache_id('qiniu', path, base_dir=folder, config=config)
        if target_id is None:
            return False
        dirty = apply_target_result_to_cache(
            cache_data, path, base_dir=folder, target_label=target_label,
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
                    record_prepared_png_metadata(cache_data, path, base_dir=folder, sha256=sha256,
                                                  compression_strategy=compression_strategy, prepared_path=prepared_path)
                    current = get_file_cache_record(cache_data, relative_path).get('prepared_png')
                else:
                    artifacts = record.get('prepared_artifacts') if isinstance(record.get('prepared_artifacts'), dict) else {}
                    previous = artifacts.get(compression_strategy)
                    record_prepared_upload_metadata(cache_data, path, base_dir=folder, sha256=sha256,
                                                    compression_strategy=compression_strategy, prepared_path=prepared_path)
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

    # --- Execute uploads ---
    if args.dry_run and batch_linux_items:
        target_str = f'{config.linux_user}@{config.linux_host}'
        for i, item in enumerate(batch_linux_items, 1):
            remote_path = build_linux_remote_path(item.source_path, base_dir=folder, remote_dir=config.linux_dir or '', compression_strategy=item.compression_strategy)
            msg = _format_progress(i, len(batch_linux_items),
                                   f'演练 {item.source_path.name} -> {target_str}:{remote_path}')
            emit_message(format_result_message('linux', msg), log_callback)
            counters['dry-run'] += 1
        batch_linux_items = []

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

    if batch_linux_items:
        emit_message(f'开始上传到 Linux（{len(batch_linux_items)} 个文件）...', log_callback)
        for i, (item, result) in enumerate(upload_pending_linux_files(
            batch_linux_items, base_dir=folder,
            remote_dir=config.linux_dir or '', host=config.linux_host or '',
            user=config.linux_user or '', ssh_key=config.linux_key,
            password=config.linux_password, port=config.linux_port,
            proxy_url=config.linux_proxy,
            **batch_compression_kwargs,
            **batch_log_kwargs,
        ), 1):
            path = item.source_path if isinstance(item, PlannedUpload) else item
            progress_msg = _format_progress(i, len(batch_linux_items), result[1])
            progress_result = (result[0], progress_msg, *result[2:]) if len(result) >= 4 else (result[0], progress_msg)
            record_result('linux', path, progress_result, emit_skipped=args.dry_run)
    # --- Record Linux precheck skip results (outside batch block) ---
    for path, result in verified_linux_skip_results:
        record_result('linux', path, result, emit_skipped=args.dry_run)

    if batch_qiniu_items:
        emit_message(f'开始上传到七牛（{len(batch_qiniu_items)} 个文件）...', log_callback)
        for i, (item, result) in enumerate(upload_pending_qiniu_files(
            batch_qiniu_items, base_dir=folder,
            bucket=config.qiniu_bucket, prefix=normalized_qiniu_prefix,
            access_key=config.qiniu_access_key or '', secret_key=config.qiniu_secret_key or '',
            dry_run=args.dry_run, skip_existing=False, existing_keys=None,
            **batch_compression_kwargs,
            **batch_log_kwargs,
        ), 1):
            path = item.source_path if isinstance(item, PlannedUpload) else item
            progress_msg = _format_progress(i, len(batch_qiniu_items), result[1])
            progress_result = (result[0], progress_msg, *result[2:]) if len(result) >= 4 else (result[0], progress_msg)
            record_result('qiniu', path, progress_result, emit_skipped=args.dry_run)

    # --- Record cached skip results ---
    for path, result in skipped_r2_results:
        record_result('r2', path, result, emit_skipped=args.dry_run)
    for path, result in skipped_qiniu_results:
        record_result('qiniu', path, result, emit_skipped=args.dry_run)

    # --- Finalize ---
    if cache_dirty:
        save_upload_cache(cache_file, cache_data)

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
    parser = ChineseArgumentParser(description='上传本地图片到 R2、Linux 服务器或七牛。')

    common_group = parser.add_argument_group('通用参数')
    common_group.add_argument('--dir', default='.', help='要扫描的目录，默认当前目录。')
    common_group.add_argument('--env-file', default=None, help='从本地配置文件加载变量，例如 .env。')
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
    common_group.add_argument('--target', choices=('r2', 'linux', 'qiniu', 'all', 'both'), default='both', help='上传目标，默认 both。')

    r2_group = parser.add_argument_group('R2 参数')
    r2_group.add_argument('--bucket', default=None, help='目标桶名称。')
    r2_group.add_argument('--prefix', default=None, help='对象键前缀，默认 gallery。')
    r2_group.add_argument('--endpoint', default=None, help='R2 的 S3 Endpoint。')
    r2_group.add_argument('--region', default=None, help='签名区域，默认 auto。')
    r2_group.add_argument('--r2-proxy', default=None, help='R2 请求代理地址，例如 http://127.0.0.1:7890。')

    linux_group = parser.add_argument_group('Linux 参数')
    linux_group.add_argument('--linux-host', default=None, help='Linux 服务器主机名或 IP。')
    linux_group.add_argument('--linux-user', default=None, help='Linux 服务器 SSH 用户名。')
    linux_group.add_argument('--linux-dir', default=None, help='Linux 服务器目标目录。')
    linux_group.add_argument('--linux-key', default=None, help='Linux 上传使用的 SSH 私钥路径。')
    linux_group.add_argument('--linux-password', default=None, help='Linux 上传使用的 SSH 密码。')
    linux_group.add_argument('--linux-port', type=int, default=None, help='Linux 上传使用的 SSH 端口，默认 22。')
    linux_group.add_argument('--linux-proxy', default=None, help='Linux 上传代理地址，例如 socks5://127.0.0.1:1080。')

    qiniu_group = parser.add_argument_group('七牛参数')
    qiniu_group.add_argument('--qiniu-bucket', default=None, help='七牛桶名称，默认取 QINIU_BUCKET 或 --bucket。')
    qiniu_group.add_argument('--qiniu-prefix', default=None, help='七牛对象键前缀，默认取 QINIU_PREFIX 或 --prefix。')

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
