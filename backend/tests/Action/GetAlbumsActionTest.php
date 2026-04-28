<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use PHPUnit\Framework\TestCase;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
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

    public function test_it_rejects_qiniu_media_source_when_unavailable(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums?mediaSource=qiniu');
        $response = $app->handle($request);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame(
            ['error' => 'Media source unavailable', 'mediaSource' => 'qiniu'],
            json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR),
        );
    }

    public function test_it_serves_local_upload_media_with_supported_image_mime_fallbacks(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory . '/uploads', 0777, true);
        file_put_contents($directory . '/uploads/original.heic', 'heic');
        file_put_contents($directory . '/uploads/vector.svg', '<svg></svg>');

        $app = createApp($directory, '/media', null, false);

        $heicResponse = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/media/uploads/original.heic'));
        $svgResponse = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/media/uploads/vector.svg'));

        self::assertSame(200, $heicResponse->getStatusCode());
        self::assertSame('image/heic', $heicResponse->getHeaderLine('Content-Type'));
        self::assertSame(200, $svgResponse->getStatusCode());
        self::assertSame('image/svg+xml', $svgResponse->getHeaderLine('Content-Type'));

        unset($heicResponse, $svgResponse);
        $this->removeDirectory($directory);
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

    private function removeDirectory(string $directory): void
    {
        if (!file_exists($directory)) {
            return;
        }

        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($directory, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::CHILD_FIRST,
        );

        foreach ($iterator as $item) {
            if ($item->isDir() && !$item->isLink()) {
                rmdir($item->getPathname());

                continue;
            }

            unlink($item->getPathname());
        }

        rmdir($directory);
    }
}
