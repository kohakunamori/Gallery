import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import upload_r2
from upload_r2 import DEFAULT_BUCKET, DEFAULT_ENDPOINT, DEFAULT_PREFIX, resolve_runtime_config


class OfflinePendingCatalogMixin:
    """Route durable pending-catalog writes into a temp path so suite stays offline/local."""

    def setUp(self):
        super().setUp()
        self._offline_pending_tmpdir = TemporaryDirectory()
        pending_path = Path(self._offline_pending_tmpdir.name) / '.upload_pending_catalog.json'
        pending_patch = patch.object(upload_r2, 'get_pending_catalog_file_path', return_value=pending_path)
        pending_patch.start()
        self.addCleanup(pending_patch.stop)
        self.addCleanup(self._offline_pending_tmpdir.cleanup)


class OfflineRemoteVerifyMixin(OfflinePendingCatalogMixin):
    """Also stub gallery existing-photos API used by Linux verify_remote precheck."""

    def setUp(self):
        super().setUp()
        # list_existing_linux_filenames removed with R2-only image upload trim


class CacheSectionHelperTests(unittest.TestCase):
    def test_get_legacy_target_sections_returns_normalized_three_section_mapping(self):
        legacy_targets = {
            'r2': {'bucket-name|gallery/image.png': {'cached': True}},
            'qiniu': {'qiniu-bucket|gallery/image.png': {'cached': True}},
        }

        sections = upload_r2.get_legacy_target_sections({'_legacy_targets': legacy_targets})

        self.assertEqual(
            {
                'r2': legacy_targets['r2'],
                'linux': {},
                'qiniu': legacy_targets['qiniu'],
            },
            sections,
        )

    def test_get_legacy_target_sections_ignores_top_level_target_sections(self):
        sections = upload_r2.get_legacy_target_sections({
            'r2': {'bucket-name|gallery/image.png': {'cached': True}},
            'linux': {'linux-host|/srv/gallery/image.png': {'cached': True}},
            'qiniu': {'qiniu-bucket|gallery/image.png': {'cached': True}},
        })

        self.assertEqual({'r2': {}, 'linux': {}, 'qiniu': {}}, sections)

    def test_get_cached_existing_targets_returns_matching_remote_ids(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            cache_key = upload_r2.build_r2_cache_key('bucket-name', 'gallery/image.png')
            cache_entries = {
                cache_key: upload_r2.build_upload_cache_fingerprint(
                    path,
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                )
            }

            cached_targets = upload_r2.get_cached_existing_targets(
                [path],
                cache_entries=cache_entries,
                remote_id_builder=lambda current_path: upload_r2.build_object_key(
                    current_path,
                    base_dir=base_dir,
                    prefix='gallery',
                ),
                cache_key_builder=lambda remote_id: upload_r2.build_r2_cache_key('bucket-name', remote_id),
                semantics_builder=upload_r2.get_expected_upload_cache_semantics,
            )

        self.assertEqual({'gallery/image.png'}, cached_targets)

    def test_store_cached_upload_target_updates_section_entry(self):
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_entries = {}

            changed = upload_r2.store_cached_upload_target(
                cache_entries,
                'bucket-name|gallery/image.png',
                path,
                compressed=False,
                compression_strategy=None,
            )

        self.assertTrue(changed)
        self.assertIn('bucket-name|gallery/image.png', cache_entries)
        self.assertFalse(cache_entries['bucket-name|gallery/image.png']['compressed'])

    def test_get_cached_existing_r2_keys_reads_matching_entries_from_v4_files_index(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            cache_data = {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'files': {
                    'nested/image.png': {
                        'source': upload_r2.build_source_cache_fingerprint(path),
                        'targets': {
                            'r2': {
                                'id': 'bucket-name|gallery/nested/image.png',
                                'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                                    path,
                                    compressed=compressed,
                                    compression_strategy=compression_strategy,
                                ),
                            }
                        },
                    }
                },
                'r2': {'bucket-name|gallery/nested/image.png': {'cached': False}},
            }

            cached_targets = upload_r2.get_cached_existing_r2_keys(
                [path],
                base_dir=base_dir,
                bucket='bucket-name',
                prefix='gallery',
                cache_data=cache_data,
            )

        self.assertEqual({'gallery/nested/image.png'}, cached_targets)

    def test_update_r2_cache_entry_writes_v4_files_target_record(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed = upload_r2.update_r2_cache_entry(
                cache_data,
                base_dir=base_dir,
                bucket='bucket-name',
                object_key='gallery/image.png',
                path=path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            expected = {
                'source': upload_r2.build_source_cache_fingerprint(path),
                'targets': {
                    'r2': {
                        'id': 'bucket-name|gallery/image.png',
                        'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                            path,
                            compressed=True,
                            compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                        ),
                    }
                },
            }

        self.assertTrue(changed)
        self.assertNotIn('r2', cache_data)
        self.assertEqual(expected, cache_data['files']['image.png'])

    def test_store_cached_upload_target_returns_false_without_mutating_when_fingerprint_unchanged(self):
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_key = 'bucket-name|gallery/image.png'
            original_entry = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            cache_entries = {cache_key: original_entry}

            changed = upload_r2.store_cached_upload_target(
                cache_entries,
                cache_key,
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            self.assertFalse(changed)
            self.assertIs(original_entry, cache_entries[cache_key])
            self.assertEqual(
                upload_r2.build_upload_cache_fingerprint(
                    path,
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                cache_entries[cache_key],
            )

    def test_store_cached_upload_target_returns_true_when_fingerprint_changes(self):
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_key = 'bucket-name|gallery/image.png'
            cache_entries = {
                cache_key: upload_r2.build_upload_cache_fingerprint(
                    path,
                    compressed=False,
                    compression_strategy=None,
                )
            }

            changed = upload_r2.store_cached_upload_target(
                cache_entries,
                cache_key,
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            self.assertTrue(changed)
            self.assertEqual(
                upload_r2.build_upload_cache_fingerprint(
                    path,
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                cache_entries[cache_key],
            )

    def test_get_cached_existing_r2_keys_treats_non_dict_section_as_empty(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')

            cached_targets = upload_r2.get_cached_existing_r2_keys(
                [path],
                base_dir=base_dir,
                bucket='bucket-name',
                prefix='gallery',
                cache_data={'r2': 'invalid-section'},
            )

        self.assertEqual(set(), cached_targets)

    def test_update_r2_cache_entry_reinitializes_non_dict_files_index(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = {'version': upload_r2.CACHE_SCHEMA_VERSION, 'files': 'invalid-files'}

            changed = upload_r2.update_r2_cache_entry(
                cache_data,
                base_dir=base_dir,
                bucket='bucket-name',
                object_key='gallery/image.png',
                path=path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            self.assertTrue(changed)
            self.assertIsInstance(cache_data['files'], dict)
            self.assertEqual(
                {
                    'source': upload_r2.build_source_cache_fingerprint(path),
                    'targets': {
                        'r2': {
                            'id': 'bucket-name|gallery/image.png',
                            'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                                path,
                                compressed=True,
                                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                            ),
                        }
                    },
                },
                cache_data['files']['image.png'],
            )


class CachePathOverrideTests(unittest.TestCase):
    def test_cache_paths_can_be_overridden_by_environment(self):
        with TemporaryDirectory() as temp_dir, patch.dict(os.environ, {
            'UPLOAD_TARGET_CACHE_FILE': str(Path(temp_dir) / 'target-cache.json'),
            'UPLOAD_PREPARED_CACHE_DIR': str(Path(temp_dir) / 'prepared-cache'),
        }, clear=False):
            self.assertEqual(Path(temp_dir) / 'target-cache.json', upload_r2.get_cache_file_path())
            self.assertEqual(Path(temp_dir) / 'prepared-cache', upload_r2.get_prepared_cache_dir())

    def test_pending_catalog_path_prefers_env_then_cache_dir_sibling(self):
        with TemporaryDirectory() as temp_dir:
            explicit = Path(temp_dir) / 'pending.json'
            cache_file = Path(temp_dir) / 'nested' / 'target-cache.json'
            with patch.dict(os.environ, {
                'UPLOAD_PENDING_CATALOG_FILE': str(explicit),
            }, clear=False):
                self.assertEqual(explicit.resolve(), upload_r2.get_pending_catalog_file_path())

            env = {
                'UPLOAD_TARGET_CACHE_FILE': str(cache_file),
            }
            # Ensure explicit pending env does not leak from other tests.
            with patch.dict(os.environ, env, clear=False):
                os.environ.pop('UPLOAD_PENDING_CATALOG_FILE', None)
                self.assertEqual(
                    cache_file.resolve().with_name(upload_r2.PENDING_CATALOG_FILE_NAME),
                    upload_r2.get_pending_catalog_file_path(),
                )


class EnvFileLoadingTests(unittest.TestCase):
    def test_default_candidates_prefer_script_directory_upload_r2_env(self):
        candidates = upload_r2.iter_default_env_file_candidates()
        self.assertTrue(candidates)
        self.assertEqual(
            (upload_r2.SCRIPT_DIR / 'upload_r2.env').resolve(),
            candidates[0].resolve(),
        )
        self.assertIn(upload_r2.SCRIPT_DIR / '.env', candidates)

    def test_load_env_files_reads_script_dir_upload_r2_env_without_flag(self):
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / 'upload_r2.env'
            env_path.write_text('UPLOAD_R2_ENV_LOAD_TEST=from-script-dir\n', encoding='utf-8')
            args = SimpleNamespace(env_file=None)

            with patch.object(upload_r2, 'SCRIPT_DIR', Path(temp_dir)):
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop('UPLOAD_R2_ENV_LOAD_TEST', None)
                    upload_r2._load_env_files(args)
                    self.assertEqual('from-script-dir', os.environ.get('UPLOAD_R2_ENV_LOAD_TEST'))
                    self.assertTrue(any(Path(p).name == 'upload_r2.env' for p in args._loaded_env_files))

    def test_explicit_env_file_is_used_instead_of_defaults(self):
        with TemporaryDirectory() as temp_dir:
            explicit = Path(temp_dir) / 'custom.env'
            explicit.write_text('UPLOAD_R2_ENV_LOAD_TEST=from-explicit\n', encoding='utf-8')
            ignored = Path(temp_dir) / 'upload_r2.env'
            ignored.write_text('UPLOAD_R2_ENV_LOAD_TEST=from-default\n', encoding='utf-8')
            args = SimpleNamespace(env_file=str(explicit))

            with patch.object(upload_r2, 'SCRIPT_DIR', Path(temp_dir)):
                with patch.dict(os.environ, {}, clear=False):
                    os.environ.pop('UPLOAD_R2_ENV_LOAD_TEST', None)
                    upload_r2._load_env_files(args)
                    self.assertEqual('from-explicit', os.environ.get('UPLOAD_R2_ENV_LOAD_TEST'))


class PendingCatalogQueueTests(unittest.TestCase):
    def test_queue_pending_catalog_items_persists_and_merges(self):
        with TemporaryDirectory() as temp_dir:
            pending_path = Path(temp_dir) / '.upload_pending_catalog.json'
            first = {
                'path': 'a.avif',
                'filename': 'a.avif',
                'takenAt': None,
                'sortTime': '2026-01-01T00:00:00Z',
                'width': 1,
                'height': 1,
                'size': 1,
                'version': 'a',
            }
            second = {
                'path': 'b.avif',
                'filename': 'b.avif',
                'takenAt': None,
                'sortTime': '2026-02-01T00:00:00Z',
                'width': 2,
                'height': 2,
                'size': 2,
                'version': 'b',
            }
            upload_r2.queue_pending_catalog_items([first], pending_path)
            merged = upload_r2.queue_pending_catalog_items([second], pending_path)
            self.assertEqual({'a.avif', 'b.avif'}, set(merged))
            reloaded = upload_r2.load_pending_catalog_items(pending_path)
            self.assertEqual({'a.avif', 'b.avif'}, set(reloaded))
            upload_r2.clear_pending_catalog_items(pending_path)
            self.assertFalse(pending_path.exists())
            self.assertEqual({}, upload_r2.load_pending_catalog_items(pending_path))

    def test_pending_catalog_is_retried_when_current_batch_has_no_new_uploads(self):
        """Regression: second run after R2 success + remote catalog failure must still sync."""
        with TemporaryDirectory() as temp_dir:
            pending_path = Path(temp_dir) / '.upload_pending_catalog.json'
            item = {
                'path': 'missed.avif',
                'filename': 'missed.avif',
                'takenAt': None,
                'sortTime': '2026-04-01T00:00:00Z',
                'width': 3,
                'height': 3,
                'size': 3,
                'version': 'missed',
            }
            upload_r2.queue_pending_catalog_items([item], pending_path)

            written = {}

            class FakeHandle:
                def __init__(self, payload: bytes):
                    self._payload = payload

                def read(self):
                    return self._payload

                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, tb):
                    return False

            class FakeSftp:
                def open(self, path, mode):
                    return FakeHandle(json.dumps({
                        'version': 1,
                        'updatedAt': '2026-01-01T00:00:00Z',
                        'items': [],
                    }).encode('utf-8'))

                def put(self, local_path, remote_path):
                    written['payload'] = Path(local_path).read_text(encoding='utf-8')
                    written['remote_path'] = remote_path

                def mkdir(self, path):
                    return None

                def stat(self, path):
                    raise FileNotFoundError(path)

                def close(self):
                    return None

            fake_sftp = FakeSftp()
            fake_client = MagicMock()
            with patch.object(upload_r2, 'open_linux_sftp_client', return_value=(fake_client, fake_sftp)):
                with patch.object(upload_r2, 'close_linux_sftp_session'):
                    pending = upload_r2.load_pending_catalog_items(pending_path)
                    total = upload_r2.upsert_remote_photo_catalog_items(
                        '/data/gallery/photos-index.json',
                        list(pending.values()),
                        host='example.com',
                        user='gallery',
                        ssh_key=None,
                        password='secret',
                        port=22,
                        proxy_url=None,
                    )
            self.assertEqual(1, total)
            payload = json.loads(written['payload'])
            self.assertEqual(['missed.avif'], [entry['path'] for entry in payload['items']])


class PhotoCatalogAndExistingApiTests(OfflinePendingCatalogMixin, unittest.TestCase):
    def test_get_photo_catalog_path_prefers_cli_then_env(self):
        with TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / 'from-env.json'
            cli_path = Path(temp_dir) / 'from-cli.json'
            env_path.write_text('{}', encoding='utf-8')
            cli_path.write_text('{}', encoding='utf-8')

            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop('PHOTO_CATALOG_PATH', None)
                os.environ.pop('PHOTO_CATALOG_REMOTE_PATH', None)
                self.assertIsNone(upload_r2.get_photo_catalog_path())
                self.assertIsNone(upload_r2.get_photo_catalog_path(None))
                self.assertIsNone(upload_r2.get_photo_catalog_path(''))

                os.environ['PHOTO_CATALOG_PATH'] = str(env_path)
                self.assertEqual(env_path.resolve(), upload_r2.get_photo_catalog_path())
                self.assertEqual(cli_path.resolve(), upload_r2.get_photo_catalog_path(str(cli_path)))

    def test_get_photo_catalog_remote_path_prefers_cli_then_env(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('PHOTO_CATALOG_REMOTE_PATH', None)
            self.assertIsNone(upload_r2.get_photo_catalog_remote_path())
            self.assertIsNone(upload_r2.get_photo_catalog_remote_path(''))
            os.environ['PHOTO_CATALOG_REMOTE_PATH'] = r'C:\data\photos-index.json'
            self.assertEqual(
                'C:/data/photos-index.json',
                upload_r2.get_photo_catalog_remote_path(),
            )
            self.assertEqual(
                '/var/www/gallery/data/gallery/photos-index.json',
                upload_r2.get_photo_catalog_remote_path('/var/www/gallery/data/gallery/photos-index.json'),
            )

    def test_build_photo_catalog_item_default_sort_time_is_upload_time(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'old-shot.png'
            source.write_bytes(
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
                b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00'
                b'\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            old_mtime = 1_430_000_000.0  # ~2015
            os.utime(source, (old_mtime, old_mtime))
            mtime_sort = upload_r2._mtime_to_sort_time(old_mtime)

            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop(upload_r2.SORT_TIME_MODE_ENV, None)
                before = upload_r2._utc_now_iso()
                item = upload_r2.build_photo_catalog_item(
                    source,
                    relative_path='uploads/old-shot.png',
                )
                after = upload_r2._utc_now_iso()

            self.assertNotEqual(mtime_sort, item['sortTime'])
            self.assertGreaterEqual(item['sortTime'], before)
            self.assertLessEqual(item['sortTime'], after)
            self.assertIsNone(item['takenAt'])
            self.assertEqual('uploads/old-shot.png', item['path'])

    def test_build_photo_catalog_item_source_mtime_mode_uses_file_mtime(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'archive.png'
            source.write_bytes(
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
                b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00'
                b'\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            old_mtime = 1_430_000_000.0
            os.utime(source, (old_mtime, old_mtime))
            expected = upload_r2._mtime_to_sort_time(old_mtime)

            item = upload_r2.build_photo_catalog_item(
                source,
                relative_path='uploads/archive.png',
                sort_time_mode='source-mtime',
            )

            self.assertEqual(expected, item['sortTime'])

    def test_resolve_sort_time_mode_cli_wins_over_env(self):
        with patch.dict(os.environ, {upload_r2.SORT_TIME_MODE_ENV: 'source-mtime'}, clear=False):
            self.assertEqual('upload', upload_r2.resolve_sort_time_mode('upload'))
            self.assertEqual('source-mtime', upload_r2.resolve_sort_time_mode(None))
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(upload_r2.SORT_TIME_MODE_ENV, None)
            self.assertEqual('upload', upload_r2.resolve_sort_time_mode(None))
            self.assertEqual('upload', upload_r2.resolve_sort_time_mode('invalid'))

    def test_build_photo_catalog_item_respects_env_when_mode_omitted(self):
        with TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / 'env-mode.png'
            source.write_bytes(
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
                b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00'
                b'\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            old_mtime = 1_430_000_000.0
            os.utime(source, (old_mtime, old_mtime))
            expected = upload_r2._mtime_to_sort_time(old_mtime)

            with patch.dict(os.environ, {upload_r2.SORT_TIME_MODE_ENV: 'source-mtime'}, clear=False):
                item = upload_r2.build_photo_catalog_item(
                    source,
                    relative_path='uploads/env-mode.png',
                )

            self.assertEqual(expected, item['sortTime'])

    def test_build_parser_exposes_sort_time_flag(self):
        parser = upload_r2.build_parser()
        help_text = parser.format_help()
        self.assertIn('--sort-time', help_text)
        self.assertIn('UPLOAD_SORT_TIME_MODE', help_text)
        args = parser.parse_args(['--sort-time', 'source-mtime'])
        self.assertEqual('source-mtime', args.sort_time)

    def test_merge_photo_catalog_items_keeps_existing_and_adds_new(self):
        base = {
            'version': 1,
            'updatedAt': '2026-01-01T00:00:00Z',
            'items': [
                {
                    'path': 'old.avif',
                    'filename': 'old.avif',
                    'takenAt': None,
                    'sortTime': '2026-01-01T00:00:00Z',
                    'width': 1,
                    'height': 1,
                    'size': 1,
                    'version': 'a',
                },
            ],
        }
        merged = upload_r2.merge_photo_catalog_items(base, [{
            'path': 'new.avif',
            'filename': 'new.avif',
            'takenAt': None,
            'sortTime': '2026-03-01T00:00:00Z',
            'width': 2,
            'height': 2,
            'size': 2,
            'version': 'b',
        }])
        self.assertEqual(['new.avif', 'old.avif'], [item['path'] for item in merged['items']])

    def test_upsert_remote_photo_catalog_items_merges_via_sftp(self):
        remote_existing = {
            'version': 1,
            'updatedAt': '2026-01-01T00:00:00Z',
            'items': [
                {
                    'path': 'keep.avif',
                    'filename': 'keep.avif',
                    'takenAt': None,
                    'sortTime': '2026-01-01T00:00:00Z',
                    'width': 1,
                    'height': 1,
                    'size': 1,
                    'version': 'keep',
                },
            ],
        }
        written = {}

        class FakeHandle:
            def __init__(self, payload: bytes):
                self._payload = payload

            def read(self):
                return self._payload

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, tb):
                return False

        class FakeSftp:
            def open(self, path, mode):
                self.assert_path = path
                return FakeHandle(json.dumps(remote_existing).encode('utf-8'))

            def put(self, local_path, remote_path):
                written['remote_path'] = remote_path
                written['payload'] = Path(local_path).read_text(encoding='utf-8')

            def mkdir(self, path):
                return None

            def stat(self, path):
                raise FileNotFoundError(path)

            def close(self):
                return None

        fake_sftp = FakeSftp()
        fake_client = MagicMock()

        with patch.object(upload_r2, 'open_linux_sftp_client', return_value=(fake_client, fake_sftp)):
            with patch.object(upload_r2, 'close_linux_sftp_session') as close_mock:
                total = upload_r2.upsert_remote_photo_catalog_items(
                    '/data/gallery/photos-index.json',
                    [{
                        'path': 'added.avif',
                        'filename': 'added.avif',
                        'takenAt': None,
                        'sortTime': '2026-04-01T00:00:00Z',
                        'width': 3,
                        'height': 3,
                        'size': 3,
                        'version': 'added',
                    }],
                    host='example.com',
                    user='gallery',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    proxy_url=None,
                )

        self.assertEqual(2, total)
        payload = json.loads(written['payload'])
        self.assertEqual(['added.avif', 'keep.avif'], [item['path'] for item in payload['items']])
        self.assertEqual('/data/gallery/photos-index.json', written['remote_path'])
        close_mock.assert_called_once()

    def test_upsert_photo_catalog_items_writes_sorted_json_catalog(self):
        with TemporaryDirectory() as temp_dir:
            catalog_path = Path(temp_dir) / 'photos-index.json'
            older = {
                'path': 'older.avif',
                'filename': 'older.avif',
                'takenAt': None,
                'sortTime': '2026-01-01T00:00:00Z',
                'width': 1,
                'height': 1,
                'size': 10,
                'version': 'old',
            }
            newer = {
                'path': 'newer.avif',
                'filename': 'newer.avif',
                'takenAt': None,
                'sortTime': '2026-02-01T00:00:00Z',
                'width': 2,
                'height': 2,
                'size': 20,
                'version': 'new',
            }

            upload_r2.upsert_photo_catalog_items(catalog_path, [older, newer])
            payload = json.loads(catalog_path.read_text(encoding='utf-8'))

            self.assertEqual(1, payload['version'])
            self.assertEqual(['newer.avif', 'older.avif'], [item['path'] for item in payload['items']])

            upload_r2.upsert_photo_catalog_items(catalog_path, [{
                **older,
                'version': 'old-updated',
                'size': 11,
            }])
            payload = json.loads(catalog_path.read_text(encoding='utf-8'))
            self.assertEqual('old-updated', payload['items'][1]['version'])
            self.assertEqual(11, payload['items'][1]['size'])

    def test_discard_prepared_cache_dir_removes_ephemeral_cache(self):
        with TemporaryDirectory() as temp_dir:
            cache_dir = Path(temp_dir) / 'prepared'
            cache_dir.mkdir()
            (cache_dir / 'artifact.avif').write_bytes(b'x')

            with patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir):
                upload_r2.discard_prepared_cache_dir()

            self.assertFalse(cache_dir.exists())

    def test_run_upload_updates_catalog_and_discards_prepared_cache_for_r2_success(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir) / 'batch'
            folder.mkdir()
            source = folder / 'shot.png'
            source.write_bytes(
                b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR'
                b'\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde'
                b'\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x01\x01\x01\x00\x18\xdd\x8d\xb4'
                b'\x00\x00\x00\x00IEND\xaeB`\x82'
            )
            catalog_path = Path(temp_dir) / 'photos-index.json'
            prepared_cache = Path(temp_dir) / 'prepared-cache'
            pending_catalog = Path(temp_dir) / 'pending-catalog.json'
            prepared_cache.mkdir()
            (prepared_cache / 'cached.bin').write_bytes(b'cache')
            args = SimpleNamespace(
                dir=str(folder),
                recursive=False,
                dry_run=False,
                no_skip_existing=True,
                refresh_cache=False,
                verify_remote=False,
                sync_cache_only=False,
                target='r2',
                env_file=None,
                compression=upload_r2.COMPRESSION_MODE_NONE,
                replace_remote_png=False,
                replace_remote_avif=False,
                sort_time=None,
                bucket='bucket',
                prefix='gallery',
                endpoint='https://example.r2.cloudflarestorage.com',
                region='auto',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_key=None,
                linux_password=None,
                linux_port=None,
                linux_proxy=None,
            )
            config = upload_r2.UploadRuntimeConfig(
                target='r2',
                bucket='bucket',
                prefix='gallery',
                region='auto',
                endpoint='https://example.r2.cloudflarestorage.com',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                access_key='ak',
                secret_key='sk',
                compression=upload_r2.COMPRESSION_MODE_NONE,
            )

            with patch.dict(os.environ, {
                'PHOTO_CATALOG_PATH': str(catalog_path),
                'UPLOAD_DISCARD_PREPARED_CACHE': '1',
            }, clear=False), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=prepared_cache), \
                 patch.object(upload_r2, 'get_pending_catalog_file_path', return_value=pending_catalog), \
                 patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2._load_env_files'), \
                 patch('upload_r2._collect_image_files', return_value=(folder, [source])), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2._validate_target_config', return_value=None), \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(source, 'shot.png', False, None),
                             ('uploaded', '已上传 shot.png', False, None),
                         )
                     ],
                 ):
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            payload = json.loads(catalog_path.read_text(encoding='utf-8'))
            self.assertEqual(1, len(payload['items']))
            self.assertEqual('shot.png', payload['items'][0]['path'])
            self.assertFalse(prepared_cache.exists())


class PreparedPngCacheTests(unittest.TestCase):
    def test_prepare_upload_file_reuses_persistent_cached_png(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.png'
            source_path.write_bytes(b'png-source-bytes')
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_run(command, check, capture_output, **kwargs):
                run_calls.append(command)
                out_path = Path(command[command.index('--out') + 1])
                out_path.write_bytes(b'compressed-png-bytes')
                return SimpleNamespace(stdout='', stderr='')

            with patch('upload_r2.shutil.which', return_value='/usr/bin/oxipng'), \
                 patch('upload_r2.subprocess.run', side_effect=fake_run), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir, create=True):
                first = upload_r2.prepare_upload_file(source_path)
                second = upload_r2.prepare_upload_file(source_path)

            try:
                self.assertEqual(first.upload_path, second.upload_path)
                self.assertIsNone(first.temp_path)
                self.assertIsNone(second.temp_path)
                self.assertEqual(cache_dir, first.upload_path.parent)
                self.assertFalse(first.from_cache)
                self.assertTrue(second.from_cache)
                self.assertEqual(1, len(run_calls))
                self.assertTrue(first.upload_path.is_file())
                self.assertGreater(first.upload_path.stat().st_size, 0)
            finally:
                upload_r2.cleanup_prepared_upload(first)
                upload_r2.cleanup_prepared_upload(second)

    def test_prepare_upload_file_reused_cached_png_keeps_cached_artifact_mtime(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.png'
            source_path.write_bytes(b'png-source-bytes')
            initial_mtime = 1712345678
            updated_mtime = 1712349876
            os.utime(source_path, (initial_mtime, initial_mtime))
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_run(command, check, capture_output, **kwargs):
                run_calls.append(command)
                out_path = Path(command[command.index('--out') + 1])
                out_path.write_bytes(b'compressed-png-bytes')
                return SimpleNamespace(stdout='', stderr='')

            with patch('upload_r2.shutil.which', return_value='/usr/bin/oxipng'), \
                 patch('upload_r2.subprocess.run', side_effect=fake_run), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir, create=True):
                first = upload_r2.prepare_upload_file(source_path)
                prepared_mtime = first.upload_path.stat().st_mtime
                os.utime(source_path, (updated_mtime, updated_mtime))
                second = upload_r2.prepare_upload_file(source_path)

            try:
                self.assertEqual(first.upload_path, second.upload_path)
                self.assertEqual(cache_dir, second.upload_path.parent)
                self.assertEqual(1, len(run_calls))
                self.assertTrue(second.upload_path.is_file())
                self.assertGreater(second.upload_path.stat().st_size, 0)
                self.assertEqual(updated_mtime, source_path.stat().st_mtime)
                self.assertEqual(prepared_mtime, second.upload_path.stat().st_mtime)
            finally:
                upload_r2.cleanup_prepared_upload(first)
                upload_r2.cleanup_prepared_upload(second)

    def test_prepare_upload_file_shared_cached_png_reuse_does_not_mutate_artifact_mtime_between_sources(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            first_source_path = base_dir / 'first.png'
            second_source_path = base_dir / 'second.png'
            shared_bytes = b'png-source-bytes'
            first_source_path.write_bytes(shared_bytes)
            second_source_path.write_bytes(shared_bytes)
            first_mtime = 1712345678
            second_mtime = 1712349876
            os.utime(first_source_path, (first_mtime, first_mtime))
            os.utime(second_source_path, (second_mtime, second_mtime))
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_run(command, check, capture_output, **kwargs):
                run_calls.append(command)
                out_path = Path(command[command.index('--out') + 1])
                out_path.write_bytes(b'compressed-png-bytes')
                return SimpleNamespace(stdout='', stderr='')

            with patch('upload_r2.shutil.which', return_value='/usr/bin/oxipng'), \
                 patch('upload_r2.subprocess.run', side_effect=fake_run), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir, create=True):
                first = upload_r2.prepare_upload_file(first_source_path)
                prepared_mtime = first.upload_path.stat().st_mtime
                second = upload_r2.prepare_upload_file(second_source_path)

            try:
                self.assertEqual(first.upload_path, second.upload_path)
                self.assertEqual(first_mtime, prepared_mtime)
                self.assertEqual(1, len(run_calls))
                self.assertEqual(prepared_mtime, second.upload_path.stat().st_mtime)
            finally:
                upload_r2.cleanup_prepared_upload(first)
                upload_r2.cleanup_prepared_upload(second)

    def test_record_prepared_png_metadata_writes_sha_and_size(self):
        record_metadata = getattr(upload_r2, 'record_prepared_png_metadata', None)
        self.assertTrue(callable(record_metadata))

        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'nested' / 'image.png'
            prepared_path = base_dir / 'prepared.png'
            source_path.parent.mkdir(parents=True)
            source_path.write_bytes(b'png-source-bytes')
            prepared_path.write_bytes(b'prepared-png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            record_metadata(
                cache_data,
                source_path,
                base_dir=base_dir,
                sha256='sha256-value',
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                prepared_path=prepared_path,
            )

        self.assertEqual(
            {
                'sha256': 'sha256-value',
                'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                'prepared_size': len(b'prepared-png-bytes'),
            },
            cache_data['files']['nested/image.png']['prepared_png'],
        )

    def test_build_prepared_cache_key_changes_when_compression_strategy_changes(self):
        build_key = getattr(upload_r2, 'build_prepared_cache_key', None)
        self.assertTrue(callable(build_key))

        first_key = build_key('same-sha', compression_strategy='oxipng:o_max:z:strip_safe')
        second_key = build_key('same-sha', compression_strategy='oxipng:o2')

        self.assertNotEqual(first_key, second_key)
        self.assertTrue(first_key.startswith('same-sha--'))
        self.assertTrue(second_key.startswith('same-sha--'))


class SharedClientBatchUploadTests(unittest.TestCase):
    def _planned_batch(self):
        tmpdir = TemporaryDirectory()
        self.addCleanup(tmpdir.cleanup)
        base_dir = Path(tmpdir.name)
        path_a = base_dir / 'a.jpg'
        path_b = base_dir / 'b.jpg'
        path_a.write_bytes(b'a')
        path_b.write_bytes(b'b')
        planned = [
            upload_r2.PlannedUpload(path_a, 'a.jpg', False, None),
            upload_r2.PlannedUpload(path_b, 'b.jpg', False, None),
        ]
        return base_dir, planned

    def test_upload_pending_r2_files_reuses_single_client(self):
        base_dir, planned = self._planned_batch()
        fake_client = object()

        with patch.object(upload_r2, 'make_r2_client', return_value=fake_client) as client_mock, \
             patch.object(upload_r2, 'upload_to_r2', side_effect=[('uploaded', 'A'), ('uploaded', 'B')]) as upload_mock:
            results = upload_r2.upload_pending_r2_files(
                planned,
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
                proxy_url=None,
            )

        self.assertEqual([item.source_path.name for item, _ in results], ['a.jpg', 'b.jpg'])
        self.assertEqual(client_mock.call_count, 1)
        self.assertEqual(upload_mock.call_args_list[0].kwargs['client'], fake_client)
        self.assertEqual(upload_mock.call_args_list[1].kwargs['client'], fake_client)

    def test_upload_pending_r2_files_reports_png_compression_progress(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            png_path = base_dir / 'image.png'
            jpg_path = base_dir / 'image.jpg'
            prepared_png_path = base_dir / 'image.prepared.png'
            png_path.write_bytes(b'png-source')
            jpg_path.write_bytes(b'jpg-source')
            prepared_png_path.write_bytes(b'png-upload')
            planned = [
                upload_r2.PlannedUpload(png_path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                upload_r2.PlannedUpload(jpg_path, 'image.jpg', False, None),
            ]
            prepared_uploads = {
                png_path: upload_r2.PreparedUpload(png_path, prepared_png_path, None, True, upload_r2.PNG_COMPRESSION_STRATEGY),
                jpg_path: upload_r2.PreparedUpload(jpg_path, jpg_path, None, False, None),
            }
            logs = []

            with patch.object(upload_r2, 'make_r2_client', return_value=object()), \
                 patch.object(upload_r2, 'prepare_upload_file', side_effect=lambda path: prepared_uploads[path]), \
                 patch.object(upload_r2, 'upload_to_r2', side_effect=[('uploaded', '已上传 image.png'), ('uploaded', '已上传 image.jpg')]):
                upload_r2.upload_pending_r2_files(
                    planned,
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
                    proxy_url=None,
                    log_callback=logs.append,
                )

        self.assertEqual(['[R2] [1/1] 压缩完成 image.png'], logs)

    def test_upload_pending_r2_files_returns_failed_result_per_item_when_shared_client_creation_fails(self):
        base_dir, planned = self._planned_batch()

        with patch.object(upload_r2, 'make_r2_client', side_effect=RuntimeError('boom')) as client_mock, \
             patch.object(upload_r2, 'upload_to_r2') as upload_mock:
            results = upload_r2.upload_pending_r2_files(
                planned,
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
                proxy_url=None,
            )

        self.assertEqual(client_mock.call_count, 1)
        upload_mock.assert_not_called()
        self.assertEqual(
            results,
            [
                (planned[0], ('failed', '失败 a.jpg：boom', False, None)),
                (planned[1], ('failed', '失败 b.jpg：boom', False, None)),
            ],
        )


class LinuxTransferHelperTests(unittest.TestCase):
    def test_open_linux_sftp_client_returns_client_and_sftp(self):
        client = MagicMock()
        sftp = MagicMock()
        client.open_sftp.return_value = sftp

        with patch('upload_r2.connect_linux_ssh_client', return_value=client) as connect_mock:
            returned_client, returned_sftp = upload_r2.open_linux_sftp_client(
                host='linux-host',
                user='linux-user',
                ssh_key='/tmp/id_rsa',
                password='secret',
                port=2222,
                proxy_url='socks5://127.0.0.1:1080',
            )

        connect_mock.assert_called_once_with(
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password='secret',
            port=2222,
            proxy_url='socks5://127.0.0.1:1080',
        )
        self.assertIs(client, returned_client)
        self.assertIs(sftp, returned_sftp)

    def test_open_linux_sftp_client_closes_client_when_open_sftp_fails(self):
        client = MagicMock()
        client.open_sftp.side_effect = RuntimeError('boom')

        with patch('upload_r2.connect_linux_ssh_client', return_value=client) as connect_mock:
            with self.assertRaisesRegex(RuntimeError, 'boom'):
                upload_r2.open_linux_sftp_client(
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password='secret',
                    port=2222,
                    proxy_url='socks5://127.0.0.1:1080',
                )

        connect_mock.assert_called_once_with(
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password='secret',
            port=2222,
            proxy_url='socks5://127.0.0.1:1080',
        )
        client.open_sftp.assert_called_once_with()
        client.close.assert_called_once_with()

    def test_is_linux_sftp_connection_error_detects_wrapped_connection_reset(self):
        try:
            try:
                raise ConnectionResetError(10054, 'localized reset message')
            except ConnectionResetError as exc:
                raise RuntimeError('wrapper message without socket keywords') from exc
        except RuntimeError as exc:
            self.assertTrue(upload_r2.is_linux_sftp_connection_error(exc))

    def test_is_linux_sftp_connection_error_returns_false_for_non_connection_errors(self):
        exc = RuntimeError('permission denied')

        self.assertFalse(upload_r2.is_linux_sftp_connection_error(exc))

    def test_close_linux_sftp_session_ignores_close_errors(self):
        client = MagicMock()
        sftp = MagicMock()
        client.close.side_effect = RuntimeError('client close boom')
        sftp.close.side_effect = RuntimeError('sftp close boom')

        upload_r2.close_linux_sftp_session(client, sftp)

        sftp.close.assert_called_once_with()
        client.close.assert_called_once_with()

    def test_linux_sftp_path_exists_returns_false_for_missing_path(self):
        sftp = MagicMock()
        sftp.stat.side_effect = FileNotFoundError()

        exists = upload_r2.linux_sftp_path_exists(sftp, '/srv/gallery/image.png')

        self.assertFalse(exists)
        sftp.stat.assert_called_once_with('/srv/gallery/image.png')


class PendingUploadPlanningTests(OfflineRemoteVerifyMixin, unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'dir': None,
            'env_file': None,
            'recursive': False,
            'refresh_cache': False,
            'dry_run': False,
            'no_skip_existing': False,
            'workers': 1,
            'target': 'r2',
            'bucket': None,
            'prefix': None,
            'endpoint': None,
            'region': None,
            'r2_proxy': None,
            'linux_host': None,
            'linux_user': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'verify_remote': False,
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
            'linux_key': '/tmp/id_rsa',
            'linux_password': None,
            'linux_port': 22,
            'linux_proxy': None,
            'access_key': 'r2-access',
            'secret_key': 'r2-secret',
        }
        values.update(overrides)
        return upload_r2.UploadRuntimeConfig(**values)

    def test_main_accepts_verify_remote_flag(self):
        with patch('upload_r2.run_upload', return_value=0) as run_upload_mock:
            exit_code = upload_r2.main(['--verify-remote'])

        self.assertEqual(0, exit_code)
        self.assertTrue(run_upload_mock.call_args.args[0].verify_remote)

    def test_main_accepts_sync_cache_only_flag(self):
        with patch('upload_r2.run_upload', return_value=0) as run_upload_mock:
            exit_code = upload_r2.main(['--sync-cache-only'])

        self.assertEqual(0, exit_code)
        self.assertTrue(run_upload_mock.call_args.args[0].sync_cache_only)

    def test_main_rejects_sync_cache_only_with_dry_run(self):
        with self.assertRaises(SystemExit) as cm:
            upload_r2.main(['--sync-cache-only', '--dry-run'])

        self.assertEqual(2, cm.exception.code)

    def test_main_rejects_sync_cache_only_with_verify_remote(self):
        with self.assertRaises(SystemExit) as cm:
            upload_r2.main(['--sync-cache-only', '--verify-remote'])

        self.assertEqual(2, cm.exception.code)

    def test_main_builds_parser_and_uses_it_for_parse_args_and_error(self):
        parser = MagicMock()
        parser.parse_args.return_value = SimpleNamespace(
            sync_cache_only=True,
            dry_run=True,
            verify_remote=False,
            no_skip_existing=False,
        )
        parser.error.side_effect = SystemExit(2)

        with patch('upload_r2.build_parser', return_value=parser) as build_parser_mock, \
             patch('upload_r2.run_upload') as run_upload_mock:
            with self.assertRaises(SystemExit) as cm:
                upload_r2.main(['--sync-cache-only', '--dry-run'])

        self.assertEqual(2, cm.exception.code)
        build_parser_mock.assert_called_once_with()
        parser.parse_args.assert_called_once_with(['--sync-cache-only', '--dry-run'])
        parser.error.assert_called_once_with('--sync-cache-only 与 --dry-run 不能同时使用。')
        run_upload_mock.assert_not_called()

    def test_main_rejects_sync_cache_only_with_no_skip_existing(self):
        with self.assertRaises(SystemExit) as cm:
            upload_r2.main(['--sync-cache-only', '--no-skip-existing'])

        self.assertEqual(2, cm.exception.code)

    def test_build_parser_help_uses_grouped_chinese_sections(self):
        parser = upload_r2.build_parser()

        help_text = parser.format_help()

        self.assertIn('通用参数', help_text)
        self.assertIn('R2 参数', help_text)
        self.assertIn('目录远程 SSH 参数', help_text)
        self.assertNotIn('七牛参数', help_text)
        self.assertIn('--sync-cache-only', help_text)
        self.assertIn('仅同步本地缓存', help_text)

    def test_build_parser_help_localizes_default_help_section_and_text(self):
        parser = upload_r2.build_parser()

        help_text = parser.format_help()

        self.assertIn('选项:', help_text)
        self.assertIn('-h, --help', help_text)
        self.assertIn('显示此帮助信息并退出', help_text)
        self.assertNotIn('options:', help_text)
        self.assertNotIn('show this help message and exit', help_text)


class RunUploadCacheWriteRegressionTests(OfflinePendingCatalogMixin, unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'dir': None,
            'env_file': None,
            'recursive': False,
            'refresh_cache': False,
            'dry_run': False,
            'no_skip_existing': True,
            'workers': 1,
            'target': 'all',
            'bucket': None,
            'prefix': None,
            'endpoint': None,
            'region': None,
            'r2_proxy': None,
            'linux_host': None,
            'linux_user': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
        }
        values.update(overrides)
        return SimpleNamespace(**values)


class TargetResultCacheUpdateTests(unittest.TestCase):
    def test_apply_target_result_updates_only_successful_target(self):
        with TemporaryDirectory() as tmpdir:
            base_dir = Path(tmpdir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed_r2 = upload_r2.apply_target_result_to_cache(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='static-bucket|gallery/image.png',
                status='uploaded',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            changed_linux = upload_r2.apply_target_result_to_cache(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='linux',
                target_id='linux-host|/srv/gallery/image.png',
                status='failed',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

        self.assertTrue(changed_r2)
        self.assertFalse(changed_linux)
        self.assertIn('r2', cache_data['files']['image.png']['targets'])
        self.assertNotIn('linux', cache_data['files']['image.png']['targets'])


class RunUploadSyncCacheOnlyTests(OfflinePendingCatalogMixin, unittest.TestCase):
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
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
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
            'linux_key': None,
            'linux_password': 'secret',
            'linux_port': 22,
            'linux_proxy': None,
            'access_key': 'r2-access',
            'secret_key': 'r2-secret',
        }
        values.update(overrides)
        return upload_r2.UploadRuntimeConfig(**values)

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
        self.assertIn('R2 缓存同步：远端存在 1，已更新 1，已移除 0，未变化 0，失败 0', logs)


class UploadToR2SourceMtimeMetadataTests(unittest.TestCase):
    def test_upload_to_r2_uses_source_path_mtime_even_when_upload_path_is_shared(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            first_source_path = base_dir / 'first.png'
            second_source_path = base_dir / 'second.png'
            upload_path = base_dir / 'prepared-shared.png'
            shared_bytes = b'png-source-bytes'
            first_source_path.write_bytes(shared_bytes)
            second_source_path.write_bytes(shared_bytes)
            upload_body = b'prepared-png-bytes'
            upload_path.write_bytes(upload_body)
            first_mtime = 1712345678
            second_mtime = 1712349876
            os.utime(first_source_path, (first_mtime, first_mtime))
            os.utime(second_source_path, (second_mtime, second_mtime))
            expected_first_source_mtime = str(first_source_path.stat().st_mtime)
            expected_second_source_mtime = str(second_source_path.stat().st_mtime)
            client = MagicMock()

            with patch('upload_r2.make_r2_client', return_value=client):
                first_result = upload_r2.upload_to_r2(
                    first_source_path,
                    upload_path=upload_path,
                    base_dir=base_dir,
                    endpoint='https://example.invalid',
                    bucket='bucket-name',
                    prefix='gallery',
                    access_key='access-key',
                    secret_key='secret-key',
                    region='auto',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                )
                second_result = upload_r2.upload_to_r2(
                    second_source_path,
                    upload_path=upload_path,
                    base_dir=base_dir,
                    endpoint='https://example.invalid',
                    bucket='bucket-name',
                    prefix='gallery',
                    access_key='access-key',
                    secret_key='secret-key',
                    region='auto',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                )

        self.assertEqual(('uploaded', '已上传 first.png -> s3://bucket-name/gallery/first.png'), first_result)
        self.assertEqual(('uploaded', '已上传 second.png -> s3://bucket-name/gallery/second.png'), second_result)
        self.assertEqual(2, client.put_object.call_count)
        first_call = client.put_object.call_args_list[0].kwargs
        second_call = client.put_object.call_args_list[1].kwargs
        self.assertEqual(expected_first_source_mtime, first_call['Metadata']['source-mtime'])
        self.assertEqual(expected_second_source_mtime, second_call['Metadata']['source-mtime'])
        self.assertEqual(upload_body, first_call['Body'])
        self.assertEqual(upload_body, second_call['Body'])


class RunUploadPreparedPngMetadataTests(OfflinePendingCatalogMixin, unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'dir': None,
            'env_file': None,
            'recursive': False,
            'refresh_cache': False,
            'dry_run': False,
            'no_skip_existing': True,
            'workers': 1,
            'target': 'r2',
            'bucket': None,
            'prefix': None,
            'endpoint': None,
            'region': None,
            'r2_proxy': None,
            'linux_host': None,
            'linux_user': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'verify_remote': False,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_run_upload_records_prepared_png_metadata_for_uploaded_png(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            source_path = folder / 'image.png'
            source_path.write_bytes(b'png-source-bytes')
            sha256 = upload_r2.compute_file_sha256(source_path)
            cache_dir = folder / upload_r2.PREPARED_CACHE_DIR_NAME
            prepared_path = cache_dir / upload_r2.build_prepared_cache_key(
                sha256,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            cache_dir.mkdir(parents=True)
            prepared_path.write_bytes(b'prepared-png-bytes')
            args = self.make_args(dir=str(folder), target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            runtime_config = upload_r2.UploadRuntimeConfig(
                target='r2',
                bucket='bucket-name',
                prefix='gallery',
                region='auto',
                endpoint='https://example.invalid',
                r2_proxy=None,
                linux_host=None,
                linux_user=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                access_key='r2-access',
                secret_key='r2-secret',
            )
            prepared = upload_r2.PreparedUpload(
                source_path=source_path,
                upload_path=prepared_path,
                temp_path=None,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=runtime_config), \
                 patch('upload_r2.collect_files', return_value=[source_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch('upload_r2.get_prepared_cache_dir', return_value=cache_dir), \
                 patch('upload_r2.upload_to_r2', return_value=('uploaded', '已上传 image.png -> s3://bucket-name/gallery/image.png')), \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            self.assertEqual(
                {
                    'sha256': sha256,
                    'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                    'prepared_size': len(b'prepared-png-bytes'),
                },
                cache_data['files']['image.png']['prepared_png'],
            )
            save_mock.assert_called_once()


class LegacyCacheCompatibilityTests(unittest.TestCase):
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
            'linux_key': '/tmp/id_rsa',
            'linux_password': None,
            'linux_port': 22,
            'linux_proxy': None,
            'access_key': 'r2-access',
            'secret_key': 'r2-secret',
        }
        values.update(overrides)
        return upload_r2.UploadRuntimeConfig(**values)

    def test_load_upload_cache_preserves_top_level_legacy_target_sections_for_runtime_migration(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            legacy_targets = {
                'r2': {'bucket-name|gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
                'linux': {'linux-host|/srv/gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
                'qiniu': {'qiniu-bucket|gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
            }
            cache_path.write_text(upload_r2.json.dumps(legacy_targets), encoding='utf-8')

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(upload_r2.CACHE_SCHEMA_VERSION, cache_data['version'])
        self.assertEqual({}, cache_data['files'])
        self.assertEqual(legacy_targets, cache_data['_legacy_targets'])

    def test_load_upload_cache_rejects_disk_legacy_targets_runtime_contract(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_path.write_text(
                upload_r2.json.dumps({
                    '_legacy_targets': {
                        'r2': {'bucket-name|gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
                        'linux': {'linux-host|/srv/gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
                        'qiniu': {'qiniu-bucket|gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': True, 'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY}},
                    }
                }),
                encoding='utf-8',
            )

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(upload_r2.build_empty_upload_cache(), cache_data)

    def test_promote_legacy_cache_entries_rejects_fingerprint_mismatches(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['_legacy_targets'] = {
                'r2': {
                    upload_r2.get_target_cache_id('r2', path, base_dir=base_dir, config=config): {
                        'size': path.stat().st_size + 1,
                        'mtime': path.stat().st_mtime,
                        'compressed': True,
                        'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                    }
                }
            }

            migrated_counts = upload_r2.promote_legacy_cache_entries(
                [path],
                base_dir=base_dir,
                cache_data=cache_data,
                config=config,
                target_labels=('r2',),
            )

        self.assertEqual({'r2': 0, 'linux': 0, 'qiniu': 0}, migrated_counts)
        self.assertEqual({}, cache_data['files'])

    def test_save_upload_cache_writes_only_v4_fields(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['files']['image.png'] = {'targets': {'r2': {'id': 'bucket-name|gallery/image.png'}}}
            cache_data['_legacy_targets'] = {
                'r2': {'bucket-name|gallery/image.png': {'size': 10, 'mtime': 123.0, 'compressed': False, 'compression_strategy': None}}
            }

            upload_r2.save_upload_cache(cache_path, cache_data)

            saved_cache = upload_r2.json.loads(cache_path.read_text(encoding='utf-8'))

        self.assertEqual(
            {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'files': {'image.png': {'targets': {'r2': {'id': 'bucket-name|gallery/image.png'}}}},
            },
            saved_cache,
        )
        self.assertNotIn('_legacy_targets', saved_cache)

    def test_save_upload_cache_drops_transient_legacy_targets(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['files']['image.png'] = {'source': {'size': 1, 'mtime': 1.0}, 'targets': {}}
            cache_data['_legacy_targets'] = {'r2': {'bucket|gallery/image.png': {'size': 1}}}

            upload_r2.save_upload_cache(cache_path, cache_data)

            saved = upload_r2.json.loads(cache_path.read_text(encoding='utf-8'))

        self.assertEqual(
            {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'files': {'image.png': {'source': {'size': 1, 'mtime': 1.0}, 'targets': {}}},
            },
            saved,
        )


class IncrementalSyncIndexTests(unittest.TestCase):
    def test_load_upload_cache_discards_v3_sections_and_returns_v4_files_index(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_path.write_text(
                upload_r2.json.dumps({
                    'version': 3,
                    'r2': {'static-bucket|gallery/nested/image.png': {'cached': True}},
                    'linux': {'linux-host|/srv/gallery/nested/image.png': {'cached': True}},
                    'qiniu': {'static-bucket|gallery/nested/image.png': {'cached': True}},
                }),
                encoding='utf-8',
            )

            cache_data = upload_r2.load_upload_cache(cache_path)

        self.assertEqual(upload_r2.build_empty_upload_cache(), cache_data)

    def test_set_target_synced_creates_v4_file_record(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            target_id = 'static-bucket|gallery/nested/image.png'

            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id=target_id,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )

            self.assertEqual(
                {
                    'source': upload_r2.build_source_cache_fingerprint(path),
                    'targets': {
                        'r2': {
                            'id': target_id,
                            'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                                path,
                                compressed=True,
                                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                            ),
                        }
                    },
                },
                cache_data['files']['nested/image.png'],
            )

    def test_clear_target_synced_removes_only_requested_target(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket|gallery/nested/image.png',
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='linux',
                target_id='linux-host|/srv/gallery/nested/image.png',
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            changed = upload_r2.clear_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
            )

        self.assertTrue(changed)
        self.assertNotIn('r2', cache_data['files']['nested/image.png']['targets'])
        self.assertIn('linux', cache_data['files']['nested/image.png']['targets'])
        self.assertIn('source', cache_data['files']['nested/image.png'])

    def test_clear_target_synced_removes_empty_file_record_after_last_target(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.jpg'
            path.write_bytes(b'jpeg-bytes')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket|gallery/image.jpg',
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

    def test_clear_target_synced_keeps_source_and_prepared_png_when_last_target_removed(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            prepared = base_dir / 'prepared.png'
            prepared.write_bytes(b'prepared-png-bytes')
            prepared_size = prepared.stat().st_size
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id='bucket|gallery/image.png',
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            expected_source = upload_r2.build_source_cache_fingerprint(path)
            upload_r2.record_prepared_png_metadata(
                cache_data,
                path,
                base_dir=base_dir,
                sha256='abc123',
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                prepared_path=prepared,
            )

            changed = upload_r2.clear_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
            )

        self.assertTrue(changed)
        self.assertEqual(
            {
                'source': expected_source,
                'prepared_png': {
                    'sha256': 'abc123',
                    'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                    'prepared_size': prepared_size,
                },
                'prepared_artifacts': {
                    upload_r2.PNG_COMPRESSION_STRATEGY: {
                        'sha256': 'abc123',
                        'compression_strategy': upload_r2.PNG_COMPRESSION_STRATEGY,
                        'output_suffix': '.png',
                        'prepared_size': prepared_size,
                    }
                },
            },
            cache_data['files']['image.png'],
        )

    def test_save_upload_cache_replaces_file_atomically(self):
        with TemporaryDirectory() as temp_dir:
            cache_path = Path(temp_dir) / upload_r2.CACHE_FILE_NAME
            cache_data = upload_r2.build_empty_upload_cache()

            with patch('upload_r2.os.replace') as replace_mock:
                upload_r2.save_upload_cache(cache_path, cache_data)

        replace_mock.assert_called_once()
        self.assertEqual(cache_path.name, Path(replace_mock.call_args.args[1]).name)
        self.assertEqual(upload_r2.CACHE_FILE_NAME, Path(replace_mock.call_args.args[1]).name)


class ApplyUploadResultTests(unittest.TestCase):
    def test_apply_upload_result_logs_message_and_updates_counts(self):
        counts = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
        messages = []

        changed = upload_r2.apply_upload_result(
            target_label='r2',
            path=None,
            result=('uploaded', '已上传 image.png -> s3://bucket/gallery/image.png', False, None),
            counters=counts,
            on_message=messages.append,
            on_cache_update=lambda **kwargs: False,
        )

        self.assertFalse(changed)
        self.assertEqual(1, counts['uploaded'])
        self.assertEqual(['[R2] 已上传 image.png -> s3://bucket/gallery/image.png'], messages)

    def test_apply_upload_result_can_suppress_skipped_message_while_still_updating_counts_and_cache(self):
        counts = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
        messages = []
        cache_calls = []

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'png-bytes')

            changed = upload_r2.apply_upload_result(
                target_label='linux',
                path=path,
                result=(
                    'skipped',
                    '跳过 image.png -> user@host:/remote/image.png',
                    True,
                    upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                counters=counts,
                on_message=messages.append,
                on_cache_update=lambda **kwargs: cache_calls.append(kwargs) or True,
                emit_skipped_message=False,
            )

        self.assertTrue(changed)
        self.assertEqual([], messages)
        self.assertEqual(1, counts['skipped'])
        self.assertEqual('linux', cache_calls[0]['target_label'])
        self.assertEqual('skipped', cache_calls[0]['status'])

    def test_apply_upload_result_calls_cache_update_for_uploaded_and_skipped(self):
        counts = {'uploaded': 0, 'skipped': 0, 'dry-run': 0, 'failed': 0}
        cache_calls = []

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / 'image.png'
            path.write_bytes(b'png-bytes')

            changed = upload_r2.apply_upload_result(
                target_label='linux',
                path=path,
                result=(
                    'skipped',
                    '跳过 image.png -> user@host:/remote/image.png',
                    True,
                    upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                counters=counts,
                on_message=lambda message: None,
                on_cache_update=lambda **kwargs: cache_calls.append(kwargs) or True,
            )

        self.assertTrue(changed)
        self.assertEqual(1, counts['skipped'])
        self.assertEqual('linux', cache_calls[0]['target_label'])
        self.assertEqual('skipped', cache_calls[0]['status'])


if __name__ == '__main__':
    unittest.main()


class AvifDefaultBehaviorTests(OfflinePendingCatalogMixin, unittest.TestCase):
    def test_resolve_runtime_config_defaults_to_avif_lossless(self):
        args = SimpleNamespace(target='r2')

        with patch.dict(os.environ, {}, clear=True):
            config = resolve_runtime_config(args)

        self.assertEqual(upload_r2.DEFAULT_COMPRESSION_MODE, config.compression)
        self.assertFalse(config.replace_remote_png)

    def test_get_expected_upload_cache_semantics_uses_avif_for_convertible_raster_by_default(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            jpg_path = base_dir / 'image.jpg'
            svg_path = base_dir / 'image.svg'
            jpg_path.write_bytes(b'jpg-bytes')
            svg_path.write_text('<svg/>', encoding='utf-8')

            self.assertEqual(
                (True, upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY),
                upload_r2.get_expected_upload_cache_semantics(jpg_path, upload_r2.DEFAULT_COMPRESSION_MODE),
            )
            self.assertEqual(
                (False, None),
                upload_r2.get_expected_upload_cache_semantics(svg_path, upload_r2.DEFAULT_COMPRESSION_MODE),
            )

    def test_prepare_upload_file_reuses_persistent_cached_avif(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.jpg'
            source_path.write_bytes(b'jpg-source-bytes')
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_run(command, check, capture_output, **kwargs):
                run_calls.append(command)
                out_path = Path(command[-1])
                out_path.write_bytes(b'prepared-avif-bytes')
                return SimpleNamespace(stdout='', stderr='')

            with patch('upload_r2.shutil.which', return_value='/usr/bin/magick'), \
                 patch('upload_r2.subprocess.run', side_effect=fake_run), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir, create=True):
                first = upload_r2.prepare_upload_file(source_path, upload_r2.DEFAULT_COMPRESSION_MODE)
                second = upload_r2.prepare_upload_file(source_path, upload_r2.DEFAULT_COMPRESSION_MODE)

            try:
                self.assertEqual(first.upload_path, second.upload_path)
                self.assertEqual('.avif', first.upload_path.suffix)
                self.assertFalse(first.from_cache)
                self.assertTrue(second.from_cache)
                self.assertEqual(1, len(run_calls))
            finally:
                upload_r2.cleanup_prepared_upload(first)
                upload_r2.cleanup_prepared_upload(second)

    def test_prepare_upload_file_falls_back_to_imagemagick_convert(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.jpg'
            source_path.write_bytes(b'jpg-source-bytes')
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_which(name):
                return {'convert': '/usr/bin/convert'}.get(name)

            def fake_run(command, check, capture_output, **kwargs):
                run_calls.append(command)
                Path(command[-1]).write_bytes(b'prepared-avif-bytes')
                return SimpleNamespace(stdout='', stderr='')

            with patch('upload_r2.shutil.which', side_effect=fake_which), \
                 patch('upload_r2.subprocess.run', side_effect=fake_run), \
                 patch.object(upload_r2, 'get_prepared_cache_dir', return_value=cache_dir, create=True):
                prepared = upload_r2.prepare_upload_file(source_path, upload_r2.DEFAULT_COMPRESSION_MODE)

            try:
                self.assertEqual('/usr/bin/convert', run_calls[0][0])
                self.assertEqual('.avif', prepared.upload_path.suffix)
            finally:
                upload_r2.cleanup_prepared_upload(prepared)

    def test_upload_to_r2_uses_avif_key_and_content_type(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.png'
            upload_path = base_dir / 'prepared.avif'
            source_path.write_bytes(b'png-source')
            upload_path.write_bytes(b'avif-bytes')
            client = MagicMock()

            result = upload_r2.upload_to_r2(
                source_path,
                upload_path=upload_path,
                base_dir=base_dir,
                endpoint='https://example.invalid',
                bucket='bucket-name',
                prefix='gallery',
                access_key='access-key',
                secret_key='secret-key',
                region='auto',
                dry_run=False,
                skip_existing=False,
                existing_keys=None,
                compression_strategy=upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY,
                client=client,
            )

        self.assertEqual(('uploaded', '已上传 image.png -> s3://bucket-name/gallery/image.avif'), result)
        kwargs = client.put_object.call_args.kwargs
        self.assertEqual('gallery/image.avif', kwargs['Key'])
        self.assertEqual('image/avif', kwargs['ContentType'])
        self.assertEqual(b'avif-bytes', kwargs['Body'])

    def test_run_upload_records_prepared_avif_metadata_for_uploaded_png(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            source_path = folder / 'image.png'
            source_path.write_bytes(b'png-source-bytes')
            sha256 = upload_r2.compute_file_sha256(source_path)
            cache_dir = folder / upload_r2.PREPARED_CACHE_DIR_NAME
            prepared_path = cache_dir / upload_r2.build_prepared_cache_key(
                sha256,
                compression_strategy=upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY,
            )
            cache_dir.mkdir(parents=True)
            prepared_path.write_bytes(b'prepared-avif-bytes')
            args = SimpleNamespace(
                dir=str(folder), env_file=None, recursive=False, refresh_cache=False,
                dry_run=False, no_skip_existing=True, workers=1, target='r2',
                bucket=None, prefix=None, endpoint=None, region=None, r2_proxy=None,
                linux_host=None, linux_user=None, linux_key=None,
                linux_password=None, linux_port=None, linux_proxy=None, verify_remote=False,
                sync_cache_only=False, compression='avif-lossless', replace_remote_png=False,
            )
            cache_data = upload_r2.build_empty_upload_cache()
            runtime_config = upload_r2.UploadRuntimeConfig(
                target='r2', bucket='bucket-name', prefix='gallery', region='auto',
                endpoint='https://example.invalid', r2_proxy=None,
                linux_host=None, linux_user=None, linux_key=None,
                linux_password=None, linux_port=22, linux_proxy=None,
                access_key='r2-access', secret_key='r2-secret',
                compression='avif-lossless', replace_remote_png=False,
            )
            prepared = upload_r2.PreparedUpload(
                source_path=source_path,
                upload_path=prepared_path,
                temp_path=None,
                compressed=True,
                compression_strategy=upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=runtime_config), \
                 patch('upload_r2.collect_files', return_value=[source_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch('upload_r2.get_prepared_cache_dir', return_value=cache_dir), \
                 patch('upload_r2.upload_to_r2', return_value=('uploaded', '已上传 image.png -> s3://bucket-name/gallery/image.avif')), \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            self.assertEqual(
                {
                    'sha256': sha256,
                    'compression_strategy': upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY,
                    'output_suffix': '.avif',
                    'prepared_size': len(b'prepared-avif-bytes'),
                },
                cache_data['files']['image.png']['prepared_artifacts'][upload_r2.AVIF_LOSSLESS_COMPRESSION_STRATEGY],
            )
            save_mock.assert_called_once()

    def test_delete_replaced_png_from_r2_removes_old_png_after_avif_confirmation(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            config = upload_r2.UploadRuntimeConfig(
                target='r2', bucket='bucket-name', prefix='gallery', region='auto',
                endpoint='https://example.invalid', r2_proxy=None,
                linux_host=None, linux_user=None, linux_key=None,
                linux_password=None, linux_port=22, linux_proxy=None,
                access_key='r2-access', secret_key='r2-secret',
                compression='avif-lossless', replace_remote_png=True,
            )
            client = MagicMock()
            client.list_objects_v2.side_effect = [
                {'Contents': [{'Key': 'gallery/image.avif'}]},
                {'Contents': [{'Key': 'gallery/image.png'}]},
            ]

            with patch('upload_r2.make_r2_client', return_value=client):
                status, message = upload_r2.delete_replaced_png_from_r2(path, base_dir=base_dir, config=config)

        self.assertEqual('deleted', status)
        self.assertIn('gallery/image.png', message)
        client.delete_object.assert_called_once_with(Bucket='bucket-name', Key='gallery/image.png')




class ResolveRuntimeConfigTests(unittest.TestCase):
    def make_args(self, **overrides):
        values = {
            'target': 'r2',
            'bucket': None,
            'prefix': None,
            'endpoint': None,
            'region': None,
            'r2_proxy': None,
            'linux_host': None,
            'linux_user': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'compression': None,
            'replace_remote_png': False,
            'replace_remote_avif': False,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_resolve_runtime_config_prefers_cli_over_env(self):
        args = self.make_args(
            target='r2',
            bucket='cli-bucket',
            prefix='cli-prefix',
            endpoint='https://cli.example.com',
            region='cli-region',
            r2_proxy='http://cli-r2-proxy',
            linux_host='cli-linux-host',
            linux_user='cli-linux-user',
            linux_key='/cli/linux/key',
            linux_password='cli-linux-password',
            linux_port=2200,
            linux_proxy='socks5://cli-linux-proxy',
        )
        env = {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'R2_ENDPOINT': 'https://env.example.com',
            'AWS_REGION': 'env-region',
            'R2_PROXY': 'http://env-r2-proxy',
            'LINUX_UPLOAD_HOST': 'env-linux-host',
            'LINUX_UPLOAD_USER': 'env-linux-user',
            'LINUX_UPLOAD_KEY': '/env/linux/key',
            'LINUX_UPLOAD_PASSWORD': 'env-linux-password',
            'LINUX_UPLOAD_PORT': '2222',
            'LINUX_PROXY': 'socks5://env-linux-proxy',
            'CLOUDFLARE_R2_ACCESS_KEY_ID': 'env-r2-access',
            'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'env-r2-secret',
        }
        with patch.dict(os.environ, env, clear=True):
            config = resolve_runtime_config(args)
        self.assertEqual('r2', config.target)
        self.assertEqual('cli-bucket', config.bucket)
        self.assertEqual('cli-prefix', config.prefix)
        self.assertEqual('cli-region', config.region)
        self.assertEqual('https://cli.example.com', config.endpoint)
        self.assertEqual('http://cli-r2-proxy', config.r2_proxy)
        self.assertEqual('cli-linux-host', config.linux_host)
        self.assertEqual('cli-linux-user', config.linux_user)
        self.assertEqual('/cli/linux/key', config.linux_key)
        self.assertEqual('cli-linux-password', config.linux_password)
        self.assertEqual(2200, config.linux_port)
        self.assertEqual('socks5://cli-linux-proxy', config.linux_proxy)
        self.assertEqual('env-r2-access', config.access_key)
        self.assertEqual('env-r2-secret', config.secret_key)

    def test_resolve_runtime_config_uses_env_defaults_when_cli_missing(self):
        args = self.make_args(target='r2')
        env = {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'R2_PROXY': 'http://env-r2-proxy',
            'LINUX_UPLOAD_HOST': 'env-linux-host',
            'LINUX_UPLOAD_USER': 'env-linux-user',
            'LINUX_UPLOAD_KEY': '/env/linux/key',
            'LINUX_UPLOAD_PASSWORD': 'env-linux-password',
            'LINUX_UPLOAD_PORT': '2222',
            'LINUX_PROXY': 'socks5://env-linux-proxy',
            'CLOUDFLARE_ACCOUNT_ID': 'acct',
            'CLOUDFLARE_R2_ACCESS_KEY_ID': 'env-r2-access',
            'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'env-r2-secret',
        }
        with patch.dict(os.environ, env, clear=True):
            config = resolve_runtime_config(args)
        self.assertEqual('r2', config.target)
        self.assertEqual('env-bucket', config.bucket)
        self.assertEqual('env-prefix', config.prefix)
        self.assertEqual('http://env-r2-proxy', config.r2_proxy)
        self.assertEqual('env-linux-host', config.linux_host)
        self.assertEqual('env-linux-user', config.linux_user)
        self.assertEqual('/env/linux/key', config.linux_key)
        self.assertEqual('env-linux-password', config.linux_password)
        self.assertEqual(2222, config.linux_port)
        self.assertEqual('socks5://env-linux-proxy', config.linux_proxy)
        self.assertTrue(config.endpoint.endswith('.r2.cloudflarestorage.com'))

    def test_resolve_runtime_config_supports_skinny_args_objects(self):
        args = SimpleNamespace(target='r2')
        with patch.dict(os.environ, {
            'R2_BUCKET': 'env-bucket',
            'CLOUDFLARE_R2_ACCESS_KEY_ID': 'ak',
            'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'sk',
            'CLOUDFLARE_ACCOUNT_ID': 'acct',
        }, clear=True):
            config = resolve_runtime_config(args)
        self.assertEqual('r2', config.target)
        self.assertEqual('env-bucket', config.bucket)
        self.assertEqual('ak', config.access_key)
        self.assertEqual('sk', config.secret_key)

    def test_resolve_runtime_config_rejects_non_r2_target(self):
        args = self.make_args(target='linux')
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                resolve_runtime_config(args)


class ParserTargetChoicesTests(unittest.TestCase):
    def test_build_parser_only_allows_r2_target(self):
        parser = upload_r2.build_parser()
        args = parser.parse_args(['--target', 'r2'])
        self.assertEqual('r2', args.target)
        with self.assertRaises(SystemExit):
            parser.parse_args(['--target', 'qiniu'])
        with self.assertRaises(SystemExit):
            parser.parse_args(['--target', 'linux'])
