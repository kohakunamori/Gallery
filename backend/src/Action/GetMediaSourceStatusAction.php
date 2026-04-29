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
        $payload = json_encode(['items' => $this->mediaSourceAvailabilityService->getAllSourceStatuses()], JSON_THROW_ON_ERROR);
        $etag = '"' . sha1($payload) . '"';
        $requestEtags = array_map('trim', explode(',', $request->getHeaderLine('If-None-Match')));

        if (in_array($etag, $requestEtags, true)) {
            return $response
                ->withStatus(304)
                ->withHeader('Content-Type', 'application/json')
                ->withHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
                ->withHeader('ETag', $etag);
        }

        $response->getBody()->write($payload);

        return $response
            ->withHeader('Content-Type', 'application/json')
            ->withHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=60')
            ->withHeader('ETag', $etag);
    }
}
