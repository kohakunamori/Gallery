<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoScannerInterface
{
    /**
     * @return list<array{absolutePath:string,relativePath:string}>
     */
    public function scan(string $directory): array;
}
