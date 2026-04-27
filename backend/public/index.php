<?php

declare(strict_types=1);

use Gallery\Service\FilePhotoCache;

require __DIR__ . '/../vendor/autoload.php';

$config = require dirname(__DIR__) . '/config/app.php';
$qiniuConfig = $config['qiniu'];
$uploadConfig = $config['upload'];

$app = createApp(
    $config['photosDirectory'],
    $config['mediaBaseUrl'],
    new FilePhotoCache($config['cacheDirectory']),
    $config['displayErrorDetails'],
    $config['localMediaBaseUrl'],
    $qiniuConfig['mediaBaseUrl'],
    $qiniuConfig['accessKey'],
    $qiniuConfig['secretKey'],
    $qiniuConfig['bucket'],
    $qiniuConfig['domain'],
    null,
    null,
    $uploadConfig['scriptEnvFile'],
    $uploadConfig['temporaryDirectory'],
);

$app->run();
