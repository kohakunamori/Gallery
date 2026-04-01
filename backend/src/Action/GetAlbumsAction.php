<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\AlbumIndexService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class GetAlbumsAction
{
    public function __construct(
        private readonly AlbumIndexService $albumIndexService,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $mediaSource = (string) ($request->getQueryParams()['mediaSource'] ?? 'r2');

        if ($mediaSource !== 'r2' && $mediaSource !== 'local') {
            $response->getBody()->write(
                json_encode(['error' => 'Invalid mediaSource'], JSON_THROW_ON_ERROR),
            );

            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        $response->getBody()->write(
            json_encode(['items' => $this->albumIndexService->all($mediaSource)], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
