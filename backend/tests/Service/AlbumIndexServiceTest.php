<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\AlbumIndexService;
use Gallery\Service\PhotoMetadataReaderInterface;
use Gallery\Service\PhotoScannerInterface;
use PHPUnit\Framework\TestCase;

final class AlbumIndexServiceTest extends TestCase
{
    public function test_it_builds_album_summaries_from_first_level_folders_only(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);
        mkdir($directory . '/family', 0777, true);

        $root = $directory . '/root.jpg';
        $travelOlder = $directory . '/travel/older.jpg';
        $travelNewest = $directory . '/travel/newest shot.jpg';
        $familyPhoto = $directory . '/family/pic.jpg';

        file_put_contents($root, 'root');
        file_put_contents($travelOlder, 'travel-older');
        file_put_contents($travelNewest, 'travel-newest');
        file_put_contents($familyPhoto, 'family');

        touch($root, strtotime('2026-03-31 12:00:00 UTC'));
        touch($travelOlder, strtotime('2026-03-05 10:00:00 UTC'));
        touch($travelNewest, strtotime('2026-03-01 10:00:00 UTC'));
        touch($familyPhoto, strtotime('2026-03-10 09:00:00 UTC'));

        $scanner = new class($root, $travelOlder, $travelNewest, $familyPhoto) implements PhotoScannerInterface {
            public function __construct(
                private readonly string $root,
                private readonly string $travelOlder,
                private readonly string $travelNewest,
                private readonly string $familyPhoto,
            ) {
            }

            public function scan(string $directory): array
            {
                return [
                    [
                        'absolutePath' => $this->root,
                        'relativePath' => 'root.jpg',
                    ],
                    [
                        'absolutePath' => $this->familyPhoto,
                        'relativePath' => 'family/pic.jpg',
                    ],
                    [
                        'absolutePath' => $this->travelOlder,
                        'relativePath' => 'travel/older.jpg',
                    ],
                    [
                        'absolutePath' => $this->travelNewest,
                        'relativePath' => 'travel/newest shot.jpg',
                    ],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return match (basename($path)) {
                    'newest shot.jpg' => ['takenAt' => '2026-03-20T08:00:00+00:00', 'width' => 1200, 'height' => 800],
                    default => ['takenAt' => null, 'width' => 1200, 'height' => 800],
                };
            }
        };

        $service = new AlbumIndexService($scanner, $metadataReader, $directory, '/media');

        self::assertSame(
            [
                [
                    'id' => 'travel',
                    'name' => 'travel',
                    'coverUrl' => '/media/travel/newest%20shot.jpg',
                    'photoCount' => 2,
                    'latestSortTime' => '2026-03-20T08:00:00+00:00',
                ],
                [
                    'id' => 'family',
                    'name' => 'family',
                    'coverUrl' => '/media/family/pic.jpg',
                    'photoCount' => 1,
                    'latestSortTime' => '2026-03-10T09:00:00+00:00',
                ],
            ],
            $service->all(),
        );
    }

    public function test_it_skips_a_scanned_album_photo_when_filemtime_fails_after_metadata_is_read(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);

        $photo = $directory . '/travel/vanishing.jpg';
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
                        'relativePath' => 'travel/vanishing.jpg',
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

        $service = new AlbumIndexService($scanner, $metadataReader, $directory, '/media');

        self::assertSame([], $service->all());
    }
}
