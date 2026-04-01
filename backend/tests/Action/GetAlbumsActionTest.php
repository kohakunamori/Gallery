<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Psr7\Factory\ServerRequestFactory;

final class GetAlbumsActionTest extends TestCase
{
    public function test_it_returns_an_album_payload_with_the_expected_contract(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);
        file_put_contents($directory . '/travel/cover.jpg', 'jpg');
        touch($directory . '/travel/cover.jpg', strtotime('2026-03-31 09:00:00 UTC'));

        $app = createApp($directory, 'https://img.example.com', null, false, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums');
        $response = $app->handle($request);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            [
                'items' => [
                    [
                        'id' => 'travel',
                        'name' => 'travel',
                        'coverUrl' => 'https://img.example.com/travel/cover.jpg',
                        'photoCount' => 1,
                        'latestSortTime' => '2026-03-31T09:00:00+00:00',
                    ],
                ],
            ],
            $payload,
        );
    }

    public function test_it_returns_local_album_cover_urls_when_requested(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);
        file_put_contents($directory . '/travel/cover.jpg', 'jpg');
        touch($directory . '/travel/cover.jpg', strtotime('2026-03-31 09:00:00 UTC'));

        $app = createApp($directory, 'https://img.example.com', null, false, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums?mediaSource=local');
        $response = $app->handle($request);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame('/media/travel/cover.jpg', $payload['items'][0]['coverUrl']);
    }

    public function test_it_rejects_invalid_media_source(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums?mediaSource=bad');
        $response = $app->handle($request);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(
            ['error' => 'Invalid mediaSource'],
            json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR),
        );
    }

    public function test_it_returns_a_generic_json_500_payload_when_error_details_are_disabled(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $app = createApp($directory, '/media', null, false);
        $app->get('/boom', static function (Request $request, Response $response): never {
            throw new \RuntimeException('Sensitive failure details');
        });

        $request = (new ServerRequestFactory())->createServerRequest('GET', '/boom');
        $response = $app->handle($request);

        self::assertSame(500, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        self::assertSame(
            ['error' => 'Internal Server Error'],
            json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR),
        );
    }
}
