<?php

declare(strict_types=1);

use Gallery\Action\GetAlbumsAction;
use Gallery\Action\GetMediaSourceStatusAction;
use Gallery\Action\GetPhotosAction;
use Gallery\Service\AlbumIndexService;
use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoScanner;
use Gallery\Service\QiniuUsageService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ResponseFactory;

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
): \Slim\App {
    $app = AppFactory::create();
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
        $cache ?? new NullPhotoCache(),
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

    $app->get('/media/{path:.*}', static function (Request $request, Response $response, array $args) use ($photosDirectory): Response {
        $relativePath = trim((string) ($args['path'] ?? ''), '/');

        if ($relativePath === '' || str_contains($relativePath, '..')) {
            return $response->withStatus(404);
        }

        $path = rtrim($photosDirectory, '/\\') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        if (!is_file($path) || !is_readable($path)) {
            return $response->withStatus(404);
        }

        $modifiedAt = @filemtime($path);
        $size = @filesize($path);

        if ($modifiedAt === false || $size === false) {
            return $response->withStatus(404);
        }

        $etag = sprintf('"%x-%x"', $modifiedAt, $size);
        $lastModified = gmdate('D, d M Y H:i:s', $modifiedAt) . ' GMT';
        $response = $response
            ->withHeader('Cache-Control', 'public, max-age=315360000, immutable')
            ->withHeader('ETag', $etag)
            ->withHeader('Last-Modified', $lastModified);

        if ($request->getHeaderLine('If-None-Match') === $etag) {
            return $response->withStatus(304);
        }

        $ifModifiedSince = $request->getHeaderLine('If-Modified-Since');
        $ifModifiedSinceTime = $ifModifiedSince === '' ? false : strtotime($ifModifiedSince);

        if ($ifModifiedSinceTime !== false && $ifModifiedSinceTime >= $modifiedAt) {
            return $response->withStatus(304);
        }

        $mimeType = mime_content_type($path) ?: '';
        $extension = strtolower(pathinfo($path, PATHINFO_EXTENSION));

        if ($extension === 'avif' && !str_starts_with($mimeType, 'image/')) {
            $mimeType = 'image/avif';
        }

        if ($mimeType === '') {
            $mimeType = 'application/octet-stream';
        }
        $stream = fopen($path, 'rb');

        if ($stream === false) {
            return $response->withStatus(404);
        }

        $body = $response->getBody();
        while (!feof($stream)) {
            $chunk = fread($stream, 8192);
            if ($chunk === false) {
                break;
            }
            $body->write($chunk);
        }
        fclose($stream);

        return $response
            ->withHeader('Content-Type', $mimeType)
            ->withHeader('Content-Length', (string) $size);
    });

    return $app;
}
