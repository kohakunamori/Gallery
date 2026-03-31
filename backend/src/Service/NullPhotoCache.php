<?php

declare(strict_types=1);

namespace Gallery\Service;

final class NullPhotoCache implements PhotoCacheInterface
{
    public function get(string $key): ?array
    {
        return null;
    }

    public function put(string $key, array $value, int $ttlSeconds): void
    {
    }
}
