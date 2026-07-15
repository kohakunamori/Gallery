<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\AlbumIndexService;
use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\PhotoCatalogService;
use Gallery\Service\QiniuUsageService;
use PHPUnit\Framework\TestCase;

final class AlbumIndexServiceTest extends TestCase
{
    public function test_it_builds_album_summaries_from_first_level_folders_only(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'root.jpg',
                'filename' => 'root.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T12:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 10,
                'version' => 'root',
            ],
            [
                'path' => 'family/pic.jpg',
                'filename' => 'pic.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-10T09:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 11,
                'version' => 'family',
            ],
            [
                'path' => 'travel/older.jpg',
                'filename' => 'older.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-05T10:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 12,
                'version' => 'travel-old',
            ],
            [
                'path' => 'travel/newest shot.jpg',
                'filename' => 'newest shot.jpg',
                'takenAt' => '2026-03-20T08:00:00+00:00',
                'sortTime' => '2026-03-20T08:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 13,
                'version' => 'travel-new',
            ],
        ]);

        $service = new AlbumIndexService(new PhotoCatalogService($catalogPath), 'https://r2.example.com/gallery');
        $items = $service->all();

        self::assertSame(['travel', 'family'], array_column($items, 'id'));
        self::assertSame(2, $items[0]['photoCount']);
        self::assertSame('https://r2.example.com/gallery/travel/newest%20shot.jpg', $items[0]['coverUrl']);
        self::assertSame('2026-03-20T08:00:00+00:00', $items[0]['latestSortTime']);
        self::assertSame(1, $items[1]['photoCount']);
        self::assertSame('https://r2.example.com/gallery/family/pic.jpg', $items[1]['coverUrl']);

        @unlink($catalogPath);
    }

    public function test_it_builds_qiniu_album_cover_urls_when_qiniu_is_available(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.jpg',
                'filename' => 'cover.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 10,
                'version' => 'cover',
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

        $service = new AlbumIndexService(
            new PhotoCatalogService($catalogPath),
            'https://r2.example.com/gallery',
            '',
            $availabilityService,
        );

        $items = $service->all('qiniu');

        self::assertSame('https://qiniu.example.com/gallery/travel/cover.jpg', $items[0]['coverUrl']);

        @unlink($catalogPath);
    }

    /**
     * @param list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}> $items
     */
    private function writeCatalog(array $items): string
    {
        $path = sys_get_temp_dir() . '/gallery-album-catalog-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents($path, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => $items,
        ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

        return $path;
    }
}
