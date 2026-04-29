<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\MediaSourceAvailabilityService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class GetMediaSourceStatusAction
{
    public function __construct(
        private readonly MediaSourceAvailabilityService $mediaSourceAvailabilityService,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $response->getBody()->write(
            json_encode(['items' => $this->mediaSourceAvailabilityService->getAllSourceStatuses()], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
