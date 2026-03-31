<?php

declare(strict_types=1);

namespace Gallery\Service;

use DirectoryIterator;
use UnexpectedValueException;

final class PhotoScanner implements PhotoScannerInterface
{
    private const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

    public function scan(string $directory): array
    {
        if (!is_dir($directory)) {
            return [];
        }

        $photos = [];

        foreach (new DirectoryIterator($directory) as $fileInfo) {
            if ($fileInfo->isDot()) {
                continue;
            }

            if ($fileInfo->isFile()) {
                $photo = $this->createPhotoEntry($directory, $fileInfo->getPathname());

                if ($photo !== null) {
                    $photos[] = $photo;
                }

                continue;
            }

            if (!$fileInfo->isDir()) {
                continue;
            }

            try {
                $childIterator = new DirectoryIterator($fileInfo->getPathname());
            } catch (UnexpectedValueException) {
                continue;
            }

            foreach ($childIterator as $childFileInfo) {
                if ($childFileInfo->isDot() || !$childFileInfo->isFile()) {
                    continue;
                }

                $photo = $this->createPhotoEntry($directory, $childFileInfo->getPathname());

                if ($photo !== null) {
                    $photos[] = $photo;
                }
            }
        }

        usort(
            $photos,
            static fn (array $left, array $right): int => strcmp($left['relativePath'], $right['relativePath']),
        );

        return array_values($photos);
    }

    /**
     * @return array{absolutePath:string,relativePath:string}|null
     */
    private function createPhotoEntry(string $rootDirectory, string $absolutePath): ?array
    {
        if (!in_array(strtolower(pathinfo($absolutePath, PATHINFO_EXTENSION)), self::SUPPORTED_EXTENSIONS, true)) {
            return null;
        }

        $normalizedRootDirectory = str_replace('\\', '/', rtrim($rootDirectory, '/\\'));
        $normalizedAbsolutePath = str_replace('\\', '/', $absolutePath);

        if (!str_starts_with($normalizedAbsolutePath, $normalizedRootDirectory . '/')) {
            return null;
        }

        return [
            'absolutePath' => $absolutePath,
            'relativePath' => substr($normalizedAbsolutePath, strlen($normalizedRootDirectory) + 1),
        ];
    }
}
