<?php

declare(strict_types=1);

use Gallery\Service\FilePhotoCache;

require __DIR__ . '/../vendor/autoload.php';

$config = require dirname(__DIR__) . '/config/app.php';
$uploadConfig = $config['upload'];

$uploadPythonBinary = $_ENV['UPLOAD_PYTHON_BINARY'] ?? getenv('UPLOAD_PYTHON_BINARY') ?: null;
if (is_string($uploadPythonBinary)) {
    $uploadPythonBinary = trim($uploadPythonBinary);
    if ($uploadPythonBinary === '') {
        $uploadPythonBinary = null;
    }
}

$app = createApp(
    $config['catalogPath'],
    $config['mediaBaseUrl'],
    new FilePhotoCache($config['cacheDirectory']),
    $config['displayErrorDetails'],
    null,
    $uploadPythonBinary,
    $uploadConfig['scriptEnvFile'],
    $uploadConfig['temporaryDirectory'],
    $uploadConfig['accessToken'],
    $uploadConfig['maxFiles'],
    $uploadConfig['maxFileBytes'],
    $uploadConfig['maxTotalBytes'],
    $uploadConfig['scriptTimeoutSeconds'],
    $uploadConfig['scriptMaxOutputLines'],
    $uploadConfig['scriptMaxOutputBytes'],
);

$app->run();
