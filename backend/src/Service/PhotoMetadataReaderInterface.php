<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoMetadataReaderInterface
{
    /**
     * @return array{takenAt:?string,width:?int,height:?int}
     */
    public function read(string $path): array;
}
