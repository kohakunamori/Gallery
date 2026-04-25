<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoScanner;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

final class PhotoScannerTest extends TestCase
{
    public function test_it_returns_root_and_first_level_folder_images_sorted_by_relative_path(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-scan-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel/day-1', 0777, true);
        mkdir($directory . '/family', 0777, true);

        file_put_contents($directory . '/root.jpg', 'root');
        file_put_contents($directory . '/travel/cover.png', 'cover');
        file_put_contents($directory . '/family/portrait.webp', 'portrait');
        file_put_contents($directory . '/family/lossless.avif', 'lossless');
        file_put_contents($directory . '/travel/day-1/deep.jpeg', 'deep');
        file_put_contents($directory . '/notes.txt', 'notes');
        file_put_contents($directory . '/family/skip.gif', 'skip');

        $scanner = new PhotoScanner();

        $results = array_map(
            static fn (array $photo): array => [
                'absolutePath' => str_replace('\\', '/', $photo['absolutePath']),
                'relativePath' => $photo['relativePath'],
            ],
            $scanner->scan($directory),
        );

        self::assertSame(
            [
                [
                    'absolutePath' => str_replace('\\', '/', $directory . '/family/lossless.avif'),
                    'relativePath' => 'family/lossless.avif',
                ],
                [
                    'absolutePath' => str_replace('\\', '/', $directory . '/family/portrait.webp'),
                    'relativePath' => 'family/portrait.webp',
                ],
                [
                    'absolutePath' => str_replace('\\', '/', $directory . '/root.jpg'),
                    'relativePath' => 'root.jpg',
                ],
                [
                    'absolutePath' => str_replace('\\', '/', $directory . '/travel/cover.png'),
                    'relativePath' => 'travel/cover.png',
                ],
            ],
            $results,
        );

        $this->removeDirectory($directory);
    }

    public function test_it_skips_a_broken_first_level_directory_instead_of_failing_the_scan(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-scan-' . bin2hex(random_bytes(4));
        mkdir($directory . '/good', 0777, true);

        file_put_contents($directory . '/root.jpg', 'root');
        file_put_contents($directory . '/good/child.png', 'child');

        $brokenDirectory = $directory . '/broken';
        exec(
            sprintf(
                "powershell.exe -NoProfile -Command \"New-Item -ItemType Junction -Path '%s' -Target 'C:\\System Volume Information' | Out-Null\"",
                str_replace('/', '\\', $brokenDirectory),
            ),
            $output,
            $exitCode,
        );
        self::assertSame(0, $exitCode);

        $scanner = new PhotoScanner();

        try {
            $results = array_map(
                static fn (array $photo): array => [
                    'absolutePath' => str_replace('\\', '/', $photo['absolutePath']),
                    'relativePath' => $photo['relativePath'],
                ],
                $scanner->scan($directory),
            );

            self::assertSame(
                [
                    [
                        'absolutePath' => str_replace('\\', '/', $directory . '/good/child.png'),
                        'relativePath' => 'good/child.png',
                    ],
                    [
                        'absolutePath' => str_replace('\\', '/', $directory . '/root.jpg'),
                        'relativePath' => 'root.jpg',
                    ],
                ],
                $results,
            );
        } finally {
            if (is_dir($brokenDirectory)) {
                rmdir($brokenDirectory);
            }

            $this->removeDirectory($directory);
        }
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
