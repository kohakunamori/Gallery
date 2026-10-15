<?php

declare(strict_types=1);

namespace Gallery\Http;

use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class JsonResponse
{
    public const DEFAULT_CACHE_CONTROL = 'private, max-age=60, stale-while-revalidate=300';

    /**
     * @param array<string, mixed> $payload
     */
    public static function write(
        Request $request,
        Response $response,
        array $payload,
        int $status = 200,
        string $cacheControl = self::DEFAULT_CACHE_CONTROL,
    ): Response {
        $json = json_encode($payload, JSON_THROW_ON_ERROR);
        $response = $response
            ->withStatus($status)
            ->withHeader('Content-Type', 'application/json')
            ->withHeader('Cache-Control', $cacheControl)
            ->withHeader('X-Content-Type-Options', 'nosniff');

        if ($status === 200) {
            $etag = 'W/"' . sha1($json) . '"';
            $response = $response->withHeader('ETag', $etag);

            if (self::requestEtagMatches($request, $etag)) {
                return $response->withStatus(304);
            }
        }

        $response->getBody()->write($json);

        return $response;
    }

    private static function requestEtagMatches(Request $request, string $etag): bool
    {
        $ifNoneMatch = $request->getHeaderLine('If-None-Match');

        if ($ifNoneMatch === '') {
            return false;
        }

        foreach (array_map('trim', explode(',', $ifNoneMatch)) as $candidate) {
            if ($candidate === '*' || self::normalizeEtag($candidate) === self::normalizeEtag($etag)) {
                return true;
            }
        }

        return false;
    }

    private static function normalizeEtag(string $etag): string
    {
        return str_starts_with($etag, 'W/') ? substr($etag, 2) : $etag;
    }
}
