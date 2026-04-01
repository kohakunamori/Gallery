<?php

declare(strict_types=1);

use Gallery\Action\GetAlbumsAction;
use Gallery\Action\GetPhotosAction;
use Gallery\Service\AlbumIndexService;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoScanner;
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
): \Slim\App {
    $app = AppFactory::create();
    $scanner = new PhotoScanner();
    $metadataReader = new PhotoMetadataReader();

    $photoIndexService = new PhotoIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
        $cache ?? new NullPhotoCache(),
        15,
        $localMediaBaseUrl,
    );

    $albumIndexService = new AlbumIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
        $localMediaBaseUrl,
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

    $app->get('/api/photos', new GetPhotosAction($photoIndexService));
    $app->get('/api/albums', new GetAlbumsAction($albumIndexService));

    $app->get('/media/{path:.*}', static function (Request $request, Response $response, array $args) use ($photosDirectory): Response {
        $relativePath = trim((string) ($args['path'] ?? ''), '/');

        if ($relativePath === '' || str_contains($relativePath, '..')) {
            return $response->withStatus(404);
        }

        $path = rtrim($photosDirectory, '/\\') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        if (!is_file($path) || !is_readable($path)) {
            return $response->withStatus(404);
        }

        $mimeType = mime_content_type($path) ?: 'application/octet-stream';
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
            ->withHeader('Content-Length', (string) filesize($path));
    });

    return $app;
}
