import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, call, patch

import upload_r2
from upload_r2 import DEFAULT_BUCKET, DEFAULT_ENDPOINT, DEFAULT_PREFIX, resolve_runtime_config


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

    def test_get_cached_existing_linux_paths_reads_matching_entries_from_v4_files_index(self):
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
                            'linux': {
                                'id': 'linux-host|/srv/gallery/nested/image.png',
                                'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                                    path,
                                    compressed=compressed,
                                    compression_strategy=compression_strategy,
                                ),
                            }
                        },
                    }
                },
                'linux': {'linux-host|/srv/gallery/nested/image.png': {'cached': False}},
            }

            cached_targets = upload_r2.get_cached_existing_linux_paths(
                [path],
                base_dir=base_dir,
                remote_dir='/srv/gallery',
                host='linux-host',
                cache_data=cache_data,
            )

        self.assertEqual({'/srv/gallery/nested/image.png'}, cached_targets)

    def test_get_cached_existing_qiniu_keys_reads_matching_entries_from_v4_files_index(self):
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
                            'qiniu': {
                                'id': 'qiniu-bucket|gallery/nested/image.png',
                                'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                                    path,
                                    compressed=compressed,
                                    compression_strategy=compression_strategy,
                                ),
                            }
                        },
                    }
                },
                'qiniu': {'qiniu-bucket|gallery/nested/image.png': {'cached': False}},
            }

            cached_targets = upload_r2.get_cached_existing_qiniu_keys(
                [path],
                base_dir=base_dir,
                bucket='qiniu-bucket',
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

    def test_update_linux_cache_entry_writes_v4_files_target_record(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed = upload_r2.update_linux_cache_entry(
                cache_data,
                base_dir=base_dir,
                host='linux-host',
                remote_path='/srv/gallery/image.png',
                path=path,
                compressed=False,
                compression_strategy=None,
            )
            expected = {
                'source': upload_r2.build_source_cache_fingerprint(path),
                'targets': {
                    'linux': {
                        'id': 'linux-host|/srv/gallery/image.png',
                        'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                            path,
                            compressed=False,
                            compression_strategy=None,
                        ),
                    }
                },
            }

        self.assertTrue(changed)
        self.assertNotIn('linux', cache_data)
        self.assertEqual(expected, cache_data['files']['image.png'])

    def test_update_qiniu_cache_entry_writes_v4_files_target_record(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            cache_data = upload_r2.build_empty_upload_cache()

            changed = upload_r2.update_qiniu_cache_entry(
                cache_data,
                base_dir=base_dir,
                bucket='qiniu-bucket',
                object_key='gallery/image.png',
                path=path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            expected = {
                'source': upload_r2.build_source_cache_fingerprint(path),
                'targets': {
                    'qiniu': {
                        'id': 'qiniu-bucket|gallery/image.png',
                        'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                            path,
                            compressed=True,
                            compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                        ),
                    }
                },
            }

        self.assertTrue(changed)
        self.assertNotIn('qiniu', cache_data)
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


class PreparedPngCacheTests(unittest.TestCase):
    def test_prepare_upload_file_reuses_persistent_cached_png(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.png'
            source_path.write_bytes(b'png-source-bytes')
            cache_dir = base_dir / upload_r2.PREPARED_CACHE_DIR_NAME
            run_calls = []

            def fake_run(command, check, capture_output, text):
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

            def fake_run(command, check, capture_output, text):
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

            def fake_run(command, check, capture_output, text):
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

    def test_upload_pending_qiniu_files_reuses_single_auth(self):
        base_dir, planned = self._planned_batch()
        fake_auth = object()

        with patch.object(upload_r2.qiniu, 'Auth', return_value=fake_auth) as auth_mock, \
             patch.object(upload_r2, 'upload_to_qiniu', side_effect=[('uploaded', 'A'), ('uploaded', 'B')]) as upload_mock:
            results = upload_r2.upload_pending_qiniu_files(
                planned,
                base_dir=base_dir,
                bucket='qiniu-bucket',
                prefix='gallery',
                access_key='ak',
                secret_key='sk',
                dry_run=False,
                skip_existing=False,
                existing_keys=None,
            )

        self.assertEqual([item.source_path.name for item, _ in results], ['a.jpg', 'b.jpg'])
        self.assertEqual(auth_mock.call_count, 1)
        self.assertEqual(upload_mock.call_args_list[0].kwargs['auth'], fake_auth)
        self.assertEqual(upload_mock.call_args_list[1].kwargs['auth'], fake_auth)

    def test_upload_pending_qiniu_files_reports_cached_png_compression_progress(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            png_path = base_dir / 'image.png'
            prepared_png_path = base_dir / 'image.prepared.png'
            png_path.write_bytes(b'png-source')
            prepared_png_path.write_bytes(b'png-upload')
            planned = [
                upload_r2.PlannedUpload(png_path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
            ]
            logs = []

            with patch.object(upload_r2.qiniu, 'Auth', return_value=object()), \
                 patch.object(
                     upload_r2,
                     'prepare_upload_file',
                     return_value=upload_r2.PreparedUpload(
                         png_path,
                         prepared_png_path,
                         None,
                         True,
                         upload_r2.PNG_COMPRESSION_STRATEGY,
                         True,
                     ),
                 ), \
                 patch.object(upload_r2, 'upload_to_qiniu', return_value=('uploaded', '已上传 image.png')):
                upload_r2.upload_pending_qiniu_files(
                    planned,
                    base_dir=base_dir,
                    bucket='qiniu-bucket',
                    prefix='gallery',
                    access_key='ak',
                    secret_key='sk',
                    dry_run=False,
                    skip_existing=False,
                    existing_keys=None,
                    log_callback=logs.append,
                )

        self.assertEqual(['[七牛] [1/1] 复用已压缩缓存 image.png'], logs)

    def test_upload_pending_qiniu_files_returns_failed_result_per_item_when_shared_auth_creation_fails(self):
        base_dir, planned = self._planned_batch()

        with patch.object(upload_r2.qiniu, 'Auth', side_effect=RuntimeError('boom')) as auth_mock, \
             patch.object(upload_r2, 'upload_to_qiniu') as upload_mock:
            results = upload_r2.upload_pending_qiniu_files(
                planned,
                base_dir=base_dir,
                bucket='qiniu-bucket',
                prefix='gallery',
                access_key='ak',
                secret_key='sk',
                dry_run=False,
                skip_existing=False,
                existing_keys=None,
            )

        self.assertEqual(auth_mock.call_count, 1)
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

    def test_check_linux_remote_skip_result_uses_shared_sftp_skip_helper_for_sftp_cases(self):
        source_path = Path('/tmp/base/image.png')
        expected = ('skipped', '跳过 image.png -> linux-user@linux-host:/srv/gallery/image.png')
        cases = [
            {'ssh_key': None, 'password': 'secret', 'proxy_url': None},
            {'ssh_key': '/tmp/id_rsa', 'password': None, 'proxy_url': 'socks5://127.0.0.1:1080'},
        ]

        for case in cases:
            with self.subTest(case=case), patch(
                'upload_r2.check_linux_remote_skip_via_sftp',
                return_value=expected,
            ) as helper_mock:
                result = upload_r2.check_linux_remote_skip_result(
                    source_path,
                    base_dir=Path('/tmp/base'),
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=case['ssh_key'],
                    password=case['password'],
                    port=22,
                    proxy_url=case['proxy_url'],
                )

            self.assertEqual(expected, result)
            helper_mock.assert_called_once_with(
                source_path,
                remote_path='/srv/gallery/image.png',
                target='linux-user@linux-host',
                host='linux-host',
                user='linux-user',
                ssh_key=case['ssh_key'],
                password=case['password'],
                port=22,
                proxy_url=case['proxy_url'],
            )

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

    def test_upload_linux_file_with_sftp_uses_exists_helper_for_skip_existing(self):
        sftp = MagicMock()

        with patch('upload_r2.ensure_linux_remote_dirs_sftp') as ensure_mock, \
             patch('upload_r2.linux_sftp_path_exists', return_value=True) as exists_mock, \
             patch('upload_r2.upload_file_via_sftp') as upload_mock:
            status, message = upload_r2.upload_linux_file_with_sftp(
                sftp,
                source_path=Path('/tmp/image.png'),
                upload_path=Path('/tmp/prepared.png'),
                remote_path='/srv/gallery/image.png',
                target='linux-user@linux-host',
                skip_existing=True,
            )

        self.assertEqual('skipped', status)
        self.assertEqual('跳过 image.png -> linux-user@linux-host:/srv/gallery/image.png', message)
        ensure_mock.assert_called_once_with(sftp, '/srv/gallery/image.png')
        exists_mock.assert_called_once_with(sftp, '/srv/gallery/image.png')
        upload_mock.assert_not_called()

    def test_upload_file_via_sftp_puts_file_and_restores_mtime(self):
        with TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / 'source.png'
            upload_path = Path(temp_dir) / 'upload.png'
            source_path.write_bytes(b'source-bytes')
            upload_path.write_bytes(b'upload-bytes')
            expected_mtime = 1712345678.25
            os.utime(source_path, (expected_mtime, expected_mtime))
            sftp = MagicMock()

            upload_r2.upload_file_via_sftp(
                sftp,
                source_path=source_path,
                upload_path=upload_path,
                remote_path='/srv/gallery/upload.png',
            )

        sftp.put.assert_called_once_with(str(upload_path), '/srv/gallery/upload.png')
        sftp.utime.assert_called_once_with('/srv/gallery/upload.png', (expected_mtime, expected_mtime))


class UploadToLinuxRefactorTests(unittest.TestCase):
    def test_upload_to_linux_password_and_proxy_sftp_paths_share_one_helper_entry(self):
        cases = [
            {'ssh_key': None, 'password': 'secret', 'proxy_url': None},
            {'ssh_key': '/tmp/id_rsa', 'password': None, 'proxy_url': 'socks5://127.0.0.1:1080'},
        ]

        for case in cases:
            with self.subTest(case=case), TemporaryDirectory() as temp_dir:
                base_dir = Path(temp_dir)
                source_path = base_dir / 'image.png'
                upload_path = base_dir / 'prepared.png'
                source_path.write_bytes(b'source-bytes')
                upload_path.write_bytes(b'upload-bytes')

                with patch(
                    'upload_r2.upload_to_linux_via_sftp',
                    return_value=('uploaded', '已上传 image.png -> linux-user@linux-host:/srv/gallery/image.png'),
                ) as upload_mock:
                    status, message = upload_r2.upload_to_linux(
                        source_path,
                        upload_path=upload_path,
                        base_dir=base_dir,
                        remote_dir='/srv/gallery',
                        host='linux-host',
                        user='linux-user',
                        ssh_key=case['ssh_key'],
                        password=case['password'],
                        port=22,
                        dry_run=False,
                        skip_existing=False,
                        existing_paths=None,
                        proxy_url=case['proxy_url'],
                    )

                self.assertEqual('uploaded', status)
                self.assertEqual('已上传 image.png -> linux-user@linux-host:/srv/gallery/image.png', message)
                upload_mock.assert_called_once_with(
                    source_path,
                    upload_path=upload_path,
                    remote_path='/srv/gallery/image.png',
                    target='linux-user@linux-host',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=case['ssh_key'],
                    password=case['password'],
                    port=22,
                    skip_existing=False,
                    proxy_url=case['proxy_url'],
                )

    def test_upload_one_avoids_duplicate_remote_skip_check_after_linux_precheck(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.png'
            upload_path = base_dir / 'prepared.png'
            source_path.write_bytes(b'source-bytes')
            upload_path.write_bytes(b'upload-bytes')
            prepared = upload_r2.PreparedUpload(
                source_path=source_path,
                upload_path=upload_path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )

            with patch('upload_r2.check_linux_remote_skip_result', return_value=None) as precheck_mock, \
                 patch('upload_r2.prepare_upload_file', return_value=prepared) as prepare_mock, \
                 patch(
                     'upload_r2.upload_to_linux',
                     return_value=('uploaded', '已上传 image.png -> linux-user@linux-host:/srv/gallery/image.png'),
                 ) as upload_mock:
                results = upload_r2.upload_one(
                    source_path,
                    base_dir=base_dir,
                    target='linux',
                    endpoint='https://example.invalid',
                    bucket='bucket-name',
                    prefix='gallery',
                    access_key='access-key',
                    secret_key='secret-key',
                    region='auto',
                    dry_run=False,
                    skip_existing=True,
                    existing_keys=None,
                    existing_linux_paths=None,
                    existing_linux_filenames=None,
                    verify_remote=True,
                    r2_proxy=None,
                    linux_host='linux-host',
                    linux_user='linux-user',
                    linux_dir='/srv/gallery',
                    linux_key=None,
                    linux_password='secret',
                    linux_port=22,
                    linux_proxy=None,
                    qiniu_bucket='qiniu-bucket',
                    qiniu_prefix='gallery',
                    qiniu_access_key='qiniu-access',
                    qiniu_secret_key='qiniu-secret',
                    qiniu_existing_keys=None,
                    target_labels=('linux',),
                )

        self.assertEqual(
            [('uploaded', '已上传 image.png -> linux-user@linux-host:/srv/gallery/image.png', False, None)],
            results,
        )
        precheck_mock.assert_called_once_with(
            source_path,
            base_dir=base_dir,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key=None,
            password='secret',
            port=22,
            proxy_url=None,
        )
        prepare_mock.assert_called_once_with(source_path)
        upload_mock.assert_called_once_with(
            source_path,
            upload_path=upload_path,
            base_dir=base_dir,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key=None,
            password='secret',
            port=22,
            dry_run=False,
            skip_existing=False,
            existing_paths=None,
            proxy_url=None,
        )

    def test_upload_files_to_linux_via_password_uses_shared_sftp_transfer_helper_on_success(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.jpg'
            upload_path = base_dir / 'prepared.jpg'
            source_path.write_bytes(b'source-bytes')
            upload_path.write_bytes(b'upload-bytes')
            prepared = upload_r2.PreparedUpload(
                source_path=source_path,
                upload_path=upload_path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )
            client = MagicMock()
            sftp = MagicMock()

            with patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)) as open_mock, \
                 patch('upload_r2.prepare_upload_file', return_value=prepared) as prepare_mock, \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     return_value=('uploaded', '已上传 image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg'),
                 ) as upload_mock:
                results = upload_r2.upload_files_to_linux_via_password(
                    [source_path],
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    dry_run=False,
                    skip_existing=False,
                    existing_paths=None,
                    proxy_url='socks5://127.0.0.1:1080',
                )

        self.assertEqual(
            [('uploaded', '已上传 image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg', False, None)],
            results,
        )
        open_mock.assert_called_once_with(
            host='linux-host',
            user='linux-user',
            ssh_key=None,
            password='secret',
            port=22,
            proxy_url='socks5://127.0.0.1:1080',
        )
        prepare_mock.assert_called_once_with(source_path)
        upload_mock.assert_called_once_with(
            sftp,
            source_path=source_path,
            upload_path=upload_path,
            remote_path='/srv/gallery/image.jpg',
            target='linux-user@linux-host',
            skip_existing=False,
        )
        sftp.close.assert_called_once_with()
        client.close.assert_called_once_with()

    def test_upload_files_to_linux_via_password_reopens_connection_and_retries_after_connection_reset(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.jpg'
            upload_path = base_dir / 'prepared.jpg'
            source_path.write_bytes(b'source-bytes')
            upload_path.write_bytes(b'upload-bytes')
            prepared = upload_r2.PreparedUpload(
                source_path=source_path,
                upload_path=upload_path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )
            client1 = MagicMock()
            sftp1 = MagicMock()
            client2 = MagicMock()
            sftp2 = MagicMock()
            connection_error = OSError('Socket exception: connection reset (10054)')

            with patch(
                'upload_r2.open_linux_sftp_client',
                side_effect=[(client1, sftp1), (client2, sftp2)],
            ) as open_mock, \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     side_effect=[connection_error, ('uploaded', '已上传 image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg')],
                 ) as upload_mock:
                results = upload_r2.upload_files_to_linux_via_password(
                    [source_path],
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    dry_run=False,
                    skip_existing=False,
                    existing_paths=None,
                    proxy_url=None,
                )

        self.assertEqual(
            [('uploaded', '已上传 image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg', False, None)],
            results,
        )
        self.assertEqual(2, open_mock.call_count)
        self.assertEqual(2, upload_mock.call_count)
        sftp1.close.assert_called()
        client1.close.assert_called()
        sftp2.close.assert_called_once_with()
        client2.close.assert_called_once_with()

    def test_upload_files_to_linux_via_password_skip_existing_hit_does_not_call_shared_sftp_transfer_helper(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            source_path = base_dir / 'image.jpg'
            source_path.write_bytes(b'source-bytes')
            remote_path = '/srv/gallery/image.jpg'

            with patch('upload_r2.open_linux_sftp_client') as open_mock, \
                 patch('upload_r2.upload_linux_file_with_sftp') as upload_mock:
                results = upload_r2.upload_files_to_linux_via_password(
                    [source_path],
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    dry_run=False,
                    skip_existing=True,
                    existing_paths={remote_path},
                    proxy_url=None,
                )

        self.assertEqual(
            [('skipped', '跳过 image.jpg -> linux-user@linux-host:/srv/gallery/image.jpg', False, None)],
            results,
        )
        open_mock.assert_not_called()
        upload_mock.assert_not_called()


class LinuxBatchPendingUploadTests(unittest.TestCase):
    def test_upload_pending_linux_files_uses_single_shared_sftp_session_for_key_auth(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            first_path = base_dir / 'first.jpg'
            second_path = base_dir / 'second.jpg'
            first_upload_path = base_dir / 'first.prepared.jpg'
            second_upload_path = base_dir / 'second.prepared.jpg'
            first_path.write_bytes(b'first-source')
            second_path.write_bytes(b'second-source')
            first_upload_path.write_bytes(b'first-upload')
            second_upload_path.write_bytes(b'second-upload')
            items = [
                upload_r2.PlannedUpload(first_path, 'first.jpg', False, None),
                upload_r2.PlannedUpload(second_path, 'second.jpg', False, None),
            ]
            prepared_uploads = {
                first_path: upload_r2.PreparedUpload(first_path, first_upload_path, None, False, None),
                second_path: upload_r2.PreparedUpload(second_path, second_upload_path, None, False, None),
            }
            client = MagicMock()
            sftp = MagicMock()

            with patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)) as open_mock, \
                 patch('upload_r2.prepare_upload_file', side_effect=lambda path: prepared_uploads[path]) as prepare_mock, \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     side_effect=[
                         ('uploaded', '已上传 first.jpg -> linux-user@linux-host:/srv/gallery/first.jpg'),
                         ('uploaded', '已上传 second.jpg -> linux-user@linux-host:/srv/gallery/second.jpg'),
                     ],
                 ) as upload_mock:
                results = upload_r2.upload_pending_linux_files(
                    items,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password=None,
                    port=22,
                    proxy_url=None,
                )

        self.assertEqual(
            [
                (items[0], ('uploaded', '已上传 first.jpg -> linux-user@linux-host:/srv/gallery/first.jpg')),
                (items[1], ('uploaded', '已上传 second.jpg -> linux-user@linux-host:/srv/gallery/second.jpg')),
            ],
            results,
        )
        open_mock.assert_called_once_with(
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        self.assertEqual([call.args[0] for call in prepare_mock.call_args_list], [first_path, second_path])
        self.assertEqual(2, upload_mock.call_count)
        self.assertEqual(sftp, upload_mock.call_args_list[0].args[0])
        self.assertEqual(sftp, upload_mock.call_args_list[1].args[0])
        sftp.close.assert_called_once_with()
        client.close.assert_called_once_with()

    def test_upload_pending_linux_files_reports_png_compression_progress(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            png_path = base_dir / 'image.png'
            prepared_png_path = base_dir / 'image.prepared.png'
            png_path.write_bytes(b'png-source')
            prepared_png_path.write_bytes(b'png-upload')
            items = [
                upload_r2.PlannedUpload(png_path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
            ]
            client = MagicMock()
            sftp = MagicMock()
            logs = []

            with patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)), \
                 patch(
                     'upload_r2.prepare_upload_file',
                     return_value=upload_r2.PreparedUpload(
                         png_path,
                         prepared_png_path,
                         None,
                         True,
                         upload_r2.PNG_COMPRESSION_STRATEGY,
                     ),
                 ), \
                 patch('upload_r2.upload_linux_file_with_sftp', return_value=('uploaded', '已上传 image.png')):
                upload_r2.upload_pending_linux_files(
                    items,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password=None,
                    port=22,
                    proxy_url=None,
                    log_callback=logs.append,
                )

        self.assertEqual(['[Linux] [1/1] 压缩完成 image.png'], logs)

    def test_upload_pending_linux_files_falls_back_to_legacy_upload_for_key_auth_when_batch_open_fails(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            first_path = base_dir / 'first.jpg'
            second_path = base_dir / 'second.jpg'
            first_upload_path = base_dir / 'first.prepared.jpg'
            second_upload_path = base_dir / 'second.prepared.jpg'
            first_path.write_bytes(b'first-source')
            second_path.write_bytes(b'second-source')
            first_upload_path.write_bytes(b'first-upload')
            second_upload_path.write_bytes(b'second-upload')
            items = [
                upload_r2.PlannedUpload(first_path, 'first.jpg', False, None),
                upload_r2.PlannedUpload(second_path, 'second.jpg', False, None),
            ]
            prepared_uploads = {
                first_path: upload_r2.PreparedUpload(first_path, first_upload_path, None, False, None),
                second_path: upload_r2.PreparedUpload(second_path, second_upload_path, None, False, None),
            }

            with patch('upload_r2.open_linux_sftp_client', side_effect=OSError('connection reset by peer')) as open_mock, \
                 patch('upload_r2.prepare_upload_file', side_effect=lambda path: prepared_uploads[path]) as prepare_mock, \
                 patch(
                     'upload_r2.upload_to_linux',
                     side_effect=[
                         ('uploaded', '已上传 first.jpg -> linux-user@linux-host:/srv/gallery/first.jpg'),
                         ('uploaded', '已上传 second.jpg -> linux-user@linux-host:/srv/gallery/second.jpg'),
                     ],
                 ) as upload_mock:
                results = upload_r2.upload_pending_linux_files(
                    items,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key='/tmp/id_rsa',
                    password=None,
                    port=22,
                    proxy_url=None,
                )

        self.assertEqual(
            [
                (items[0], ('uploaded', '已上传 first.jpg -> linux-user@linux-host:/srv/gallery/first.jpg')),
                (items[1], ('uploaded', '已上传 second.jpg -> linux-user@linux-host:/srv/gallery/second.jpg')),
            ],
            results,
        )
        open_mock.assert_called_once()
        self.assertEqual([call.args[0] for call in prepare_mock.call_args_list], [first_path, second_path])
        self.assertEqual(2, upload_mock.call_count)
        upload_mock.assert_any_call(
            first_path,
            upload_path=first_upload_path,
            base_dir=base_dir,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            dry_run=False,
            skip_existing=False,
            existing_paths=None,
            proxy_url=None,
        )
        upload_mock.assert_any_call(
            second_path,
            upload_path=second_upload_path,
            base_dir=base_dir,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            dry_run=False,
            skip_existing=False,
            existing_paths=None,
            proxy_url=None,
        )


class PendingUploadPlanningTests(unittest.TestCase):
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
            'linux_dir': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'qiniu_bucket': None,
            'qiniu_prefix': None,
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
            'linux_dir': '/srv/gallery',
            'linux_key': '/tmp/id_rsa',
            'linux_password': None,
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

    def test_plan_pending_uploads_skips_targets_with_matching_cached_fingerprint(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'image.png'
            path.write_bytes(b'png-bytes')
            config = self.make_runtime_config()
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=base_dir,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/image.png'),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            pending = upload_r2.plan_pending_uploads(
                [path],
                base_dir=base_dir,
                config=config,
                target_labels=('r2', 'linux', 'qiniu'),
                cache_data=cache_data,
            )

        self.assertEqual([], pending['r2'])
        expected = upload_r2.PlannedUpload(
            source_path=path,
            relative_path='image.png',
            compressed=True,
            compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
        )
        self.assertEqual([expected], pending['linux'])
        self.assertEqual([expected], pending['qiniu'])

    def test_run_upload_promotes_legacy_cache_hits_before_pending_planning(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'image.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
            config = self.make_runtime_config(target='r2')
            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=True,
                compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
            )
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['_legacy_targets'] = {
                'r2': {'bucket-name|gallery/image.png': fingerprint},
                'linux': {},
                'qiniu': {},
            }
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys') as list_existing_keys_mock, \
                 patch('upload_r2.upload_pending_r2_files') as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(0, exit_code)
        list_existing_keys_mock.assert_not_called()
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('缓存命中 0' in m for m in messages))
        self.assertTrue(any('旧缓存迁移：1' in m for m in messages))
        self.assertNotIn('[R2] 跳过 image.png -> s3://bucket-name/gallery/image.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        save_mock.assert_called_once()

    def test_run_upload_without_verify_remote_does_not_probe_cached_hits(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'image.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/image.png'),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            expected_target = cache_data['files']['image.png']['targets']['r2'].copy()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys') as list_existing_keys_mock, \
                 patch('upload_r2.upload_pending_r2_files') as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(0, exit_code)
        list_existing_keys_mock.assert_not_called()
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('缓存命中 1' in m for m in messages))
        self.assertTrue(any('旧缓存迁移：0' in m for m in messages))
        self.assertNotIn('[R2] 跳过 image.png -> s3://bucket-name/gallery/image.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'image.png')['targets']['r2'])
        save_mock.assert_not_called()

    def test_run_upload_without_verify_remote_cold_start_linux_pending_checks_remote_once_before_batch_upload(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
            config = self.make_runtime_config(target='linux')

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_linux_filenames', return_value=(set(), None)) as list_linux_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'pending.jpg', False, None),
                             ('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                         )
                     ],
                 ) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        list_linux_mock.assert_called_once_with(upload_r2.LINUX_EXISTING_PHOTOS_API_URL)
        remote_check_mock.assert_called_once_with(
            path,
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        batch_upload_mock.assert_called_once_with(
            [upload_r2.PlannedUpload(path, 'pending.jpg', False, None)],
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        upload_one_mock.assert_not_called()

    def test_run_upload_without_verify_remote_cold_start_linux_password_checks_remote_once_before_sftp_upload(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            prepared = upload_r2.PreparedUpload(
                source_path=path,
                upload_path=path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )
            client = MagicMock()
            sftp = MagicMock()

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_linux_filenames', return_value=(set(), None)) as list_linux_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)), \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     return_value=('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                 ) as upload_sftp_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        list_linux_mock.assert_called_once_with(upload_r2.LINUX_EXISTING_PHOTOS_API_URL)
        remote_check_mock.assert_called_once_with(
            path,
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key=None,
            password='secret',
            port=22,
            proxy_url=None,
        )
        upload_sftp_mock.assert_called_once_with(
            sftp,
            source_path=path,
            upload_path=path,
            remote_path='/srv/gallery/pending.jpg',
            target='linux-user@linux-host',
            skip_existing=False,
        )

    def test_run_upload_with_verify_remote_only_checks_pending_r2_keys(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            cached_path = folder / 'cached.png'
            pending_path = folder / 'pending.png'
            cached_path.write_bytes(b'cached-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=True)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(cached_path)
            upload_r2.set_target_synced(
                cache_data,
                cached_path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/cached.png'),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[cached_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.upload_pending_r2_files', return_value=[
                     (pending_path, ('uploaded', '已上传 pending.png -> s3://bucket-name/gallery/pending.png', True, upload_r2.PNG_COMPRESSION_STRATEGY)),
                 ]) as batch_upload_mock, \
                 patch('upload_r2.upload_one', return_value=[('skipped', '跳过 cached.png -> s3://bucket-name/gallery/cached.png', True, upload_r2.PNG_COMPRESSION_STRATEGY)]) as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)) as list_existing_keys_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        self.assertEqual(['gallery/pending.png'], list_existing_keys_mock.call_args.kwargs['object_keys'])
        batch_upload_mock.assert_called_once()
        self.assertEqual([pending_path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        upload_one_mock.assert_not_called()

    def test_run_upload_with_verify_remote_reports_remote_confirmed_hits_separately_from_local_cache_hits(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.png'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=True)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.upload_pending_r2_files') as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)), \
                 patch('upload_r2.list_existing_keys', return_value=({'gallery/pending.png'}, None)) as list_existing_keys_mock:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_target = cache_data['files']['pending.png']['targets']['r2'].copy()

        self.assertEqual(0, exit_code)
        list_existing_keys_mock.assert_called_once()
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('缓存命中 0' in m for m in messages))
        self.assertTrue(any('旧缓存迁移：0' in m for m in messages))
        self.assertTrue(any('远端确认 1' in m for m in messages))
        self.assertNotIn('[R2] 跳过 pending.png -> s3://bucket-name/gallery/pending.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'pending.png')['targets']['r2'])
        save_mock.assert_called_once()

    def test_run_upload_cold_start_r2_precheck_skips_existing_png_before_prepare(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys', return_value=({'gallery/verified.png'}, None)) as list_existing_keys_mock, \
                 patch('upload_r2.prepare_upload_file') as prepare_mock, \
                 patch('upload_r2.upload_pending_r2_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_target = cache_data['files']['verified.png']['targets']['r2'].copy()

        self.assertEqual(0, exit_code)
        self.assertEqual(['gallery/verified.png'], list_existing_keys_mock.call_args.kwargs['object_keys'])
        prepare_mock.assert_not_called()
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('远端确认 1' in m for m in messages))
        self.assertNotIn('[R2] 跳过 verified.png -> s3://bucket-name/gallery/verified.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'verified.png')['targets']['r2'])
        save_mock.assert_called_once()

    def test_run_upload_cold_start_qiniu_precheck_skips_existing_png_before_prepare(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='qiniu', verify_remote=False)
            config = self.make_runtime_config(target='qiniu')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=({'gallery/verified.png'}, None)) as list_existing_qiniu_mock, \
                 patch('upload_r2.prepare_upload_file') as prepare_mock, \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_target = cache_data['files']['verified.png']['targets']['qiniu'].copy()

        self.assertEqual(0, exit_code)
        self.assertEqual(
            ('qiniu-bucket', ['gallery/verified.png'], 'qiniu-access', 'qiniu-secret'),
            list_existing_qiniu_mock.call_args.args,
        )
        prepare_mock.assert_not_called()
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('远端确认 1' in m for m in messages))
        self.assertNotIn('[七牛] 跳过 verified.png -> qiniu://qiniu-bucket/gallery/verified.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'verified.png')['targets']['qiniu'])
        save_mock.assert_called_once()

    def test_run_upload_normal_mode_suppresses_r2_skip_messages_but_keeps_skip_count(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=False)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys', return_value=({'gallery/verified.png'}, None)), \
                 patch('upload_r2.upload_pending_r2_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_target = cache_data['files']['verified.png']['targets']['r2'].copy()

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertNotIn('[R2] 跳过 verified.png -> s3://bucket-name/gallery/verified.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'verified.png')['targets']['r2'])
        save_mock.assert_called_once()

    def test_run_upload_normal_mode_suppresses_qiniu_skip_messages_but_keeps_skip_count(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='qiniu', verify_remote=False)
            config = self.make_runtime_config(target='qiniu')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=({'gallery/verified.png'}, None)), \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_target = cache_data['files']['verified.png']['targets']['qiniu'].copy()

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_not_called()
        upload_one_mock.assert_not_called()
        self.assertNotIn('[七牛] 跳过 verified.png -> qiniu://qiniu-bucket/gallery/verified.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        self.assertEqual(expected_target, upload_r2.get_file_cache_record(cache_data, 'verified.png')['targets']['qiniu'])
        save_mock.assert_called_once()

    def test_run_upload_dry_run_keeps_r2_skip_messages_for_skipped_batch_results(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='r2', verify_remote=False, dry_run=True)
            config = self.make_runtime_config(target='r2')
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'verified.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                             ('skipped', '跳过 verified.png -> s3://bucket-name/gallery/verified.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                         ),
                     ],
                 ) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_called_once()
        upload_one_mock.assert_not_called()
        self.assertTrue(any('[R2]' in m and '跳过 verified.png' in m for m in messages))
        self.assertIn('完成。演练 0，失败 0', messages)
        save_mock.assert_not_called()

    def test_run_upload_cold_start_linux_filename_precheck_skips_existing_png_before_prepare(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_linux_filenames', return_value=({'verified.png'}, None)) as list_linux_mock, \
                 patch('upload_r2.check_linux_remote_skip_result') as exact_check_mock, \
                 patch('upload_r2.prepare_upload_file') as prepare_mock, \
                 patch('upload_r2.upload_pending_linux_files', return_value=[]) as batch_upload_mock:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)

        self.assertEqual(0, exit_code)
        list_linux_mock.assert_called_once_with(upload_r2.LINUX_EXISTING_PHOTOS_API_URL)
        exact_check_mock.assert_not_called()
        prepare_mock.assert_not_called()
        batch_upload_mock.assert_not_called()
        self.assertTrue(any('远端确认 1' in m for m in messages))
        self.assertNotIn('[Linux] 跳过 verified.png -> linux-user@linux-host:/srv/gallery/verified.png', messages)
        self.assertIn('完成。上传 0，跳过 1，失败 0', messages)
        save_mock.assert_called_once()

    def test_run_upload_cold_start_linux_duplicate_basenames_skip_filename_api_and_fallback_to_exact_checks(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            first_dir = folder / 'first'
            second_dir = folder / 'second'
            first_dir.mkdir()
            second_dir.mkdir()
            existing_path = first_dir / 'verified.png'
            pending_path = second_dir / 'verified.png'
            existing_path.write_bytes(b'existing-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            messages = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[existing_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_linux_filenames') as list_linux_mock, \
                 patch(
                     'upload_r2.check_linux_remote_skip_result',
                     side_effect=[
                         ('skipped', '跳过 verified.png -> linux-user@linux-host:/srv/gallery/first/verified.png'),
                         None,
                     ],
                 ) as exact_check_mock, \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(
                                 pending_path,
                                 'second/verified.png',
                                 True,
                                 upload_r2.PNG_COMPRESSION_STRATEGY,
                             ),
                             ('uploaded', '已上传 verified.png -> linux-user@linux-host:/srv/gallery/second/verified.png'),
                         )
                     ],
                 ) as batch_upload_mock:
                exit_code = upload_r2.run_upload(args, log_callback=messages.append)
                expected_existing_target = {
                    'id': upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/first/verified.png'),
                    'synced_fingerprint': upload_r2.build_synced_target_fingerprint(
                        existing_path,
                        compressed=True,
                        compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                    ),
                }
                existing_record = upload_r2.get_file_cache_record(
                    cache_data,
                    upload_r2.build_cache_relative_path(existing_path, base_dir=folder),
                )

        self.assertEqual(0, exit_code)
        list_linux_mock.assert_not_called()
        exact_check_mock.assert_has_calls(
            [
                call(
                    existing_path,
                    base_dir=folder,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    proxy_url=None,
                ),
                call(
                    pending_path,
                    base_dir=folder,
                    remote_dir='/srv/gallery',
                    host='linux-host',
                    user='linux-user',
                    ssh_key=None,
                    password='secret',
                    port=22,
                    proxy_url=None,
                ),
            ]
        )
        self.assertEqual([pending_path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        self.assertTrue(any('远端确认 1' in m for m in messages))
        self.assertNotIn('[Linux] 跳过 verified.png -> linux-user@linux-host:/srv/gallery/first/verified.png', messages)
        self.assertIn('完成。上传 1，跳过 1，失败 0', messages)
        self.assertEqual(expected_existing_target, existing_record['targets']['linux'])
        save_mock.assert_called_once()

    def test_run_upload_without_skip_existing_batches_pending_r2_uploads(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path_a = folder / 'a.jpg'
            path_b = folder / 'b.jpg'
            path_a.write_bytes(b'a-bytes')
            path_b.write_bytes(b'b-bytes')
            args = self.make_args(dir=str(folder), target='r2', no_skip_existing=True)
            config = self.make_runtime_config(target='r2')

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path_a, path_b]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.upload_pending_r2_files', return_value=[
                     (path_a, ('uploaded', '已上传 a.jpg -> s3://bucket-name/gallery/a.jpg', False, None)),
                     (path_b, ('uploaded', '已上传 b.jpg -> s3://bucket-name/gallery/b.jpg', False, None)),
                 ]) as batch_upload_mock, \
                 patch('upload_r2.upload_one', return_value=[('uploaded', 'unexpected upload_one usage', False, None)]) as upload_one_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_called_once()
        self.assertEqual([path_a, path_b], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        self.assertFalse(batch_upload_mock.call_args.kwargs['skip_existing'])
        self.assertIsNone(batch_upload_mock.call_args.kwargs['existing_keys'])
        upload_one_mock.assert_not_called()

    def test_run_upload_without_skip_existing_batches_cached_r2_uploads(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'cached.jpg'
            path.write_bytes(b'cached-bytes')
            args = self.make_args(dir=str(folder), target='r2', no_skip_existing=True)
            config = self.make_runtime_config(target='r2')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=folder,
                target_label='r2',
                target_id=upload_r2.build_r2_cache_key('bucket-name', 'gallery/cached.jpg'),
                compressed=False,
                compression_strategy=None,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.upload_pending_r2_files', return_value=[
                     (upload_r2.PlannedUpload(path, 'cached.jpg', False, None), ('uploaded', '已上传 cached.jpg -> s3://bucket-name/gallery/cached.jpg', False, None)),
                 ]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_called_once()
        self.assertEqual([path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        self.assertFalse(batch_upload_mock.call_args.kwargs['skip_existing'])
        self.assertIsNone(batch_upload_mock.call_args.kwargs['existing_keys'])
        upload_one_mock.assert_not_called()

    def test_run_upload_without_skip_existing_batches_pending_qiniu_uploads(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path_a = folder / 'a.jpg'
            path_b = folder / 'b.jpg'
            path_a.write_bytes(b'a-bytes')
            path_b.write_bytes(b'b-bytes')
            args = self.make_args(dir=str(folder), target='qiniu', no_skip_existing=True)
            config = self.make_runtime_config(target='qiniu')

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path_a, path_b]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[
                     (path_a, ('uploaded', '已上传 a.jpg -> qiniu://qiniu-bucket/gallery/a.jpg', False, None)),
                     (path_b, ('uploaded', '已上传 b.jpg -> qiniu://qiniu-bucket/gallery/b.jpg', False, None)),
                 ]) as batch_upload_mock, \
                 patch('upload_r2.upload_one', return_value=[('uploaded', 'unexpected upload_one usage', False, None)]) as upload_one_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_called_once()
        self.assertEqual([path_a, path_b], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        self.assertFalse(batch_upload_mock.call_args.kwargs['skip_existing'])
        self.assertIsNone(batch_upload_mock.call_args.kwargs['existing_keys'])
        upload_one_mock.assert_not_called()

    def test_run_upload_without_skip_existing_batches_cached_qiniu_uploads(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'cached.jpg'
            path.write_bytes(b'cached-bytes')
            args = self.make_args(dir=str(folder), target='qiniu', no_skip_existing=True)
            config = self.make_runtime_config(target='qiniu')
            cache_data = upload_r2.build_empty_upload_cache()
            upload_r2.set_target_synced(
                cache_data,
                path,
                base_dir=folder,
                target_label='qiniu',
                target_id=upload_r2.build_qiniu_cache_key('qiniu-bucket', 'gallery/cached.jpg'),
                compressed=False,
                compression_strategy=None,
            )

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[
                     (upload_r2.PlannedUpload(path, 'cached.jpg', False, None), ('uploaded', '已上传 cached.jpg -> qiniu://qiniu-bucket/gallery/cached.jpg', False, None)),
                 ]) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        batch_upload_mock.assert_called_once()
        self.assertEqual([path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
        self.assertFalse(batch_upload_mock.call_args.kwargs['skip_existing'])
        self.assertIsNone(batch_upload_mock.call_args.kwargs['existing_keys'])
        upload_one_mock.assert_not_called()

    def test_run_upload_with_verify_remote_linux_pending_miss_checks_remote_only_once(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=True)
            config = self.make_runtime_config(target='linux')

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'pending.jpg', False, None),
                             ('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                         )
                     ],
                 ) as batch_upload_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        self.assertEqual(1, remote_check_mock.call_count)
        remote_check_mock.assert_called_once_with(
            path,
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        batch_upload_mock.assert_called_once_with(
            [upload_r2.PlannedUpload(path, 'pending.jpg', False, None)],
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        upload_one_mock.assert_not_called()

    def test_run_upload_with_verify_remote_linux_password_batch_miss_checks_remote_only_once(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=True)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            prepared = upload_r2.PreparedUpload(
                source_path=path,
                upload_path=path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )
            client = MagicMock()
            sftp = MagicMock()

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)), \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     return_value=('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                 ) as upload_sftp_mock:
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        self.assertEqual(1, remote_check_mock.call_count)
        upload_sftp_mock.assert_called_once_with(
            sftp,
            source_path=path,
            upload_path=path,
            remote_path='/srv/gallery/pending.jpg',
            target='linux-user@linux-host',
            skip_existing=False,
        )

    def test_run_upload_with_verify_remote_all_mode_linux_pending_miss_checks_remote_only_once(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=True)
            config = self.make_runtime_config(target='all')

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)) as list_existing_keys_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=(set(), None)) as list_existing_qiniu_keys_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'pending.jpg', False, None),
                             ('uploaded', '已上传 pending.jpg -> s3://bucket-name/gallery/pending.jpg', False, None),
                         )
                     ],
                 ) as batch_r2_mock, \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'pending.jpg', False, None),
                             ('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                         )
                     ],
                 ) as batch_linux_mock, \
                 patch(
                     'upload_r2.upload_pending_qiniu_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'pending.jpg', False, None),
                             ('uploaded', '已上传 pending.jpg -> qiniu://qiniu-bucket/gallery/pending.jpg', False, None),
                         )
                     ],
                 ) as batch_qiniu_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        self.assertEqual(1, remote_check_mock.call_count)
        remote_check_mock.assert_called_once_with(
            path,
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        self.assertEqual(['gallery/pending.jpg'], list_existing_keys_mock.call_args.kwargs['object_keys'])
        self.assertEqual(
            ('qiniu-bucket', ['gallery/pending.jpg'], 'qiniu-access', 'qiniu-secret'),
            list_existing_qiniu_keys_mock.call_args.args,
        )
        batch_r2_mock.assert_called_once_with(
            [upload_r2.PlannedUpload(path, 'pending.jpg', False, None)],
            base_dir=folder,
            endpoint='https://example.invalid',
            bucket='bucket-name',
            prefix='gallery',
            access_key='r2-access',
            secret_key='r2-secret',
            region='auto',
            dry_run=False,
            skip_existing=False,
            existing_keys=None,
            proxy_url=None,
        )
        batch_linux_mock.assert_called_once_with(
            [upload_r2.PlannedUpload(path, 'pending.jpg', False, None)],
            base_dir=folder,
            remote_dir='/srv/gallery',
            host='linux-host',
            user='linux-user',
            ssh_key='/tmp/id_rsa',
            password=None,
            port=22,
            proxy_url=None,
        )
        batch_qiniu_mock.assert_called_once_with(
            [upload_r2.PlannedUpload(path, 'pending.jpg', False, None)],
            base_dir=folder,
            bucket='qiniu-bucket',
            prefix='gallery',
            access_key='qiniu-access',
            secret_key='qiniu-secret',
            dry_run=False,
            skip_existing=False,
            existing_keys=None,
        )
        upload_one_mock.assert_not_called()

    def test_run_upload_with_verify_remote_all_mode_linux_password_batch_miss_checks_remote_only_once(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'pending.jpg'
            path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=True)
            config = self.make_runtime_config(target='all', linux_key=None, linux_password='secret')
            prepared = upload_r2.PreparedUpload(
                source_path=path,
                upload_path=path,
                temp_path=None,
                compressed=False,
                compression_strategy=None,
            )
            client = MagicMock()
            sftp = MagicMock()

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)), \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=(set(), None)), \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch('upload_r2.open_linux_sftp_client', return_value=(client, sftp)), \
                 patch('upload_r2.prepare_upload_file', return_value=prepared), \
                 patch(
                     'upload_r2.upload_linux_file_with_sftp',
                     return_value=('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg'),
                 ) as upload_sftp_mock, \
                 patch(
                     'upload_r2.upload_to_r2',
                     return_value=('uploaded', '已上传 pending.jpg -> s3://bucket-name/gallery/pending.jpg'),
                 ) as upload_r2_mock, \
                 patch(
                     'upload_r2.upload_to_qiniu',
                     return_value=('uploaded', '已上传 pending.jpg -> qiniu://qiniu-bucket/gallery/pending.jpg'),
                 ) as upload_qiniu_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

        self.assertEqual(0, exit_code)
        self.assertEqual(1, remote_check_mock.call_count)
        upload_sftp_mock.assert_called_once_with(
            sftp,
            source_path=path,
            upload_path=path,
            remote_path='/srv/gallery/pending.jpg',
            target='linux-user@linux-host',
            skip_existing=False,
        )
        upload_r2_mock.assert_called_once()
        upload_qiniu_mock.assert_called_once()

    def test_run_upload_without_verify_remote_linux_password_batch_only_passes_pending_files(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            cached_path = folder / 'cached.jpg'
            pending_path = folder / 'pending.jpg'
            cached_path.write_bytes(b'cached-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=False)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(cached_path)
            cached_remote_path = upload_r2.build_linux_remote_path(cached_path, base_dir=folder, remote_dir='/srv/gallery')
            upload_r2.set_target_synced(
                cache_data,
                cached_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', cached_remote_path),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            def fake_batch_upload(batch_items, **kwargs):
                return [
                    (item, ('uploaded', f'已上传 {item.source_path.name} -> linux-user@linux-host:{upload_r2.build_linux_remote_path(item.source_path, base_dir=folder, remote_dir="/srv/gallery")}'))
                    for item in batch_items
                ]

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[cached_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.check_linux_remote_skip_result') as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', side_effect=fake_batch_upload) as batch_upload_mock:
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            remote_check_mock.assert_not_called()
            self.assertEqual([pending_path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    pending_path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/pending.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )

    def test_run_upload_without_verify_remote_all_mode_linux_password_batch_only_passes_pending_files(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            cached_path = folder / 'cached.jpg'
            pending_path = folder / 'pending.jpg'
            cached_path.write_bytes(b'cached-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=False)
            config = self.make_runtime_config(target='all', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(cached_path)
            cached_remote_path = upload_r2.build_linux_remote_path(cached_path, base_dir=folder, remote_dir='/srv/gallery')
            upload_r2.set_target_synced(
                cache_data,
                cached_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', cached_remote_path),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            def fake_batch_upload(batch_items, **kwargs):
                return [
                    (item, ('uploaded', f'已上传 {item.source_path.name} -> linux-user@linux-host:{upload_r2.build_linux_remote_path(item.source_path, base_dir=folder, remote_dir="/srv/gallery")}'))
                    for item in batch_items
                ]

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[cached_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)) as list_existing_keys_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=(set(), None)) as list_existing_qiniu_keys_mock, \
                 patch('upload_r2.list_existing_linux_filenames', return_value=(set(), None)) as list_linux_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', side_effect=fake_batch_upload) as batch_upload_mock, \
                 patch('upload_r2.upload_pending_r2_files', return_value=[
                     (upload_r2.PlannedUpload(cached_path, 'cached.jpg', False, None), ('skipped', '跳过 cached.jpg -> s3://bucket-name/gallery/cached.jpg', False, None)),
                     (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('skipped', '跳过 pending.jpg -> s3://bucket-name/gallery/pending.jpg', False, None)),
                 ]) as batch_r2_mock, \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[
                     (upload_r2.PlannedUpload(cached_path, 'cached.jpg', False, None), ('skipped', '跳过 cached.jpg -> qiniu://qiniu-bucket/gallery/cached.jpg', False, None)),
                     (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('skipped', '跳过 pending.jpg -> qiniu://qiniu-bucket/gallery/pending.jpg', False, None)),
                 ]) as batch_qiniu_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            self.assertEqual(['gallery/cached.jpg', 'gallery/pending.jpg'], list_existing_keys_mock.call_args.kwargs['object_keys'])
            self.assertEqual(
                ('qiniu-bucket', ['gallery/cached.jpg', 'gallery/pending.jpg'], 'qiniu-access', 'qiniu-secret'),
                list_existing_qiniu_keys_mock.call_args.args,
            )
            list_linux_mock.assert_not_called()
            remote_check_mock.assert_not_called()
            self.assertEqual([pending_path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
            batch_r2_mock.assert_called_once()
            batch_qiniu_mock.assert_called_once()
            upload_one_mock.assert_not_called()
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    pending_path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/pending.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )

    def test_run_upload_without_verify_remote_all_mode_dry_run_emits_linux_results_without_batch_upload(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            pending_path = folder / 'pending.jpg'
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=False, dry_run=True)
            config = self.make_runtime_config(target='all', linux_key=None, linux_password='secret')
            logs = []

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.check_linux_remote_skip_result') as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', return_value=[]) as batch_upload_mock, \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('dry-run', '演练 pending.jpg -> s3://bucket-name/gallery/pending.jpg', False, None)),
                     ],
                 ) as batch_r2_mock, \
                 patch(
                     'upload_r2.upload_pending_qiniu_files',
                     return_value=[
                         (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('dry-run', '演练 pending.jpg -> qiniu://qiniu-bucket/gallery/pending.jpg', False, None)),
                     ],
                 ) as batch_qiniu_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

            self.assertEqual(0, exit_code)
            remote_check_mock.assert_not_called()
            batch_upload_mock.assert_not_called()
            batch_r2_mock.assert_called_once()
            batch_qiniu_mock.assert_called_once()
            upload_one_mock.assert_not_called()
            self.assertTrue(any('[Linux]' in m and '演练 pending.jpg' in m for m in logs))
            self.assertIn('完成。演练 3，失败 0', logs)

    def test_run_upload_without_verify_remote_all_mode_linux_key_batch_only_passes_pending_files(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            cached_path = folder / 'cached.jpg'
            pending_path = folder / 'pending.jpg'
            cached_path.write_bytes(b'cached-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=False)
            config = self.make_runtime_config(target='all', linux_key='/tmp/id_rsa', linux_password=None)
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(cached_path)
            cached_remote_path = upload_r2.build_linux_remote_path(cached_path, base_dir=folder, remote_dir='/srv/gallery')
            upload_r2.set_target_synced(
                cache_data,
                cached_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', cached_remote_path),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            pending_item = upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None)

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[cached_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)) as list_existing_keys_mock, \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=(set(), None)) as list_existing_qiniu_keys_mock, \
                 patch('upload_r2.list_existing_linux_filenames', return_value=(set(), None)) as list_linux_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=None) as remote_check_mock, \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (pending_item, ('uploaded', '已上传 pending.jpg -> linux-user@linux-host:/srv/gallery/pending.jpg')),
                     ],
                 ) as batch_upload_mock, \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (upload_r2.PlannedUpload(cached_path, 'cached.jpg', False, None), ('skipped', '跳过 cached.jpg -> s3://bucket-name/gallery/cached.jpg', False, None)),
                         (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('skipped', '跳过 pending.jpg -> s3://bucket-name/gallery/pending.jpg', False, None)),
                     ],
                 ) as batch_r2_mock, \
                 patch(
                     'upload_r2.upload_pending_qiniu_files',
                     return_value=[
                         (upload_r2.PlannedUpload(cached_path, 'cached.jpg', False, None), ('skipped', '跳过 cached.jpg -> qiniu://qiniu-bucket/gallery/cached.jpg', False, None)),
                         (upload_r2.PlannedUpload(pending_path, 'pending.jpg', False, None), ('skipped', '跳过 pending.jpg -> qiniu://qiniu-bucket/gallery/pending.jpg', False, None)),
                     ],
                 ) as batch_qiniu_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            self.assertEqual(['gallery/cached.jpg', 'gallery/pending.jpg'], list_existing_keys_mock.call_args.kwargs['object_keys'])
            self.assertEqual(
                ('qiniu-bucket', ['gallery/cached.jpg', 'gallery/pending.jpg'], 'qiniu-access', 'qiniu-secret'),
                list_existing_qiniu_keys_mock.call_args.args,
            )
            list_linux_mock.assert_not_called()
            remote_check_mock.assert_not_called()
            batch_upload_mock.assert_called_once()
            self.assertEqual([pending_item], batch_upload_mock.call_args.args[0])
            batch_r2_mock.assert_called_once()
            batch_qiniu_mock.assert_called_once()
            upload_one_mock.assert_not_called()
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    pending_path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/pending.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )

    def test_run_upload_with_verify_remote_linux_password_batch_only_passes_pending_miss_files(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            cached_path = folder / 'cached.jpg'
            pending_path = folder / 'pending.jpg'
            cached_path.write_bytes(b'cached-bytes')
            pending_path.write_bytes(b'pending-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=True)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(cached_path)
            cached_remote_path = upload_r2.build_linux_remote_path(cached_path, base_dir=folder, remote_dir='/srv/gallery')
            upload_r2.set_target_synced(
                cache_data,
                cached_path,
                base_dir=folder,
                target_label='linux',
                target_id=upload_r2.build_linux_cache_key('linux-host', cached_remote_path),
                compressed=compressed,
                compression_strategy=compression_strategy,
            )

            def fake_batch_upload(batch_items, **kwargs):
                return [
                    (item, ('uploaded', f'已上传 {item.source_path.name} -> linux-user@linux-host:{upload_r2.build_linux_remote_path(item.source_path, base_dir=folder, remote_dir="/srv/gallery")}'))
                    for item in batch_items
                ]

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[cached_path, pending_path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache'), \
                 patch('upload_r2.check_linux_remote_skip_result', side_effect=[None]) as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', side_effect=fake_batch_upload) as batch_upload_mock:
                exit_code = upload_r2.run_upload(args)

            self.assertEqual(0, exit_code)
            remote_check_mock.assert_called_once_with(
                pending_path,
                base_dir=folder,
                remote_dir='/srv/gallery',
                host='linux-host',
                user='linux-user',
                ssh_key=None,
                password='secret',
                port=22,
                proxy_url=None,
            )
            self.assertEqual([pending_path], [item.source_path for item in batch_upload_mock.call_args.args[0]])
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    pending_path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/pending.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )

    def test_run_upload_with_verify_remote_linux_password_batch_hit_reports_skipped_without_batch_upload(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.jpg'
            path.write_bytes(b'verified-bytes')
            args = self.make_args(dir=str(folder), target='linux', verify_remote=True)
            config = self.make_runtime_config(target='linux', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            logs = []
            skip_message = '跳过 verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg'

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=('skipped', skip_message)) as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.apply_upload_result', wraps=upload_r2.apply_upload_result) as apply_result_mock:
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

            self.assertEqual(0, exit_code)
            remote_check_mock.assert_called_once_with(
                path,
                base_dir=folder,
                remote_dir='/srv/gallery',
                host='linux-host',
                user='linux-user',
                ssh_key=None,
                password='secret',
                port=22,
                proxy_url=None,
            )
            batch_upload_mock.assert_not_called()
            self.assertTrue(
                any(
                    call.kwargs['target_label'] == 'linux'
                    and call.kwargs['path'] == path
                    and call.kwargs['result'] == ('skipped', skip_message, False, None)
                    and call.kwargs.get('emit_skipped_message') is False
                    for call in apply_result_mock.call_args_list
                )
            )
            self.assertNotIn('[Linux] 跳过 verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg', logs)
            self.assertIn('完成。上传 0，跳过 1，失败 0', logs)
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/verified.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )
            save_mock.assert_called_once()

    def test_run_upload_with_verify_remote_all_mode_linux_password_batch_hit_reports_skipped(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'verified.jpg'
            path.write_bytes(b'verified-bytes')
            args = self.make_args(dir=str(folder), target='all', verify_remote=True)
            config = self.make_runtime_config(target='all', linux_key=None, linux_password='secret')
            cache_data = upload_r2.build_empty_upload_cache()
            logs = []
            skip_message = '跳过 verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg'

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=cache_data), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)), \
                 patch('upload_r2.list_existing_qiniu_keys', return_value=(set(), None)), \
                 patch('upload_r2.check_linux_remote_skip_result', return_value=('skipped', skip_message)) as remote_check_mock, \
                 patch('upload_r2.upload_pending_linux_files', return_value=[]) as batch_upload_mock, \
                 patch('upload_r2.upload_pending_r2_files', return_value=[
                     (upload_r2.PlannedUpload(path, 'verified.jpg', False, None), ('uploaded', '已上传 verified.jpg -> s3://bucket-name/gallery/verified.jpg', False, None)),
                 ]) as batch_r2_mock, \
                 patch('upload_r2.upload_pending_qiniu_files', return_value=[
                     (upload_r2.PlannedUpload(path, 'verified.jpg', False, None), ('uploaded', '已上传 verified.jpg -> qiniu://qiniu-bucket/gallery/verified.jpg', False, None)),
                 ]) as batch_qiniu_mock, \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.apply_upload_result', wraps=upload_r2.apply_upload_result) as apply_result_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)):
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

            self.assertEqual(0, exit_code)
            remote_check_mock.assert_called_once_with(
                path,
                base_dir=folder,
                remote_dir='/srv/gallery',
                host='linux-host',
                user='linux-user',
                ssh_key=None,
                password='secret',
                port=22,
                proxy_url=None,
            )
            batch_upload_mock.assert_not_called()
            self.assertTrue(
                any(
                    call.kwargs['target_label'] == 'linux'
                    and call.kwargs['path'] == path
                    and call.kwargs['result'] == ('skipped', skip_message, False, None)
                    and call.kwargs.get('emit_skipped_message') is False
                    for call in apply_result_mock.call_args_list
                )
            )
            self.assertNotIn('[Linux] 跳过 verified.jpg -> linux-user@linux-host:/srv/gallery/verified.jpg', logs)
            self.assertIn('完成。上传 2，跳过 1，失败 0', logs)
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    path,
                    base_dir=folder,
                    target_label='linux',
                    target_id=upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/verified.jpg'),
                    compressed=False,
                    compression_strategy=None,
                )
            )
            save_mock.assert_called_once()

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
        self.assertIn('Linux 参数', help_text)
        self.assertIn('七牛参数', help_text)
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


class RunUploadCacheWriteRegressionTests(unittest.TestCase):
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

    def test_run_upload_updates_r2_and_qiniu_cache_entries_with_base_dir(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'image.png'
            path.write_bytes(b'png-bytes')
            args = self.make_args(dir=str(folder))
            logs = []
            runtime_config = upload_r2.UploadRuntimeConfig(
                target='all',
                bucket='bucket-name',
                prefix='gallery',
                region='auto',
                endpoint='https://example.invalid',
                r2_proxy=None,
                linux_host='linux-host',
                linux_user='linux-user',
                linux_dir='/srv/gallery',
                linux_key='/tmp/id_rsa',
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access',
                qiniu_secret_key='qiniu-secret',
                access_key='r2-access',
                secret_key='r2-secret',
            )

            with patch('upload_r2.resolve_runtime_config', return_value=runtime_config), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.load_upload_cache', return_value=upload_r2.build_empty_upload_cache()), \
                 patch('upload_r2.save_upload_cache') as save_mock, \
                 patch(
                     'upload_r2.upload_pending_r2_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                             ('uploaded', '已上传 image.png -> s3://bucket-name/gallery/image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                         )
                     ],
                 ), \
                 patch(
                     'upload_r2.upload_pending_linux_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                             ('uploaded', '已上传 image.png -> linux-user@linux-host:/srv/gallery/image.png'),
                         )
                     ],
                 ), \
                 patch(
                     'upload_r2.upload_pending_qiniu_files',
                     return_value=[
                         (
                             upload_r2.PlannedUpload(path, 'image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                             ('uploaded', '已上传 image.png -> qiniu://qiniu-bucket/gallery/image.png', True, upload_r2.PNG_COMPRESSION_STRATEGY),
                         )
                     ],
                 ), \
                 patch('upload_r2.upload_one') as upload_one_mock, \
                 patch('upload_r2.concurrent.futures.as_completed', side_effect=lambda futures: list(futures)), \
                 patch('upload_r2.apply_target_result_to_cache', side_effect=lambda *a, **k: True) as apply_target_mock:
                exit_code = upload_r2.run_upload(args, log_callback=logs.append)

        self.assertEqual(0, exit_code)
        self.assertTrue(any('完成。上传 3，跳过 0，失败 0' in message for message in logs))
        upload_one_mock.assert_not_called()
        self.assertEqual(3, apply_target_mock.call_count)
        apply_target_mock.assert_has_calls(
            [
                unittest.mock.call(
                    unittest.mock.ANY,
                    path,
                    base_dir=folder,
                    target_label='r2',
                    target_id='bucket-name|gallery/image.png',
                    status='uploaded',
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                unittest.mock.call(
                    unittest.mock.ANY,
                    path,
                    base_dir=folder,
                    target_label='linux',
                    target_id='linux-host|/srv/gallery/image.png',
                    status='uploaded',
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
                unittest.mock.call(
                    unittest.mock.ANY,
                    path,
                    base_dir=folder,
                    target_label='qiniu',
                    target_id='qiniu-bucket|gallery/image.png',
                    status='uploaded',
                    compressed=True,
                    compression_strategy=upload_r2.PNG_COMPRESSION_STRATEGY,
                ),
            ],
            any_order=True,
        )
        self.assertTrue(save_mock.called)


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
                '跳过 present.jpg -> linux-user@linux-host:/srv/gallery/present.jpg',
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
                self.assertFalse(any('[Linux] 跳过' in message for message in logs))
                self.assertIn('模式：仅同步缓存', logs)
                self.assertIn('R2 缓存同步：远端存在 1，已更新 1，已移除 1，未变化 0，失败 0', logs)
                self.assertIn('Linux 缓存同步：远端存在 1，已更新 1，已移除 1，未变化 0，失败 0', logs)
                self.assertIn('七牛 缓存同步：远端存在 1，已更新 1，已移除 1，未变化 0，失败 0', logs)
                self.assertIn('完成。缓存同步已完成，失败 0', logs)
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
        self.assertIn('R2 缓存同步：远端存在 1，已更新 1，已移除 0，未变化 0，失败 0', logs)

    def test_run_upload_sync_cache_only_normalizes_legacy_cache_and_preserves_other_targets(self):
        with TemporaryDirectory() as temp_dir:
            folder = Path(temp_dir)
            path = folder / 'image.jpg'
            path.write_bytes(b'image-bytes')
            cache_path = folder / upload_r2.CACHE_FILE_NAME
            args = self.make_args(dir=str(folder), target='r2', sync_cache_only=True)
            config = self.make_runtime_config(
                target='r2',
                linux_host=None,
                linux_user=None,
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                qiniu_bucket=None,
                qiniu_access_key=None,
                qiniu_secret_key=None,
            )
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            expected_source = upload_r2.build_source_cache_fingerprint(path)
            expected_target_fingerprint = upload_r2.build_synced_target_fingerprint(
                path,
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            r2_target_id = upload_r2.build_r2_cache_key('bucket-name', 'gallery/image.jpg')
            linux_target_id = upload_r2.build_linux_cache_key('linux-host', '/srv/gallery/image.jpg')
            qiniu_target_id = upload_r2.build_qiniu_cache_key('qiniu-bucket', 'gallery/image.jpg')

            cache_path.write_text(
                upload_r2.json.dumps({
                    'r2': {r2_target_id: fingerprint},
                    'linux': {linux_target_id: fingerprint},
                    'qiniu': {qiniu_target_id: fingerprint},
                }),
                encoding='utf-8',
            )

            with patch('upload_r2.resolve_runtime_config', return_value=config), \
                 patch('upload_r2.get_cache_file_path', return_value=cache_path), \
                 patch('upload_r2.collect_files', return_value=[path]), \
                 patch('upload_r2.list_existing_keys', return_value=(set(), None)):
                exit_code = upload_r2.run_upload(args)

            saved_cache = upload_r2.json.loads(cache_path.read_text(encoding='utf-8'))

        self.assertEqual(0, exit_code)
        self.assertEqual(
            {
                'version': upload_r2.CACHE_SCHEMA_VERSION,
                'files': {
                    'image.jpg': {
                        'source': expected_source,
                        'targets': {
                            'linux': {
                                'id': linux_target_id,
                                'synced_fingerprint': expected_target_fingerprint,
                            },
                            'qiniu': {
                                'id': qiniu_target_id,
                                'synced_fingerprint': expected_target_fingerprint,
                            },
                        },
                    }
                },
            },
            saved_cache,
        )


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


class RunUploadPreparedPngMetadataTests(unittest.TestCase):
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
            'linux_dir': None,
            'linux_key': None,
            'linux_password': None,
            'linux_port': None,
            'linux_proxy': None,
            'qiniu_bucket': None,
            'qiniu_prefix': None,
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
                linux_dir=None,
                linux_key=None,
                linux_password=None,
                linux_port=22,
                linux_proxy=None,
                qiniu_bucket='qiniu-bucket',
                qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access',
                qiniu_secret_key='qiniu-secret',
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

        with patch.dict(os.environ, {}, clear=True):
            config = resolve_runtime_config(args)

        self.assertEqual('all', config.target)

    def test_resolve_runtime_config_prefers_cli_over_env(self):
        args = self.make_args(
            target='both',
            bucket='cli-bucket',
            prefix='cli-prefix',
            endpoint='https://cli.example.com',
            region='cli-region',
            r2_proxy='http://cli-r2-proxy',
            linux_host='cli-linux-host',
            linux_user='cli-linux-user',
            linux_dir='/cli/linux/dir',
            linux_key='/cli/linux/key',
            linux_password='cli-linux-password',
            linux_port=2200,
            linux_proxy='socks5://cli-linux-proxy',
            qiniu_bucket='cli-qiniu-bucket',
            qiniu_prefix='cli-qiniu-prefix',
        )
        env = {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'R2_ENDPOINT': 'https://env.example.com',
            'AWS_REGION': 'env-region',
            'R2_PROXY': 'http://env-r2-proxy',
            'LINUX_UPLOAD_HOST': 'env-linux-host',
            'LINUX_UPLOAD_USER': 'env-linux-user',
            'LINUX_UPLOAD_DIR': '/env/linux/dir',
            'LINUX_UPLOAD_KEY': '/env/linux/key',
            'LINUX_UPLOAD_PASSWORD': 'env-linux-password',
            'LINUX_UPLOAD_PORT': '2222',
            'LINUX_PROXY': 'socks5://env-linux-proxy',
            'QINIU_BUCKET': 'env-qiniu-bucket',
            'QINIU_PREFIX': 'env-qiniu-prefix',
            'QINIU_ACCESS_KEY': 'env-qiniu-access',
            'QINIU_SECRET_KEY': 'env-qiniu-secret',
            'CLOUDFLARE_R2_ACCESS_KEY_ID': 'env-r2-access',
            'CLOUDFLARE_R2_SECRET_ACCESS_KEY': 'env-r2-secret',
        }

        with patch.dict(os.environ, env, clear=True):
            config = resolve_runtime_config(args)

        self.assertEqual('all', config.target)
        self.assertEqual('cli-bucket', config.bucket)
        self.assertEqual('cli-prefix', config.prefix)
        self.assertEqual('cli-region', config.region)
        self.assertEqual('https://cli.example.com', config.endpoint)
        self.assertEqual('http://cli-r2-proxy', config.r2_proxy)
        self.assertEqual('cli-linux-host', config.linux_host)
        self.assertEqual('cli-linux-user', config.linux_user)
        self.assertEqual('/cli/linux/dir', config.linux_dir)
        self.assertEqual('/cli/linux/key', config.linux_key)
        self.assertEqual('cli-linux-password', config.linux_password)
        self.assertEqual(2200, config.linux_port)
        self.assertEqual('socks5://cli-linux-proxy', config.linux_proxy)
        self.assertEqual('cli-qiniu-bucket', config.qiniu_bucket)
        self.assertEqual('cli-qiniu-prefix', config.qiniu_prefix)
        self.assertEqual('env-qiniu-access', config.qiniu_access_key)
        self.assertEqual('env-qiniu-secret', config.qiniu_secret_key)
        self.assertEqual('env-r2-access', config.access_key)
        self.assertEqual('env-r2-secret', config.secret_key)

    def test_resolve_runtime_config_uses_env_defaults_when_cli_missing(self):
        args = self.make_args(target='both')
        env = {
            'R2_BUCKET': 'env-bucket',
            'R2_PREFIX': 'env-prefix',
            'R2_PROXY': 'http://env-r2-proxy',
            'LINUX_UPLOAD_HOST': 'env-linux-host',
            'LINUX_UPLOAD_USER': 'env-linux-user',
            'LINUX_UPLOAD_DIR': '/env/linux/dir',
            'LINUX_UPLOAD_KEY': '/env/linux/key',
            'LINUX_UPLOAD_PORT': '2022',
            'LINUX_PROXY': 'socks5://env-linux-proxy',
            'QINIU_ACCESS_KEY': 'env-qiniu-access',
            'QINIU_SECRET_KEY': 'env-qiniu-secret',
            'AWS_ACCESS_KEY_ID': 'env-r2-access',
            'AWS_SECRET_ACCESS_KEY': 'env-r2-secret',
            'CLOUDFLARE_ACCOUNT_ID': 'account-123',
        }

        with patch.dict(os.environ, env, clear=True):
            config = resolve_runtime_config(args)

        self.assertEqual('all', config.target)
        self.assertEqual('env-bucket', config.bucket)
        self.assertEqual('env-prefix', config.prefix)
        self.assertEqual('auto', config.region)
        self.assertEqual('https://account-123.r2.cloudflarestorage.com', config.endpoint)
        self.assertEqual('http://env-r2-proxy', config.r2_proxy)
        self.assertEqual('env-linux-host', config.linux_host)
        self.assertEqual('env-linux-user', config.linux_user)
        self.assertEqual('/env/linux/dir', config.linux_dir)
        self.assertEqual('/env/linux/key', config.linux_key)
        self.assertIsNone(config.linux_password)
        self.assertEqual(2022, config.linux_port)
        self.assertEqual('socks5://env-linux-proxy', config.linux_proxy)
        self.assertEqual('env-bucket', config.qiniu_bucket)
        self.assertEqual('env-prefix', config.qiniu_prefix)
        self.assertEqual('env-qiniu-access', config.qiniu_access_key)
        self.assertEqual('env-qiniu-secret', config.qiniu_secret_key)
        self.assertEqual('env-r2-access', config.access_key)
        self.assertEqual('env-r2-secret', config.secret_key)

    def test_resolve_runtime_config_supports_skinny_args_objects(self):
        args = SimpleNamespace(target='both')

        with patch.dict(os.environ, {}, clear=True):
            config = resolve_runtime_config(args)

        self.assertEqual('all', config.target)
        self.assertEqual(DEFAULT_BUCKET, config.bucket)
        self.assertEqual(DEFAULT_PREFIX, config.prefix)
        self.assertEqual(DEFAULT_ENDPOINT, config.endpoint)
        self.assertEqual('auto', config.region)
        self.assertEqual(22, config.linux_port)
        self.assertEqual(DEFAULT_BUCKET, config.qiniu_bucket)
        self.assertEqual(DEFAULT_PREFIX, config.qiniu_prefix)


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
            'linux_dir': '/srv/gallery',
            'linux_key': '/tmp/id_rsa',
            'linux_password': None,
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

    def test_promote_legacy_cache_entries_marks_matching_targets_as_synced(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')
            config = self.make_runtime_config()
            compressed, compression_strategy = upload_r2.get_expected_upload_cache_semantics(path)
            fingerprint = upload_r2.build_upload_cache_fingerprint(
                path,
                compressed=compressed,
                compression_strategy=compression_strategy,
            )
            cache_data = upload_r2.build_empty_upload_cache()
            cache_data['_legacy_targets'] = {
                'r2': {
                    upload_r2.get_target_cache_id('r2', path, base_dir=base_dir, config=config): fingerprint,
                },
                'linux': {
                    upload_r2.get_target_cache_id('linux', path, base_dir=base_dir, config=config): fingerprint,
                },
                'qiniu': {
                    upload_r2.get_target_cache_id('qiniu', path, base_dir=base_dir, config=config): fingerprint,
                },
            }

            migrated_counts = upload_r2.promote_legacy_cache_entries(
                [path],
                base_dir=base_dir,
                cache_data=cache_data,
                config=config,
                target_labels=('r2',),
            )

            self.assertEqual({'r2': 1, 'linux': 0, 'qiniu': 0}, migrated_counts)
            self.assertTrue(
                upload_r2.is_target_synced(
                    cache_data,
                    path,
                    base_dir=base_dir,
                    target_label='r2',
                    target_id=upload_r2.get_target_cache_id('r2', path, base_dir=base_dir, config=config),
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                )
            )
            self.assertFalse(
                upload_r2.is_target_synced(
                    cache_data,
                    path,
                    base_dir=base_dir,
                    target_label='linux',
                    target_id=upload_r2.get_target_cache_id('linux', path, base_dir=base_dir, config=config),
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                )
            )
            self.assertFalse(
                upload_r2.is_target_synced(
                    cache_data,
                    path,
                    base_dir=base_dir,
                    target_label='qiniu',
                    target_id=upload_r2.get_target_cache_id('qiniu', path, base_dir=base_dir, config=config),
                    compressed=compressed,
                    compression_strategy=compression_strategy,
                )
            )

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


class AvifDefaultBehaviorTests(unittest.TestCase):
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

            def fake_run(command, check, capture_output, text):
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

    def test_build_effective_paths_use_avif_suffix_in_default_mode(self):
        with TemporaryDirectory() as temp_dir:
            base_dir = Path(temp_dir)
            path = base_dir / 'nested' / 'image.png'
            path.parent.mkdir(parents=True)
            path.write_bytes(b'png-bytes')

            self.assertEqual(
                'gallery/nested/image.avif',
                upload_r2.build_effective_object_key(
                    path,
                    base_dir=base_dir,
                    prefix='gallery',
                    compression=upload_r2.DEFAULT_COMPRESSION_MODE,
                ),
            )
            self.assertEqual(
                '/srv/gallery/nested/image.avif',
                upload_r2.build_effective_linux_remote_path(
                    path,
                    base_dir=base_dir,
                    remote_dir='/srv/gallery',
                    compression=upload_r2.DEFAULT_COMPRESSION_MODE,
                ),
            )

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
                linux_host=None, linux_user=None, linux_dir=None, linux_key=None,
                linux_password=None, linux_port=None, linux_proxy=None,
                qiniu_bucket=None, qiniu_prefix=None, verify_remote=False,
                sync_cache_only=False, compression='avif-lossless', replace_remote_png=False,
            )
            cache_data = upload_r2.build_empty_upload_cache()
            runtime_config = upload_r2.UploadRuntimeConfig(
                target='r2', bucket='bucket-name', prefix='gallery', region='auto',
                endpoint='https://example.invalid', r2_proxy=None,
                linux_host=None, linux_user=None, linux_dir=None, linux_key=None,
                linux_password=None, linux_port=22, linux_proxy=None,
                qiniu_bucket='qiniu-bucket', qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access', qiniu_secret_key='qiniu-secret',
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
                linux_host=None, linux_user=None, linux_dir=None, linux_key=None,
                linux_password=None, linux_port=22, linux_proxy=None,
                qiniu_bucket='qiniu-bucket', qiniu_prefix='gallery',
                qiniu_access_key='qiniu-access', qiniu_secret_key='qiniu-secret',
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
