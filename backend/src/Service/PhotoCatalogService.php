<?php

declare(strict_types=1);

namespace Gallery\Service;

use RuntimeException;

final class PhotoCatalogService
{
    public function __construct(
        private readonly string $catalogPath,
    ) {
    }

    public function getPath(): string
    {
        return $this->catalogPath;
    }

    /**
     * @return list<array{
     *   path:string,
     *   filename:string,
     *   takenAt:?string,
     *   sortTime:string,
     *   width:?int,
     *   height:?int,
     *   size:int,
     *   version:string
     * }>
     */
    public function all(): array
    {
        $catalog = $this->readCatalog();

        return $catalog['items'];
    }

    /**
     * @param list<array{
     *   path:string,
     *   filename:string,
     *   takenAt:?string,
     *   sortTime:string,
     *   width:?int,
     *   height:?int,
     *   size:int,
     *   version:string
     * }> $items
     */
    public function upsertMany(array $items): void
    {
        if ($items === []) {
            return;
        }

        $this->mutate(static function (array $catalog) use ($items): array {
            $byPath = [];

            foreach ($catalog['items'] as $existing) {
                $byPath[$existing['path']] = $existing;
            }

            foreach ($items as $item) {
                $normalized = self::normalizeItem($item);
                $byPath[$normalized['path']] = $normalized;
            }

            $catalog['items'] = array_values($byPath);

            usort(
                $catalog['items'],
                static fn (array $left, array $right): int => strcmp($right['sortTime'], $left['sortTime']),
            );

            return $catalog;
        });
    }

    /**
     * @param callable(array{version:int,updatedAt:string,items:list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}>}): array{version:int,updatedAt:string,items:list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}>} $mutator
     */
    private function mutate(callable $mutator): void
    {
        $directory = dirname($this->catalogPath);

        if (!is_dir($directory) && !@mkdir($directory, 0775, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create the photo catalog directory.');
        }

        $handle = @fopen($this->catalogPath, 'c+');

        if ($handle === false) {
            throw new RuntimeException('Unable to open the photo catalog for writing.');
        }

        try {
            if (!flock($handle, LOCK_EX)) {
                throw new RuntimeException('Unable to lock the photo catalog.');
            }

            rewind($handle);
            $raw = stream_get_contents($handle);
            $catalog = $this->decodeCatalog(is_string($raw) ? $raw : '');
            $catalog = $mutator($catalog);
            $catalog['version'] = 1;
            $catalog['updatedAt'] = gmdate(DATE_ATOM);
            $catalog['items'] = array_map(
                static fn (array $item): array => self::normalizeItem($item),
                $catalog['items'],
            );

            $encoded = json_encode($catalog, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";

            rewind($handle);
            if (ftruncate($handle, 0) === false) {
                throw new RuntimeException('Unable to rewrite the photo catalog.');
            }

            $written = fwrite($handle, $encoded);

            if ($written === false || $written !== strlen($encoded)) {
                throw new RuntimeException('Unable to write the photo catalog.');
            }

            fflush($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    /**
     * @return array{version:int,updatedAt:string,items:list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}>}
     */
    private function readCatalog(): array
    {
        if (!is_file($this->catalogPath)) {
            return $this->emptyCatalog();
        }

        $raw = @file_get_contents($this->catalogPath);

        if (!is_string($raw)) {
            return $this->emptyCatalog();
        }

        return $this->decodeCatalog($raw);
    }

    /**
     * @return array{version:int,updatedAt:string,items:list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}>}
     */
    private function decodeCatalog(string $raw): array
    {
        $trimmed = trim($raw);

        if ($trimmed === '') {
            return $this->emptyCatalog();
        }

        try {
            $decoded = json_decode($trimmed, true, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return $this->emptyCatalog();
        }

        if (!is_array($decoded)) {
            return $this->emptyCatalog();
        }

        $items = $decoded['items'] ?? [];

        if (!is_array($items)) {
            return $this->emptyCatalog();
        }

        $normalizedItems = [];

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            try {
                $normalizedItems[] = self::normalizeItem($item);
            } catch (RuntimeException) {
                continue;
            }
        }

        return [
            'version' => 1,
            'updatedAt' => is_string($decoded['updatedAt'] ?? null) ? $decoded['updatedAt'] : gmdate(DATE_ATOM),
            'items' => $normalizedItems,
        ];
    }

    /**
     * @return array{version:int,updatedAt:string,items:list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}>}
     */
    private function emptyCatalog(): array
    {
        return [
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => [],
        ];
    }

    /**
     * @param array<string, mixed> $item
     * @return array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}
     */
    private static function normalizeItem(array $item): array
    {
        $path = isset($item['path']) && is_string($item['path'])
            ? str_replace('\\', '/', trim($item['path'], '/'))
            : '';

        if ($path === '' || str_contains($path, "\0") || str_contains($path, '..')) {
            throw new RuntimeException('Catalog item path is invalid.');
        }

        $filename = isset($item['filename']) && is_string($item['filename']) && $item['filename'] !== ''
            ? $item['filename']
            : basename($path);

        $takenAt = isset($item['takenAt']) && is_string($item['takenAt']) && $item['takenAt'] !== ''
            ? $item['takenAt']
            : null;

        $sortTime = isset($item['sortTime']) && is_string($item['sortTime']) && $item['sortTime'] !== ''
            ? $item['sortTime']
            : ($takenAt ?? gmdate(DATE_ATOM));

        $width = isset($item['width']) && is_int($item['width']) ? $item['width'] : null;
        $height = isset($item['height']) && is_int($item['height']) ? $item['height'] : null;
        $size = isset($item['size']) && is_int($item['size']) && $item['size'] >= 0 ? $item['size'] : 0;
        $version = isset($item['version']) && is_string($item['version']) && $item['version'] !== ''
            ? $item['version']
            : sha1($path . '|' . $sortTime . '|' . (string) $size);

        return [
            'path' => $path,
            'filename' => $filename,
            'takenAt' => $takenAt,
            'sortTime' => $sortTime,
            'width' => $width,
            'height' => $height,
            'size' => $size,
            'version' => $version,
        ];
    }
}
