<?php

declare(strict_types=1);

namespace Gallery\Service;

final class AlbumIndexService
{
    public function __construct(
        private readonly PhotoCatalogService $catalog,
        private readonly string $mediaBaseUrl,
    ) {
    }

    /**
     * @return list<array{id:string,name:string,coverUrl:string,photoCount:int,latestSortTime:string}>
     */
    public function all(): array
    {
        $mediaBaseUrl = $this->mediaBaseUrl;
        $albums = [];

        foreach ($this->catalog->all() as $photo) {
            $relativePath = str_replace('\\', '/', $photo['path']);
            $parts = explode('/', $relativePath, 2);

            if (count($parts) !== 2) {
                continue;
            }

            [$albumId] = $parts;
            $sortTime = $photo['sortTime'];
            $coverUrl = rtrim($mediaBaseUrl, '/') . '/' . $this->encodeRelativePath($relativePath);

            if (!isset($albums[$albumId])) {
                $albums[$albumId] = [
                    'id' => $albumId,
                    'name' => $albumId,
                    'coverUrl' => $coverUrl,
                    'photoCount' => 0,
                    'latestSortTime' => $sortTime,
                ];
            }

            $albums[$albumId]['photoCount']++;

            if (strcmp($sortTime, $albums[$albumId]['latestSortTime']) > 0) {
                $albums[$albumId]['latestSortTime'] = $sortTime;
                $albums[$albumId]['coverUrl'] = $coverUrl;
            }
        }

        $items = array_values($albums);

        usort(
            $items,
            static fn (array $left, array $right): int => strcmp($right['latestSortTime'], $left['latestSortTime']),
        );

        return $items;
    }

    private function encodeRelativePath(string $relativePath): string
    {
        return implode(
            '/',
            array_map(
                static fn (string $segment): string => rawurlencode($segment),
                explode('/', str_replace('\\', '/', $relativePath)),
            ),
        );
    }
}
