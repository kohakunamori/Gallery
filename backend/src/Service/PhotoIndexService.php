<?php

declare(strict_types=1);

namespace Gallery\Service;

final class PhotoIndexService
{
    public function __construct(
        private readonly PhotoCatalogService $catalog,
        private readonly string $defaultMediaBaseUrl,
        private readonly ?PhotoCacheInterface $cache = null,
        private readonly int $cacheTtlSeconds = 15,
        private readonly string $localMediaBaseUrl = '',
        private readonly ?MediaSourceAvailabilityService $mediaSourceAvailabilityService = null,
        private readonly string $catalogIdentity = '',
    ) {
    }

    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>
     */
    public function all(string $mediaSource = 'r2'): array
    {
        $mediaBaseUrl = $this->resolveMediaBaseUrl($mediaSource);
        $cacheKey = sha1($this->catalogCacheIdentity() . '|' . $mediaBaseUrl);

        if ($this->cache !== null) {
            $cached = $this->cache->get($cacheKey);

            if ($cached !== null) {
                return $cached;
            }
        }

        $items = [];

        foreach ($this->catalog->all() as $photo) {
            $url = $this->buildVersionedMediaUrl($mediaBaseUrl, $photo['path'], $photo['version']);

            $items[] = [
                'id' => $photo['version'],
                'filename' => $photo['filename'],
                'url' => $url,
                'thumbnailUrl' => $url,
                'takenAt' => $photo['takenAt'],
                'sortTime' => $photo['sortTime'],
                'width' => $photo['width'],
                'height' => $photo['height'],
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

    private function catalogCacheIdentity(): string
    {
        if ($this->catalogIdentity === '') {
            return spl_object_id($this->catalog) . '';
        }

        // Content-aware identity so CLI / out-of-process catalog rewrites miss
        // the warm FilePhotoCache entry without waiting for TTL alone.
        $stat = @stat($this->catalogIdentity);

        if ($stat === false) {
            return $this->catalogIdentity;
        }

        $mtime = $stat['mtime'] ?? 0;
        $size = $stat['size'] ?? 0;

        return $this->catalogIdentity . '|' . (string) $mtime . '|' . (string) $size;
    }

    private function resolveMediaBaseUrl(string $mediaSource): string
    {
        if ($this->mediaSourceAvailabilityService !== null) {
            return $this->mediaSourceAvailabilityService->resolveMediaBaseUrl($mediaSource);
        }

        return $mediaSource === 'local' ? $this->localMediaBaseUrl : $this->defaultMediaBaseUrl;
    }

    private function buildVersionedMediaUrl(string $mediaBaseUrl, string $relativePath, string $version): string
    {
        $url = rtrim($mediaBaseUrl, '/') . '/' . $this->encodeRelativePath($relativePath);
        $separator = str_contains($url, '?') ? '&' : '?';

        return $url . $separator . 'v=' . rawurlencode($version);
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
