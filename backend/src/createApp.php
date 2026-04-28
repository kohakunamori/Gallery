<?php

declare(strict_types=1);

use Gallery\Action\GetAlbumsAction;
use Gallery\Action\GetMediaSourceStatusAction;
use Gallery\Action\GetPhotosAction;
use Gallery\Action\UploadPhotosAction;
use Gallery\Service\AlbumIndexService;
use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoScanner;
use Gallery\Service\PhotoUploadService;
use Gallery\Service\QiniuUsageService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ResponseFactory;
use Slim\Psr7\Stream;

function createApp(
    string $photosDirectory,
    string $mediaBaseUrl = '/media',
    ?PhotoCacheInterface $cache = null,
    bool $displayErrorDetails = false,
    string $localMediaBaseUrl = '/media',
    ?string $qiniuMediaBaseUrl = null,
    ?string $qiniuAccessKey = null,
    ?string $qiniuSecretKey = null,
    ?string $qiniuBucket = null,
    ?string $qiniuDomain = null,
    ?string $uploadScriptPath = null,
    ?string $uploadPythonBinary = null,
    ?string $uploadScriptEnvFile = null,
    ?string $uploadTemporaryDirectory = null,
    ?string $uploadAccessToken = null,
    int $uploadMaxFiles = 20,
    int $uploadMaxFileBytes = 52428800,
    int $uploadMaxTotalBytes = 314572800,
    int $uploadScriptTimeoutSeconds = 600,
    int $uploadScriptMaxOutputLines = 500,
    int $uploadScriptMaxOutputBytes = 262144,
): \Slim\App {
    $app = AppFactory::create();
    $photoCache = $cache ?? new NullPhotoCache();
    $scanner = new PhotoScanner();
    $metadataReader = new PhotoMetadataReader();
    $mediaBaseUrls = [
        'r2' => $mediaBaseUrl,
        'qiniu' => $qiniuMediaBaseUrl ?? '',
        'local' => $localMediaBaseUrl,
    ];
    $qiniuUsageService = null;

    if (
        $qiniuAccessKey !== null
        && $qiniuSecretKey !== null
        && $qiniuBucket !== null
        && $qiniuMediaBaseUrl !== null
        && $qiniuMediaBaseUrl !== ''
    ) {
        $cacheDirectory = dirname(__DIR__) . '/var/cache';
        $qiniuUsageService = new QiniuUsageService(
            $qiniuAccessKey,
            $qiniuSecretKey,
            $qiniuBucket,
            $qiniuDomain,
            'api.qiniuapi.com',
            rtrim($cacheDirectory, '/\\') . DIRECTORY_SEPARATOR . 'qiniu-usage.json',
        );
    }

    $mediaSourceAvailabilityService = new MediaSourceAvailabilityService($mediaBaseUrls, $qiniuUsageService);

    $photoIndexService = new PhotoIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
        $photoCache,
        15,
        $localMediaBaseUrl,
        $mediaSourceAvailabilityService,
    );

    $albumIndexService = new AlbumIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
        $localMediaBaseUrl,
        $mediaSourceAvailabilityService,
    );

    $app->addRoutingMiddleware();
    $errorMiddleware = $app->addErrorMiddleware($displayErrorDetails, true, true);
    $errorMiddleware->setDefaultErrorHandler(
        static function (Request $request, Throwable $exception, bool $displayErrorDetails) {
            $response = (new ResponseFactory())->createResponse(500);
            $response->getBody()->write(
                json_encode([
                    'error' => $displayErrorDetails ? $exception->getMessage() : 'Internal Server Error',
                ], JSON_THROW_ON_ERROR),
            );

            return $response->withHeader('Content-Type', 'application/json');
        },
    );

    $app->get('/health', static function (Request $request, Response $response): Response {
        $response->getBody()->write('ok');

        return $response;
    });

    $app->get('/api/photos', new GetPhotosAction($photoIndexService, $mediaSourceAvailabilityService));
    $app->get('/api/albums', new GetAlbumsAction($albumIndexService, $mediaSourceAvailabilityService));
    $app->get('/api/media-sources', new GetMediaSourceStatusAction($mediaSourceAvailabilityService));
    $app->post('/upload', new UploadPhotosAction(
        new PhotoUploadService(
            $photosDirectory,
            $uploadScriptPath ?? dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'script' . DIRECTORY_SEPARATOR . 'upload_r2.py',
            $uploadPythonBinary,
            $uploadScriptEnvFile,
            $uploadTemporaryDirectory,
            $uploadMaxFiles,
            $uploadMaxFileBytes,
            $uploadMaxTotalBytes,
            $uploadScriptTimeoutSeconds,
            $uploadScriptMaxOutputLines,
            $uploadScriptMaxOutputBytes,
        ),
        $photoCache,
        $uploadAccessToken,
    ));

    $app->get('/media/{path:.*}', static function (Request $request, Response $response, array $args) use ($photosDirectory): Response {
        $relativePath = trim((string) ($args['path'] ?? ''), '/');

        if ($relativePath === '' || str_contains($relativePath, "\0")) {
            return $response->withStatus(404);
        }

        $photosRoot = realpath($photosDirectory);

        if ($photosRoot === false) {
            return $response->withStatus(404);
        }

        $path = rtrim($photosRoot, '/\\') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
        $realPath = realpath($path);

        if ($realPath === false || !is_file($realPath) || !is_readable($realPath)) {
            return $response->withStatus(404);
        }

        $normalizedRoot = str_replace('\\', '/', rtrim($photosRoot, '/\\')) . '/';
        $normalizedPath = str_replace('\\', '/', $realPath);

        if (PHP_OS_FAMILY === 'Windows') {
            $normalizedRoot = strtolower($normalizedRoot);
            $normalizedPath = strtolower($normalizedPath);
        }

        if (!str_starts_with($normalizedPath, $normalizedRoot)) {
            return $response->withStatus(404);
        }

        $modifiedAt = @filemtime($realPath);
        $size = @filesize($realPath);

        if ($modifiedAt === false || $size === false) {
            return $response->withStatus(404);
        }

        $etag = sprintf('"%x-%x"', $modifiedAt, $size);
        $lastModified = gmdate('D, d M Y H:i:s', $modifiedAt) . ' GMT';
        $response = $response
            ->withHeader('Cache-Control', 'public, max-age=315360000, immutable')
            ->withHeader('ETag', $etag)
            ->withHeader('Last-Modified', $lastModified)
            ->withHeader('X-Content-Type-Options', 'nosniff');

        if ($request->getHeaderLine('If-None-Match') === $etag) {
            return $response->withStatus(304);
        }

        $ifModifiedSince = $request->getHeaderLine('If-Modified-Since');
        $ifModifiedSinceTime = $ifModifiedSince === '' ? false : strtotime($ifModifiedSince);

        if ($ifModifiedSinceTime !== false && $ifModifiedSinceTime >= $modifiedAt) {
            return $response->withStatus(304);
        }

        $mimeType = function_exists('mime_content_type') ? (mime_content_type($realPath) ?: '') : '';
        $extension = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));

        if ($extension === 'avif' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/avif';
        } elseif ($extension === 'heic' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/heic';
        } elseif ($extension === 'svg' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/svg+xml';
        } elseif ($extension === 'png' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/png';
        } elseif (in_array($extension, ['jpg', 'jpeg'], true) && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/jpeg';
        } elseif ($extension === 'webp' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/webp';
        }

        if ($mimeType === '') {
            $mimeType = 'application/octet-stream';
        }

        $stream = fopen($realPath, 'rb');

        if ($stream === false) {
            return $response->withStatus(404);
        }

        $response = $response
            ->withBody(new Stream($stream))
            ->withHeader('Content-Type', $mimeType)
            ->withHeader('Content-Length', (string) $size);

        if ($extension === 'svg') {
            $response = $response->withHeader('Content-Security-Policy', "default-src 'none'; script-src 'none'; sandbox");
        }

        return $response;
    });

    return $app;
}
