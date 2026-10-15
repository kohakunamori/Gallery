<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoMetadataReader;
use PHPUnit\Framework\TestCase;

final class PhotoMetadataReaderTest extends TestCase
{
    public function test_it_reads_dimensions_and_returns_null_taken_at_when_no_exif_exists(): void
    {
        $file = sys_get_temp_dir() . '/gallery-image-' . bin2hex(random_bytes(4)) . '.png';
        file_put_contents(
            $file,
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', true),
        );

        $reader = new PhotoMetadataReader();
        $result = $reader->read($file);

        self::assertSame(null, $result['takenAt']);
        self::assertSame(1, $result['width']);
        self::assertSame(1, $result['height']);
    }

    public function test_it_parses_datetime_original_from_exif_data(): void
    {
        $file = sys_get_temp_dir() . '/gallery-image-' . bin2hex(random_bytes(4)) . '.jpg';
        file_put_contents($file, 'fake-jpeg-body');

        $reader = new PhotoMetadataReader(
            static fn (string $path): array => [
                'EXIF' => [
                    'DateTimeOriginal' => '2026:03:31 15:04:05',
                ],
            ],
        );

        $result = $reader->read($file);

        self::assertSame('2026-03-31T15:04:05+00:00', $result['takenAt']);
    }
}
