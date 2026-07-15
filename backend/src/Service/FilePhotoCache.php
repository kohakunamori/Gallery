<?php

declare(strict_types=1);

namespace Gallery\Service;

final class FilePhotoCache implements PhotoCacheInterface
{
    public function __construct(
        private readonly string $cacheDirectory,
    ) {
    }

    public function get(string $key): ?array
    {
        $path = $this->pathFor($key);

        if (!is_file($path)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($path), true);

        if (!is_array($decoded) || !isset($decoded['expiresAt'], $decoded['value'])) {
            return null;
        }

        if ((int) $decoded['expiresAt'] < time()) {
            @unlink($path);

            return null;
        }

        return is_array($decoded['value']) ? $decoded['value'] : null;
    }

    public function put(string $key, array $value, int $ttlSeconds): void
    {
        if (!is_dir($this->cacheDirectory)) {
            mkdir($this->cacheDirectory, 0777, true);
        }

        file_put_contents(
            $this->pathFor($key),
            json_encode(
                ['expiresAt' => time() + $ttlSeconds, 'value' => $value],
                JSON_THROW_ON_ERROR,
            ),
        );
    }

    public function clear(): void
    {
        foreach (glob(rtrim($this->cacheDirectory, '/\\') . DIRECTORY_SEPARATOR . '*.json') ?: [] as $path) {
            if (is_file($path) && preg_match('/^[a-f0-9]{40}\.json$/', basename($path)) === 1) {
                @unlink($path);
            }
        }
    }

    private function pathFor(string $key): string
    {
        return rtrim($this->cacheDirectory, '/\\') . DIRECTORY_SEPARATOR . sha1($key) . '.json';
    }
}
