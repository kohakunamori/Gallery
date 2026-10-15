<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Http\JsonResponse;
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
            return JsonResponse::write($request, $response, ['error' => 'Invalid mediaSource'], 400, 'no-store');
        }

        if (!$this->mediaSourceAvailabilityService->isAvailable($mediaSource)) {
            return JsonResponse::write(
                $request,
                $response,
                ['error' => 'Media source unavailable', 'mediaSource' => $mediaSource],
                409,
                'no-store',
            );
        }

        return JsonResponse::write($request, $response, ['items' => $this->photoIndexService->all($mediaSource)]);
    }
}
