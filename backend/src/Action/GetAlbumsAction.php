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
        $response->getBody()->write(
            json_encode(['items' => $this->albumIndexService->all()], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
