<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Http\JsonResponse;
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
        return JsonResponse::write($request, $response, [
            'items' => $this->mediaSourceAvailabilityService->getAllSourceStatuses(),
        ]);
    }
}
