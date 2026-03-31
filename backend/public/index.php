<?php

declare(strict_types=1);

use Gallery\Service\FilePhotoCache;

require __DIR__ . '/../vendor/autoload.php';

$mediaBaseUrl = getenv('GALLERY_MEDIA_BASE_URL');
if ($mediaBaseUrl === false || $mediaBaseUrl === '') {
    $mediaBaseUrl = '/media';
}

$app = createApp(
    dirname(__DIR__, 2) . '/storage/photos',
    $mediaBaseUrl,
    new FilePhotoCache(dirname(__DIR__) . '/var/cache'),
);

$app->run();
