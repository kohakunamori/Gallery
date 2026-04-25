<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\MediaSourceAvailabilityService;
use Gallery\Service\PhotoIndexService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class GetPhotosAction
{
    public function __construct(
        private readonly PhotoIndexService $photoIndexService,
        private readonly MediaSourceAvailabilityService $mediaSourceAvailabilityService,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $mediaSource = (string) ($request->getQueryParams()['mediaSource'] ?? 'r2');

        if (!$this->mediaSourceAvailabilityService->isSupported($mediaSource)) {
            $response->getBody()->write(
                json_encode(['error' => 'Invalid mediaSource'], JSON_THROW_ON_ERROR),
            );

            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        if (!$this->mediaSourceAvailabilityService->isAvailable($mediaSource)) {
            $response->getBody()->write(
                json_encode(['error' => 'Media source unavailable', 'mediaSource' => $mediaSource], JSON_THROW_ON_ERROR),
            );

            return $response
                ->withStatus(409)
                ->withHeader('Content-Type', 'application/json');
        }

        $response->getBody()->write(
            json_encode(['items' => $this->photoIndexService->all($mediaSource)], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
