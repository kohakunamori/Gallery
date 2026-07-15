<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\FilePhotoCache;
use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\PhotoCatalogService;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\QiniuUsageService;
use PHPUnit\Framework\TestCase;

final class PhotoIndexServiceTest extends TestCase
{
    public function test_it_builds_sorted_photo_records_with_nested_media_urls_from_catalog(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/beach day.jpg',
                'filename' => 'beach day.jpg',
                'takenAt' => '2026-03-18T08:00:00+00:00',
                'sortTime' => '2026-03-18T08:00:00+00:00',
                'width' => 1024,
                'height' => 768,
                'size' => 10,
                'version' => 'older-version',
            ],
            [
                'path' => 'travel/with-exif.jpg',
                'filename' => 'with-exif.jpg',
                'takenAt' => '2026-03-31T10:00:00+00:00',
                'sortTime' => '2026-03-31T10:00:00+00:00',
                'width' => 2048,
                'height' => 1365,
                'size' => 20,
                'version' => 'exif-version',
            ],
            [
                'path' => 'fallback.png',
                'filename' => 'fallback.png',
                'takenAt' => null,
                'sortTime' => '2026-03-31T11:00:00+00:00',
                'width' => 1600,
                'height' => 900,
                'size' => 30,
                'version' => 'fallback-version',
            ],
        ]);

        $service = new PhotoIndexService(new PhotoCatalogService($catalogPath), 'https://r2.example.com/gallery');
        $items = $service->all();

        self::assertSame(['fallback.png', 'with-exif.jpg', 'beach day.jpg'], array_column($items, 'filename'));
        self::assertSame('https://r2.example.com/gallery/fallback.png?v=fallback-version', $items[0]['url']);
        self::assertSame('https://r2.example.com/gallery/travel/with-exif.jpg?v=exif-version', $items[1]['url']);
        self::assertSame('https://r2.example.com/gallery/travel/beach%20day.jpg?v=older-version', $items[2]['url']);
        self::assertSame('https://r2.example.com/gallery/travel/beach%20day.jpg?v=older-version', $items[2]['thumbnailUrl']);
        self::assertSame('2026-03-31T11:00:00+00:00', $items[0]['sortTime']);
        self::assertNotSame($items[0]['id'], $items[1]['id']);

        @unlink($catalogPath);
    }

    public function test_it_reuses_a_cached_photo_index_until_the_ttl_expires(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'cached.jpg',
                'filename' => 'cached.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T12:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 12,
                'version' => 'cached-version',
            ],
        ]);
        $cacheDirectory = sys_get_temp_dir() . '/gallery-cache-' . bin2hex(random_bytes(4));
        mkdir($cacheDirectory, 0777, true);

        $service = new PhotoIndexService(
            new PhotoCatalogService($catalogPath),
            'https://r2.example.com/gallery',
            new FilePhotoCache($cacheDirectory),
            30,
            '',
            null,
            $catalogPath,
        );

        $first = $service->all();
        $second = $service->all();

        self::assertSame($first, $second);
        self::assertCount(1, $second);

        @unlink($catalogPath);
        $this->removeDirectory($cacheDirectory);
    }

    public function test_it_misses_cache_when_catalog_content_changes(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'cached.jpg',
                'filename' => 'cached.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T12:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 12,
                'version' => 'cached-version',
            ],
        ]);
        $cacheDirectory = sys_get_temp_dir() . '/gallery-cache-' . bin2hex(random_bytes(4));
        mkdir($cacheDirectory, 0777, true);

        $service = new PhotoIndexService(
            new PhotoCatalogService($catalogPath),
            'https://r2.example.com/gallery',
            new FilePhotoCache($cacheDirectory),
            300,
            '',
            null,
            $catalogPath,
        );

        $first = $service->all();
        self::assertCount(1, $first);

        // Ensure mtime advances on filesystems with coarse timestamp resolution.
        clearstatcache(true, $catalogPath);
        $previousMtime = (int) filemtime($catalogPath);
        file_put_contents($catalogPath, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => [
                [
                    'path' => 'fresh.jpg',
                    'filename' => 'fresh.jpg',
                    'takenAt' => null,
                    'sortTime' => '2026-07-15T12:00:00+00:00',
                    'width' => 800,
                    'height' => 600,
                    'size' => 20,
                    'version' => 'fresh-version',
                ],
            ],
        ], JSON_THROW_ON_ERROR));
        touch($catalogPath, $previousMtime + 2);
        clearstatcache(true, $catalogPath);

        $second = $service->all();

        self::assertNotSame($first, $second);
        self::assertCount(1, $second);
        self::assertSame('fresh.jpg', $second[0]['filename']);

        @unlink($catalogPath);
        $this->removeDirectory($cacheDirectory);
    }

    public function test_it_builds_qiniu_media_urls_when_qiniu_is_available(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/beach day.jpg',
                'filename' => 'beach day.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T12:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 12,
                'version' => 'qiniu-version',
            ],
        ]);

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
            'local' => '',
        ], $qiniuUsageService);
        $service = new PhotoIndexService(
            new PhotoCatalogService($catalogPath),
            'https://r2.example.com/gallery',
            null,
            15,
            '',
            $availabilityService,
            $catalogPath,
        );

        $items = $service->all('qiniu');

        self::assertSame('https://qiniu.example.com/gallery/travel/beach%20day.jpg?v=qiniu-version', $items[0]['url']);
        self::assertSame('https://qiniu.example.com/gallery/travel/beach%20day.jpg?v=qiniu-version', $items[0]['thumbnailUrl']);

        @unlink($catalogPath);
    }

    /**
     * @param list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}> $items
     */
    private function writeCatalog(array $items): string
    {
        $path = sys_get_temp_dir() . '/gallery-catalog-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents($path, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => $items,
        ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

        return $path;
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        foreach (scandir($directory) ?: [] as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $item;
            is_dir($path) ? $this->removeDirectory($path) : @unlink($path);
        }

        @rmdir($directory);
    }
}
