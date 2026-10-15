<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\FilePhotoCache;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

final class FilePhotoCacheTest extends TestCase
{
    public function testClearOnlyRemovesPhotoCacheFiles(): void
    {
        $cacheDirectory = $this->createTempDirectory('gallery-photo-cache-');
        $cache = new FilePhotoCache($cacheDirectory);
        $cache->put('photos:r2', [['id' => 'stale']], 300);
        $qiniuCachePath = $cacheDirectory . '/qiniu-usage.json';
        $otherJsonPath = $cacheDirectory . '/settings.json';
        file_put_contents($qiniuCachePath, '{}');
        file_put_contents($otherJsonPath, '{}');

        try {
            self::assertSame([['id' => 'stale']], $cache->get('photos:r2'));

            $cache->clear();

            self::assertNull($cache->get('photos:r2'));
            self::assertFileExists($qiniuCachePath);
            self::assertFileExists($otherJsonPath);
        } finally {
            $this->removeDirectory($cacheDirectory);
        }
    }

    private function createTempDirectory(string $prefix): string
    {
        $directory = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        return $directory;
    }

    private function removeDirectory(string $directory): void
    {
        if (!file_exists($directory)) {
            return;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );

        foreach ($iterator as $item) {
            if ($item->isDir() && !$item->isLink()) {
                rmdir($item->getPathname());

                continue;
            }

            unlink($item->getPathname());
        }

        rmdir($directory);
    }
}
