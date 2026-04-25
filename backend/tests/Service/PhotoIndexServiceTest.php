<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use ArrayObject;
use Gallery\Service\FilePhotoCache;
use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReaderInterface;
use Gallery\Service\PhotoScannerInterface;
use Gallery\Service\QiniuUsageService;
use PHPUnit\Framework\TestCase;

final class PhotoIndexServiceTest extends TestCase
{
    public function test_it_builds_sorted_photo_records_with_nested_media_urls_from_scanner_and_metadata(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);

        $fallback = $directory . '/fallback.png';
        $withExif = $directory . '/travel/with-exif.jpg';
        $older = $directory . '/travel/beach day.jpg';

        file_put_contents($fallback, 'fallback');
        file_put_contents($withExif, 'with-exif');
        file_put_contents($older, 'older');

        touch($fallback, strtotime('2026-03-31 11:00:00 UTC'));
        touch($withExif, strtotime('2026-03-25 09:00:00 UTC'));
        touch($older, strtotime('2026-03-20 09:00:00 UTC'));

        $scanner = new class([$withExif, $fallback, $older]) implements PhotoScannerInterface {
            public function __construct(private readonly array $paths)
            {
            }

            public function scan(string $directory): array
            {
                return array_map(
                    static fn (string $path): array => [
                        'absolutePath' => $path,
                        'relativePath' => str_replace(rtrim($directory, '/\\') . '/', '', $path),
                    ],
                    $this->paths,
                );
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return match (basename($path)) {
                    'with-exif.jpg' => ['takenAt' => '2026-03-31T10:00:00+00:00', 'width' => 2048, 'height' => 1365],
                    'fallback.png' => ['takenAt' => null, 'width' => 1600, 'height' => 900],
                    default => ['takenAt' => '2026-03-18T08:00:00+00:00', 'width' => 1024, 'height' => 768],
                };
            }
        };

        $service = new PhotoIndexService($scanner, $metadataReader, $directory, '/media');
        $items = $service->all();
        $fallbackVersion = sha1('fallback.png|' . (string) strtotime('2026-03-31 11:00:00 UTC'));
        $withExifVersion = sha1('travel/with-exif.jpg|' . (string) strtotime('2026-03-25 09:00:00 UTC'));
        $olderVersion = sha1('travel/beach day.jpg|' . (string) strtotime('2026-03-20 09:00:00 UTC'));

        self::assertSame(['fallback.png', 'with-exif.jpg', 'beach day.jpg'], array_column($items, 'filename'));
        self::assertSame('/media/fallback.png?v=' . $fallbackVersion, $items[0]['url']);
        self::assertSame('/media/travel/with-exif.jpg?v=' . $withExifVersion, $items[1]['url']);
        self::assertSame('/media/travel/beach%20day.jpg?v=' . $olderVersion, $items[2]['url']);
        self::assertSame('/media/travel/beach%20day.jpg?v=' . $olderVersion, $items[2]['thumbnailUrl']);
        self::assertSame('2026-03-31T11:00:00+00:00', $items[0]['sortTime']);
        self::assertNotSame($items[0]['id'], $items[1]['id']);
    }

    public function test_it_skips_a_scanned_file_when_filemtime_fails_after_metadata_is_read(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $photo = $directory . '/vanishing.jpg';
        file_put_contents($photo, 'vanishing');
        touch($photo, strtotime('2026-03-31 12:00:00 UTC'));

        $scanner = new class($photo) implements PhotoScannerInterface {
            public function __construct(private readonly string $photo)
            {
            }

            public function scan(string $directory): array
            {
                return [
                    [
                        'absolutePath' => $this->photo,
                        'relativePath' => 'vanishing.jpg',
                    ],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                unlink($path);

                return ['takenAt' => null, 'width' => 1200, 'height' => 800];
            }
        };

        $service = new PhotoIndexService($scanner, $metadataReader, $directory, '/media');

        self::assertSame([], $service->all());
    }

    public function test_it_reuses_a_cached_photo_index_until_the_ttl_expires(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        $cacheDirectory = sys_get_temp_dir() . '/gallery-cache-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);
        mkdir($cacheDirectory, 0777, true);

        $photo = $directory . '/cached.jpg';
        file_put_contents($photo, 'cached');
        touch($photo, strtotime('2026-03-31 12:00:00 UTC'));

        $scanCounter = new ArrayObject(['count' => 0]);

        $scanner = new class($photo, $scanCounter) implements PhotoScannerInterface {
            public function __construct(
                private readonly string $photo,
                private readonly ArrayObject $scanCounter,
            ) {
            }

            public function scan(string $directory): array
            {
                $this->scanCounter['count']++;

                return [
                    [
                        'absolutePath' => $this->photo,
                        'relativePath' => 'cached.jpg',
                    ],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return ['takenAt' => null, 'width' => 1200, 'height' => 800];
            }
        };

        $service = new PhotoIndexService(
            $scanner,
            $metadataReader,
            $directory,
            '/media',
            new FilePhotoCache($cacheDirectory),
            30,
        );

        $service->all();
        $service->all();

        self::assertSame(1, $scanCounter['count']);
    }

    public function test_it_builds_qiniu_media_urls_when_qiniu_is_available(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);

        $photo = $directory . '/travel/beach day.jpg';
        file_put_contents($photo, 'qiniu-photo');
        touch($photo, strtotime('2026-03-31 12:00:00 UTC'));

        $scanner = new class($photo) implements PhotoScannerInterface {
            public function __construct(private readonly string $photo)
            {
            }

            public function scan(string $directory): array
            {
                return [
                    [
                        'absolutePath' => $this->photo,
                        'relativePath' => 'travel/beach day.jpg',
                    ],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return ['takenAt' => null, 'width' => 1200, 'height' => 800];
            }
        };

        $qiniuUsageService = new QiniuUsageService(
            'ak',
            'sk',
            'bucket',
            'cdn.example.com',
            'api.qiniuapi.com',
            null,
            900,
            10 * 1024 * 1024 * 1024,
            static fn (string $requestTarget, array $headers): string => json_encode([
                [
                    'values' => [
                        'flow' => 1024,
                    ],
                ],
            ], JSON_THROW_ON_ERROR),
        );
        $availabilityService = new MediaSourceAvailabilityService([
            'r2' => 'https://r2.example.com/gallery',
            'qiniu' => 'https://qiniu.example.com/gallery',
            'local' => '/media',
        ], $qiniuUsageService);
        $service = new PhotoIndexService(
            $scanner,
            $metadataReader,
            $directory,
            'https://r2.example.com/gallery',
            null,
            15,
            '/media',
            $availabilityService,
        );

        $items = $service->all('qiniu');
        $version = sha1('travel/beach day.jpg|' . (string) strtotime('2026-03-31 12:00:00 UTC'));

        self::assertSame('https://qiniu.example.com/gallery/travel/beach%20day.jpg?v=' . $version, $items[0]['url']);
        self::assertSame('https://qiniu.example.com/gallery/travel/beach%20day.jpg?v=' . $version, $items[0]['thumbnailUrl']);
    }
}
