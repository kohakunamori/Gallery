<?php

declare(strict_types=1);

namespace Gallery\Service;

use DateTimeImmutable;
use DateTimeZone;

final class PhotoIndexService
{
    public function __construct(
        private readonly PhotoScannerInterface $scanner,
        private readonly PhotoMetadataReaderInterface $metadataReader,
        private readonly string $photosDirectory,
        private readonly string $defaultMediaBaseUrl,
        private readonly ?PhotoCacheInterface $cache = null,
        private readonly int $cacheTtlSeconds = 15,
        private readonly string $localMediaBaseUrl = '/media',
    ) {
    }

    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>
     */
    public function all(string $mediaSource = 'r2'): array
    {
        $mediaBaseUrl = $this->resolveMediaBaseUrl($mediaSource);
        $cacheKey = sha1($this->photosDirectory . '|' . $mediaBaseUrl);

        if ($this->cache !== null) {
            $cached = $this->cache->get($cacheKey);

            if ($cached !== null) {
                return $cached;
            }
        }

        $items = [];

        foreach ($this->scanner->scan($this->photosDirectory) as $photo) {
            $absolutePath = $photo['absolutePath'];
            $relativePath = $photo['relativePath'];

            if (!is_file($absolutePath) || !is_readable($absolutePath)) {
                continue;
            }

            $metadata = $this->metadataReader->read($absolutePath);
            $modifiedAt = @filemtime($absolutePath);

            if ($modifiedAt === false) {
                continue;
            }

            $filename = basename($relativePath);
            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) $modifiedAt))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);
            $url = rtrim($mediaBaseUrl, '/') . '/' . $this->encodeRelativePath($relativePath);

            $items[] = [
                'id' => sha1($relativePath . '|' . (string) $modifiedAt),
                'filename' => $filename,
                'url' => $url,
                'thumbnailUrl' => $url,
                'takenAt' => $metadata['takenAt'],
                'sortTime' => $sortTime,
                'width' => $metadata['width'],
                'height' => $metadata['height'],
            ];
        }

        usort(
            $items,
            static fn (array $left, array $right): int => strcmp($right['sortTime'], $left['sortTime']),
        );

        if ($this->cache !== null) {
            $this->cache->put($cacheKey, $items, $this->cacheTtlSeconds);
        }

        return $items;
    }

    private function resolveMediaBaseUrl(string $mediaSource): string
    {
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
