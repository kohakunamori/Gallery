#!/usr/bin/env python3
"""Import already-uploaded R2 objects into backend/var/photos-index.json.

Does NOT re-upload files. Lists R2 under R2_PREFIX and writes catalog entries.
When --local-dir is provided, matches local originals to fill width/height
(and takenAt when readable).

Examples:
  # R2 only (no dimensions)
  python script/import_r2_catalog.py --env-file script/upload_r2.env --dry-run

  # R2 + local originals for dimensions
  python script/import_r2_catalog.py --env-file script/upload_r2.env \\
    --local-dir "D:/photos" --catalog backend/var/photos-index.json

  # multiple local roots
  python script/import_r2_catalog.py --env-file script/upload_r2.env \\
    --local-dir "D:/photos/a" --local-dir "D:/photos/b"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

# Reuse env/client helpers from upload_r2 without running its CLI.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import upload_r2 as ur  # noqa: E402


IMAGE_EXTS = {ext.lower() for ext in ur.IMAGE_EXTS}
SOURCE_EXTS_FOR_AVIF = {ext.lower() for ext in ur.AVIF_CONVERTIBLE_EXTS} | {'.avif'}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def mtime_to_sort_time(mtime: float | None) -> str:
    if mtime is None:
        return utc_now_iso()
    return (
        datetime.fromtimestamp(mtime, tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace('+00:00', 'Z')
    )


def load_env_files(env_file: str | None) -> None:
    class _Args:
        def __init__(self, path: str | None) -> None:
            self.env_file = path

    ur._load_env_files(_Args(env_file))


def resolve_r2_config(args: argparse.Namespace) -> dict[str, str]:
    bucket = args.bucket or ur.env_first('R2_BUCKET') or ur.DEFAULT_BUCKET
    prefix = args.prefix if args.prefix is not None else (ur.env_first('R2_PREFIX') or ur.DEFAULT_PREFIX)
    region = args.region or ur.env_first('AWS_REGION', 'AWS_DEFAULT_REGION', 'R2_REGION') or 'auto'
    access_key = ur.env_first('CLOUDFLARE_R2_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID')
    secret_key = ur.env_first('CLOUDFLARE_R2_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY')
    account_id = ur.env_first('CLOUDFLARE_ACCOUNT_ID')
    endpoint = (
        args.endpoint
        or ur.env_first('R2_ENDPOINT')
        or (f'https://{account_id}.r2.cloudflarestorage.com' if account_id else ur.DEFAULT_ENDPOINT)
    )
    proxy_url = args.r2_proxy or ur.env_first('R2_PROXY')

    if not access_key or not secret_key:
        raise SystemExit('Missing R2 credentials: set CLOUDFLARE_R2_ACCESS_KEY_ID / CLOUDFLARE_R2_SECRET_ACCESS_KEY')

    return {
        'bucket': bucket,
        'prefix': prefix.strip('/'),
        'region': region,
        'access_key': access_key,
        'secret_key': secret_key,
        'endpoint': endpoint,
        'proxy_url': proxy_url or '',
    }


def is_image_key(key: str) -> bool:
    suffix = Path(key).suffix.lower()
    if suffix in IMAGE_EXTS:
        return True
    mime, _ = mimetypes.guess_type(key)
    return bool(mime and mime.startswith('image/'))


def object_key_to_catalog_path(object_key: str, prefix: str) -> str | None:
    key = object_key.lstrip('/')
    if prefix:
        prefix_with_slash = prefix if prefix.endswith('/') else f'{prefix}/'
        if key == prefix:
            return None
        if key.startswith(prefix_with_slash):
            rel = key[len(prefix_with_slash) :]
        else:
            return None
    else:
        rel = key

    rel = str(PurePosixPath(rel))
    if not rel or rel.endswith('/'):
        return None
    if not is_image_key(rel):
        return None
    return rel


def list_r2_objects(config: dict[str, str]) -> list[dict[str, Any]]:
    client = ur.make_r2_client(
        endpoint=config['endpoint'],
        access_key=config['access_key'],
        secret_key=config['secret_key'],
        region=config['region'],
        proxy_url=config['proxy_url'] or None,
    )

    params: dict[str, Any] = {'Bucket': config['bucket']}
    if config['prefix']:
        params['Prefix'] = config['prefix'] if config['prefix'].endswith('/') else f"{config['prefix']}/"

    objects: list[dict[str, Any]] = []
    paginator = client.get_paginator('list_objects_v2')
    for page in paginator.paginate(**params):
        for item in page.get('Contents', []) or []:
            key = item.get('Key')
            if not isinstance(key, str) or not key or key.endswith('/'):
                continue
            objects.append(item)
    return objects


def path_stem_key(relative_path: str) -> str:
    posix = PurePosixPath(relative_path)
    parent = '' if str(posix.parent) in {'.', ''} else str(posix.parent)
    stem = posix.stem
    return f'{parent}/{stem}'.lstrip('/') if parent else stem


def filename_stem_key(relative_path: str) -> str:
    return PurePosixPath(relative_path).stem.casefold()


def collect_local_images(local_dirs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for root in local_dirs:
        if not root.exists():
            print(f'Warning: local dir does not exist: {root}', file=sys.stderr)
            continue
        if root.is_file():
            if root.suffix.lower() in IMAGE_EXTS:
                files.append(root.resolve())
            continue
        for path in root.rglob('*'):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
                files.append(path.resolve())
    return files


def build_local_index(local_dirs: list[Path]) -> dict[str, Any]:
    """Index local images for matching remote catalog paths.

    Keys:
      - exact relative posix path under each root
      - path-stem key (dir/stem) for png/jpg -> avif cases
      - filename-stem key as last-resort flat match
    """
    by_exact: dict[str, Path] = {}
    by_path_stem: dict[str, list[Path]] = {}
    by_name_stem: dict[str, list[Path]] = {}
    by_name: dict[str, list[Path]] = {}

    files = collect_local_images(local_dirs)
    for path in files:
        # Index under every provided root that contains this file.
        matched_root = False
        for root in local_dirs:
            root = root.resolve()
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            matched_root = True
            by_exact.setdefault(rel, path)
            by_exact.setdefault(rel.casefold(), path)
            stem_key = path_stem_key(rel)
            by_path_stem.setdefault(stem_key, []).append(path)
            by_path_stem.setdefault(stem_key.casefold(), []).append(path)
            break
        if not matched_root:
            # File passed as direct --local-dir file path.
            rel = path.name
            by_exact.setdefault(rel, path)

        by_name_stem.setdefault(path.stem.casefold(), []).append(path)
        by_name.setdefault(path.name.casefold(), []).append(path)

    return {
        'files': files,
        'by_exact': by_exact,
        'by_path_stem': by_path_stem,
        'by_name_stem': by_name_stem,
        'by_name': by_name,
    }


def pick_unique(candidates: list[Path] | None) -> Path | None:
    if not candidates:
        return None
    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    if len(unique) == 1:
        return unique[0]
    return None


def find_local_source(relative_path: str, index: dict[str, Any]) -> tuple[Path | None, str]:
    """Return (path, match_kind). match_kind: exact|path-stem|filename|filename-stem|none."""
    by_exact: dict[str, Path] = index['by_exact']
    by_path_stem: dict[str, list[Path]] = index['by_path_stem']
    by_name: dict[str, list[Path]] = index['by_name']
    by_name_stem: dict[str, list[Path]] = index['by_name_stem']

    exact = by_exact.get(relative_path) or by_exact.get(relative_path.casefold())
    if exact is not None:
        return exact, 'exact'

    # Remote avif / local png|jpg|webp...
    stem_key = path_stem_key(relative_path)
    path = pick_unique(by_path_stem.get(stem_key) or by_path_stem.get(stem_key.casefold()))
    if path is not None:
        return path, 'path-stem'

    # Same basename including extension
    name = PurePosixPath(relative_path).name
    path = pick_unique(by_name.get(name.casefold()))
    if path is not None:
        return path, 'filename'

    # Same basename stem only (flat folders / renamed dirs)
    path = pick_unique(by_name_stem.get(PurePosixPath(relative_path).stem.casefold()))
    if path is not None:
        return path, 'filename-stem'

    # If remote is .avif, try common source extensions explicitly under same relative dir.
    posix = PurePosixPath(relative_path)
    if posix.suffix.lower() == '.avif':
        parent = '' if str(posix.parent) in {'.', ''} else str(posix.parent)
        for ext in sorted(SOURCE_EXTS_FOR_AVIF):
            candidate_rel = f'{parent}/{posix.stem}{ext}'.lstrip('/') if parent else f'{posix.stem}{ext}'
            exact = by_exact.get(candidate_rel) or by_exact.get(candidate_rel.casefold())
            if exact is not None:
                return exact, 'path-stem'

    return None, 'none'


def read_taken_at(path: Path) -> str | None:
    try:
        from PIL import Image  # type: ignore
        from PIL.ExifTags import TAGS  # type: ignore
    except Exception:
        return None

    try:
        with Image.open(path) as image:
            exif = image.getexif()
            if not exif:
                return None
            # Direct tags + nested IFDs when available
            values: dict[str, Any] = {}
            for tag_id, value in exif.items():
                name = TAGS.get(tag_id, str(tag_id))
                values[name] = value
            raw = values.get('DateTimeOriginal') or values.get('DateTimeDigitized') or values.get('DateTime')
            if not isinstance(raw, str) or not raw.strip():
                return None
            # EXIF format: "YYYY:MM:DD HH:MM:SS"
            try:
                parsed = datetime.strptime(raw.strip(), '%Y:%m:%d %H:%M:%S').replace(tzinfo=timezone.utc)
                return parsed.isoformat().replace('+00:00', 'Z')
            except ValueError:
                return None
    except Exception:
        return None


def read_local_metadata(path: Path) -> dict[str, Any]:
    width, height = ur.read_image_dimensions(path)
    # AVIF/HEIC may fail without pillow-heif; try ImageMagick identify as fallback.
    if width is None or height is None:
        width, height = read_dimensions_imagemagick(path)
    taken_at = read_taken_at(path)
    try:
        mtime = path.stat().st_mtime
    except OSError:
        mtime = None
    return {
        'width': width,
        'height': height,
        'takenAt': taken_at,
        'mtime': mtime,
        'localPath': str(path),
    }


def read_dimensions_imagemagick(path: Path) -> tuple[int | None, int | None]:
    for binary in ('magick', 'identify'):
        try:
            import subprocess

            if binary == 'magick':
                cmd = ['magick', 'identify', '-format', '%w %h', str(path)]
            else:
                cmd = ['identify', '-format', '%w %h', str(path)]
            completed = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', check=False)
            if completed.returncode != 0:
                continue
            parts = completed.stdout.strip().split()
            if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
                return int(parts[0]), int(parts[1])
        except Exception:
            continue
    return None, None


def build_catalog_item_from_object(
    item: dict[str, Any],
    *,
    relative_path: str,
    local_meta: dict[str, Any] | None = None,
    prefer_local_mtime: bool = False,
) -> dict[str, Any]:
    size = int(item.get('Size') or 0)
    last_modified = item.get('LastModified')
    if hasattr(last_modified, 'timestamp'):
        remote_sort_time = mtime_to_sort_time(float(last_modified.timestamp()))
        version_seed = f'{relative_path}|{last_modified.timestamp()}|{size}'
    else:
        remote_sort_time = utc_now_iso()
        version_seed = f'{relative_path}|{remote_sort_time}|{size}'

    etag = item.get('ETag')
    if isinstance(etag, str) and etag:
        version = hashlib.sha1(f'{relative_path}|{etag}|{size}'.encode('utf-8')).hexdigest()
    else:
        version = hashlib.sha1(version_seed.encode('utf-8')).hexdigest()

    width = None
    height = None
    taken_at = None
    sort_time = remote_sort_time

    if local_meta is not None:
        width = local_meta.get('width')
        height = local_meta.get('height')
        taken_at = local_meta.get('takenAt')
        if prefer_local_mtime and local_meta.get('mtime') is not None:
            sort_time = mtime_to_sort_time(float(local_meta['mtime']))
        elif taken_at:
            # Prefer capture time for gallery ordering when available.
            sort_time = taken_at

    return {
        'path': relative_path,
        'filename': PurePosixPath(relative_path).name,
        'takenAt': taken_at,
        'sortTime': sort_time,
        'width': width if isinstance(width, int) else None,
        'height': height if isinstance(height, int) else None,
        'size': size,
        'version': version,
    }


def merge_catalog(existing_items: list[dict[str, Any]], imported: list[dict[str, Any]], *, replace: bool) -> list[dict[str, Any]]:
    by_path: dict[str, dict[str, Any]] = {}
    if not replace:
        for item in existing_items:
            path = item.get('path')
            if isinstance(path, str) and path:
                by_path[path] = item

    for item in imported:
        path = item['path']
        previous = by_path.get(path)
        if previous is not None:
            if previous.get('width') and not item.get('width'):
                item['width'] = previous.get('width')
            if previous.get('height') and not item.get('height'):
                item['height'] = previous.get('height')
            if previous.get('takenAt') and not item.get('takenAt'):
                item['takenAt'] = previous.get('takenAt')
        by_path[path] = item

    return sorted(by_path.values(), key=lambda entry: entry.get('sortTime', ''), reverse=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Import existing R2 gallery objects into photos-index.json')
    parser.add_argument('--env-file', default=None, help='Path to upload_r2.env / .env')
    parser.add_argument(
        '--catalog',
        default=None,
        help='Output catalog path (default: PHOTO_CATALOG_PATH or ../backend/var/photos-index.json)',
    )
    parser.add_argument(
        '--local-dir',
        action='append',
        default=[],
        help='Local original image root (repeatable). Used to fill width/height/takenAt.',
    )
    parser.add_argument(
        '--prefer-local-mtime',
        action='store_true',
        help='Use local file mtime for sortTime instead of R2 LastModified / EXIF.',
    )
    parser.add_argument('--bucket', default=None)
    parser.add_argument('--prefix', default=None, help='R2 key prefix, default gallery')
    parser.add_argument('--endpoint', default=None)
    parser.add_argument('--region', default=None)
    parser.add_argument('--r2-proxy', default=None)
    parser.add_argument('--replace', action='store_true', help='Replace catalog items instead of merging')
    parser.add_argument('--dry-run', action='store_true', help='Print summary only, do not write catalog')
    parser.add_argument('--limit', type=int, default=0, help='Import at most N images (0 = all)')
    parser.add_argument(
        '--report-unmatched',
        type=int,
        default=20,
        help='Print up to N remote paths with no local match (default 20, 0 = none)',
    )
    return parser.parse_args()


def default_catalog_path() -> Path:
    env_path = os.getenv('PHOTO_CATALOG_PATH')
    if env_path:
        return Path(env_path).expanduser().resolve()
    return (SCRIPT_DIR.parent / 'backend' / 'var' / 'photos-index.json').resolve()


def main() -> int:
    args = parse_args()
    load_env_files(args.env_file)
    config = resolve_r2_config(args)
    catalog_path = Path(args.catalog).expanduser().resolve() if args.catalog else default_catalog_path()
    local_dirs = [Path(p).expanduser().resolve() for p in (args.local_dir or [])]

    print(f'R2 endpoint : {config["endpoint"]}')
    print(f'R2 bucket   : {config["bucket"]}')
    print(f'R2 prefix   : {config["prefix"] or "(none)"}')
    print(f'Catalog     : {catalog_path}')
    print(f'Mode        : {"dry-run" if args.dry_run else ("replace" if args.replace else "merge")}')
    if local_dirs:
        print('Local dirs  :')
        for path in local_dirs:
            print(f'  - {path}')
    else:
        print('Local dirs  : (none — width/height will be null)')

    local_index = build_local_index(local_dirs) if local_dirs else None
    if local_index is not None:
        print(f'Local images indexed: {len(local_index["files"])}')

    objects = list_r2_objects(config)
    imported: list[dict[str, Any]] = []
    skipped = 0
    match_counts = {
        'exact': 0,
        'path-stem': 0,
        'filename': 0,
        'filename-stem': 0,
        'none': 0,
    }
    dim_ok = 0
    dim_missing = 0
    unmatched_paths: list[str] = []

    for item in objects:
        key = item.get('Key')
        if not isinstance(key, str):
            skipped += 1
            continue
        relative_path = object_key_to_catalog_path(key, config['prefix'])
        if relative_path is None:
            skipped += 1
            continue

        local_meta = None
        if local_index is not None:
            local_path, match_kind = find_local_source(relative_path, local_index)
            match_counts[match_kind] = match_counts.get(match_kind, 0) + 1
            if local_path is not None:
                local_meta = read_local_metadata(local_path)
                if local_meta.get('width') and local_meta.get('height'):
                    dim_ok += 1
                else:
                    dim_missing += 1
            else:
                unmatched_paths.append(relative_path)
                dim_missing += 1
        else:
            dim_missing += 1

        imported.append(
            build_catalog_item_from_object(
                item,
                relative_path=relative_path,
                local_meta=local_meta,
                prefer_local_mtime=args.prefer_local_mtime,
            )
        )
        if args.limit > 0 and len(imported) >= args.limit:
            break

    print(f'R2 objects listed : {len(objects)}')
    print(f'Image candidates  : {len(imported)}')
    print(f'Skipped non-image : {skipped}')
    if local_index is not None:
        print('Local match stats:')
        print(f'  exact          : {match_counts["exact"]}')
        print(f'  path-stem      : {match_counts["path-stem"]}  (e.g. photo.png -> photo.avif)')
        print(f'  filename       : {match_counts["filename"]}')
        print(f'  filename-stem  : {match_counts["filename-stem"]}')
        print(f'  unmatched      : {match_counts["none"]}')
        print(f'Dimensions filled: {dim_ok}')
        print(f'Dimensions missing: {dim_missing}')
        if unmatched_paths and args.report_unmatched > 0:
            print(f'Unmatched remote samples (up to {args.report_unmatched}):')
            for path in unmatched_paths[: args.report_unmatched]:
                print(f'  - {path}')

    if imported:
        sample = imported[:5]
        print('Sample catalog entries:')
        for entry in sample:
            dims = (
                f'{entry["width"]}x{entry["height"]}'
                if entry.get('width') and entry.get('height')
                else 'no-dims'
            )
            print(f'  - {entry["path"]} ({entry["size"]} bytes, {dims})')
        if len(imported) > 5:
            print(f'  ... and {len(imported) - 5} more')

    existing = ur.load_photo_catalog(catalog_path)
    merged_items = merge_catalog(existing.get('items', []), imported, replace=args.replace)
    catalog = {
        'version': ur.PHOTO_CATALOG_SCHEMA_VERSION,
        'updatedAt': utc_now_iso(),
        'items': merged_items,
    }

    print(f'Catalog items after import: {len(merged_items)}')

    if args.dry_run:
        print('Dry run complete — catalog not written.')
        return 0

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = catalog_path.with_suffix(catalog_path.suffix + '.tmp')
    temp_path.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2, sort_keys=False) + '\n',
        encoding='utf-8',
    )
    os.replace(temp_path, catalog_path)
    print(f'Wrote catalog: {catalog_path}')
    print('Next: restart/reload API if needed, then open /api/photos?mediaSource=r2')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
