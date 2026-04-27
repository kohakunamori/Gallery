<?php

declare(strict_types=1);

use Dotenv\Dotenv;

$backendDirectory = dirname(__DIR__);
Dotenv::createImmutable($backendDirectory)->safeLoad();

$readOptionalEnv = static function (string $key): ?string {
    $value = $_ENV[$key] ?? null;

    if ($value === null) {
        return null;
    }

    $value = trim($value);

    return $value === '' ? null : $value;
};

return [
    'photosDirectory' => dirname($backendDirectory) . '/storage/photos',
    'mediaBaseUrl' => 'https://static.cf.nyaneko.cn/gallery',
    'cacheDirectory' => $backendDirectory . '/var/cache',
    'displayErrorDetails' => false,
    'localMediaBaseUrl' => '/media',
    'qiniu' => [
        'mediaBaseUrl' => $readOptionalEnv('QINIU_MEDIA_BASE_URL'),
        'accessKey' => $readOptionalEnv('QINIU_ACCESS_KEY'),
        'secretKey' => $readOptionalEnv('QINIU_SECRET_KEY'),
        'bucket' => $readOptionalEnv('QINIU_BUCKET'),
        'domain' => $readOptionalEnv('QINIU_DOMAIN'),
    ],
    'upload' => [
        'scriptEnvFile' => $readOptionalEnv('UPLOAD_SCRIPT_ENV_FILE'),
        'temporaryDirectory' => $readOptionalEnv('UPLOAD_TEMPORARY_DIRECTORY') ?? $backendDirectory . '/var/upload-batches',
    ],
];
