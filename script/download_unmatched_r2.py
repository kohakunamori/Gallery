#!/usr/bin/env python3
"""Download R2 gallery objects that have no matching local original.

Typical use when R2 has 2083 images but local only has 2065 originals:
  1) download the unmatched remote objects
  2) re-run import_r2_catalog.py with both local roots so width/height are filled

Examples:
  python script/download_unmatched_r2.py \\
    --local-dir "D:/photos" \\
    --out-dir "D:/photos/_from_r2_unmatched"

  # dry-run list only
  python script/download_unmatched_r2.py --local-dir "D:/photos" --dry-run
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path, PurePosixPath
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import import_r2_catalog as importer  # noqa: E402
import upload_r2 as ur  # noqa: E402


DEFAULT_ENV_FILE = SCRIPT_DIR / 'upload_r2.env'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Download R2 objects that do not match any local original image',
    )
    parser.add_argument(
        '--env-file',
        default=str(DEFAULT_ENV_FILE) if DEFAULT_ENV_FILE.is_file() else None,
        help=f'Env file (default: {DEFAULT_ENV_FILE} if present)',
    )
    parser.add_argument(
        '--local-dir',
        action='append',
        required=True,
        help='Local original root used for matching (repeatable)',
    )
    parser.add_argument(
        '--out-dir',
        default=str(SCRIPT_DIR / '_r2_unmatched'),
        help='Where to download unmatched objects (default: script/_r2_unmatched)',
    )
    parser.add_argument('--bucket', default=None)
    parser.add_argument('--prefix', default=None)
    parser.add_argument('--endpoint', default=None)
    parser.add_argument('--region', default=None)
    parser.add_argument('--r2-proxy', default=None)
    parser.add_argument('--dry-run', action='store_true', help='List only, do not download')
    parser.add_argument('--limit', type=int, default=0, help='Download at most N files (0 = all unmatched)')
    parser.add_argument(
        '--workers',
        type=int,
        default=8,
        help='Parallel download workers (default 8)',
    )
    return parser.parse_args()


def build_object_key(relative_path: str, prefix: str) -> str:
    rel = relative_path.lstrip('/')
    if not prefix:
        return rel
    return f'{prefix.strip("/")}/{rel}'


def download_one(
    client: Any,
    *,
    bucket: str,
    object_key: str,
    dest: Path,
) -> tuple[str, bool, str | None]:
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        # Avoid clobbering if already downloaded.
        if dest.is_file() and dest.stat().st_size > 0:
            return object_key, True, 'exists'
        client.download_file(bucket, object_key, str(dest))
        return object_key, True, None
    except Exception as exc:  # noqa: BLE001 - report per-file errors
        return object_key, False, str(exc)


def main() -> int:
    args = parse_args()
    if args.env_file:
        importer.load_env_files(args.env_file)
    else:
        importer.load_env_files(None)

    config = importer.resolve_r2_config(args)
    local_dirs = [Path(p).expanduser().resolve() for p in args.local_dir]
    out_dir = Path(args.out_dir).expanduser().resolve()

    print(f'R2 endpoint : {config["endpoint"]}')
    print(f'R2 bucket   : {config["bucket"]}')
    print(f'R2 prefix   : {config["prefix"] or "(none)"}')
    print(f'Env file    : {args.env_file or "(auto-discovered)"}')
    print('Local dirs  :')
    for path in local_dirs:
        print(f'  - {path}')
    print(f'Out dir     : {out_dir}')
    print(f'Mode        : {"dry-run" if args.dry_run else "download"}')

    local_index = importer.build_local_index(local_dirs)
    print(f'Local images indexed: {len(local_index["files"])}')

    objects = importer.list_r2_objects(config)
    unmatched: list[tuple[str, str]] = []  # (relative_path, object_key)
    matched = 0
    skipped = 0

    for item in objects:
        key = item.get('Key')
        if not isinstance(key, str):
            skipped += 1
            continue
        relative_path = importer.object_key_to_catalog_path(key, config['prefix'])
        if relative_path is None:
            skipped += 1
            continue
        local_path, match_kind = importer.find_local_source(relative_path, local_index)
        if local_path is None:
            unmatched.append((relative_path, key))
        else:
            matched += 1

    if args.limit > 0:
        to_fetch = unmatched[: args.limit]
    else:
        to_fetch = unmatched

    print(f'R2 image objects : {matched + len(unmatched)}')
    print(f'Matched local    : {matched}')
    print(f'Unmatched remote : {len(unmatched)}')
    print(f'Will process     : {len(to_fetch)}')
    print(f'Skipped non-image: {skipped}')

    if not to_fetch:
        print('Nothing to download.')
        return 0

    print('Unmatched samples:')
    for relative_path, object_key in to_fetch[:20]:
        print(f'  - {relative_path}  <=  s3://{config["bucket"]}/{object_key}')
    if len(to_fetch) > 20:
        print(f'  ... and {len(to_fetch) - 20} more')

    if args.dry_run:
        print('Dry run complete — no files downloaded.')
        print('Next:')
        print(
            f'  python script/download_unmatched_r2.py '
            f'--local-dir "{local_dirs[0]}" --out-dir "{out_dir}"'
        )
        return 0

    client = ur.make_r2_client(
        endpoint=config['endpoint'],
        access_key=config['access_key'],
        secret_key=config['secret_key'],
        region=config['region'],
        proxy_url=config['proxy_url'] or None,
    )

    ok = 0
    failed = 0
    existed = 0

    # Bounded parallel downloads.
    from concurrent.futures import ThreadPoolExecutor, as_completed

    workers = max(1, min(args.workers, len(to_fetch)))
    futures = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for relative_path, object_key in to_fetch:
            dest = out_dir / PurePosixPath(relative_path)
            futures.append(
                pool.submit(
                    download_one,
                    client,
                    bucket=config['bucket'],
                    object_key=object_key,
                    dest=dest,
                )
            )
        for future in as_completed(futures):
            object_key, success, detail = future.result()
            if success and detail == 'exists':
                existed += 1
                ok += 1
                print(f'[skip-exists] {object_key}')
            elif success:
                ok += 1
                print(f'[ok] {object_key}')
            else:
                failed += 1
                print(f'[fail] {object_key}: {detail}', file=sys.stderr)

    print('----------')
    print(f'Downloaded/kept : {ok}')
    print(f'Already existed : {existed}')
    print(f'Failed          : {failed}')
    print(f'Files dir       : {out_dir}')
    print()
    print('Rebuild catalog with dimensions:')
    local_args = ' '.join(f'--local-dir "{p}"' for p in local_dirs)
    print(
        '  python script/import_r2_catalog.py '
        f'--env-file "{args.env_file or DEFAULT_ENV_FILE}" '
        f'{local_args} --local-dir "{out_dir}" '
        '--catalog backend/var/photos-index.json'
    )
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
