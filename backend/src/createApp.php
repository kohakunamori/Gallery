<?php

declare(strict_types=1);

use Gallery\Action\GetAlbumsAction;
use Gallery\Action\GetPhotosAction;
use Gallery\Action\UploadPhotosAction;
use Gallery\Service\AlbumIndexService;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoCatalogService;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoUploadService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ResponseFactory;

function createApp(
    string $catalogPath,
    string $mediaBaseUrl = 'https://static.cf.nyaneko.cn/gallery',
    ?PhotoCacheInterface $cache = null,
    bool $displayErrorDetails = false,
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
    $catalog = new PhotoCatalogService($catalogPath);
    $metadataReader = new PhotoMetadataReader();

    $photoIndexService = new PhotoIndexService(
        $catalog,
        $mediaBaseUrl,
        $photoCache,
        15,
        $catalogPath,
    );

    $albumIndexService = new AlbumIndexService(
        $catalog,
        $mediaBaseUrl,
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
    $app->post('/upload', new UploadPhotosAction(
        new PhotoUploadService(
            $catalog,
            $metadataReader,
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

    return $app;
}
