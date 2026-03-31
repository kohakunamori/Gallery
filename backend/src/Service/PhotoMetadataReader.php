<?php

declare(strict_types=1);

namespace Gallery\Service;

use Closure;
use DateTimeImmutable;
use DateTimeZone;

final class PhotoMetadataReader implements PhotoMetadataReaderInterface
{
    public function __construct(
        private readonly ?Closure $readExif = null,
    ) {
    }

    /**
     * @return array{takenAt:?string,width:?int,height:?int}
     */
    public function read(string $path): array
    {
        $dimensions = @getimagesize($path) ?: [null, null];
        [$width, $height] = $dimensions;

        return [
            'takenAt' => $this->readTakenAt($path),
            'width' => is_int($width) ? $width : null,
            'height' => is_int($height) ? $height : null,
        ];
    }

    private function readTakenAt(string $path): ?string
    {
        $exif = null;

        if ($this->readExif instanceof Closure) {
            $exif = ($this->readExif)($path);
        } elseif (function_exists('exif_read_data')) {
            $exif = @exif_read_data($path, 'EXIF', true);
        }

        if (!is_array($exif)) {
            return null;
        }

        $rawValue = $exif['EXIF']['DateTimeOriginal'] ?? $exif['EXIF']['DateTimeDigitized'] ?? null;

        if (!is_string($rawValue)) {
            return null;
        }

        $parsed = DateTimeImmutable::createFromFormat('Y:m:d H:i:s', $rawValue, new DateTimeZone('UTC'));

        return $parsed?->format(DATE_ATOM);
    }
}
