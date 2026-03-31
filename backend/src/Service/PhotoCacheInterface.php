<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoCacheInterface
{
    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>|null
     */
    public function get(string $key): ?array;

    /**
     * @param list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}> $value
     */
    public function put(string $key, array $value, int $ttlSeconds): void;
}
