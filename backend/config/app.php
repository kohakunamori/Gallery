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

$readPositiveIntEnv = static function (string $key, int $default) use ($readOptionalEnv): int {
    $value = $readOptionalEnv($key);

    if ($value === null || !ctype_digit($value) || (int) $value <= 0) {
        return $default;
    }

    return (int) $value;
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
        'accessToken' => $readOptionalEnv('UPLOAD_ACCESS_TOKEN'),
        'maxFiles' => $readPositiveIntEnv('UPLOAD_MAX_FILES', 20),
        'maxFileBytes' => $readPositiveIntEnv('UPLOAD_MAX_FILE_BYTES', 52428800),
        'maxTotalBytes' => $readPositiveIntEnv('UPLOAD_MAX_TOTAL_BYTES', 314572800),
        'scriptTimeoutSeconds' => $readPositiveIntEnv('UPLOAD_SCRIPT_TIMEOUT_SECONDS', 600),
        'scriptMaxOutputLines' => $readPositiveIntEnv('UPLOAD_SCRIPT_MAX_OUTPUT_LINES', 500),
        'scriptMaxOutputBytes' => $readPositiveIntEnv('UPLOAD_SCRIPT_MAX_OUTPUT_BYTES', 262144),
    ],
];
