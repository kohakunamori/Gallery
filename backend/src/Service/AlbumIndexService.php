<?php

declare(strict_types=1);

namespace Gallery\Service;

use DateTimeImmutable;
use DateTimeZone;

final class AlbumIndexService
{
    public function __construct(
        private readonly PhotoScannerInterface $scanner,
        private readonly PhotoMetadataReaderInterface $metadataReader,
        private readonly string $photosDirectory,
        private readonly string $defaultMediaBaseUrl,
        private readonly string $localMediaBaseUrl = '/media',
        private readonly ?MediaSourceAvailabilityService $mediaSourceAvailabilityService = null,
    ) {
    }

    /**
     * @return list<array{id:string,name:string,coverUrl:string,photoCount:int,latestSortTime:string}>
     */
    public function all(string $mediaSource = 'r2'): array
    {
        $mediaBaseUrl = $this->resolveMediaBaseUrl($mediaSource);
        $albums = [];

        foreach ($this->scanner->scan($this->photosDirectory) as $photo) {
            $relativePath = str_replace('\\', '/', $photo['relativePath']);
            $parts = explode('/', $relativePath, 2);

            if (count($parts) !== 2) {
                continue;
            }

            [$albumId] = $parts;
            $absolutePath = $photo['absolutePath'];

            if (!is_file($absolutePath) || !is_readable($absolutePath)) {
                continue;
            }

            $metadata = $this->metadataReader->read($absolutePath);
            $modifiedAt = @filemtime($absolutePath);

            if ($modifiedAt === false) {
                continue;
            }

            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) $modifiedAt))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);

            if (!isset($albums[$albumId])) {
                $albums[$albumId] = [
                    'id' => $albumId,
                    'name' => $albumId,
                    'coverUrl' => rtrim($mediaBaseUrl, '/') . '/' . $this->encodeRelativePath($relativePath),
                    'photoCount' => 0,
                    'latestSortTime' => $sortTime,
                ];
            }

            $albums[$albumId]['photoCount']++;

            if (strcmp($sortTime, $albums[$albumId]['latestSortTime']) > 0) {
                $albums[$albumId]['latestSortTime'] = $sortTime;
                $albums[$albumId]['coverUrl'] = rtrim($mediaBaseUrl, '/') . '/' . $this->encodeRelativePath($relativePath);
            }
        }

        $items = array_values($albums);

        usort(
            $items,
            static fn (array $left, array $right): int => strcmp($right['latestSortTime'], $left['latestSortTime']),
        );

        return $items;
    }

    private function resolveMediaBaseUrl(string $mediaSource): string
    {
        if ($this->mediaSourceAvailabilityService !== null) {
            return $this->mediaSourceAvailabilityService->resolveMediaBaseUrl($mediaSource);
        }

        return $mediaSource === 'local' ? $this->localMediaBaseUrl : $this->defaultMediaBaseUrl;
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
