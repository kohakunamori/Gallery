<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class GetAlbumsActionTest extends TestCase
{
    public function test_it_returns_an_album_payload_with_the_expected_contract(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.jpg',
                'filename' => 'cover.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 10,
                'version' => 'cover',
            ],
        ]);

        $app = createApp($catalogPath, 'https://img.example.com');
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

        @unlink($catalogPath);
    }

    public function test_it_ignores_stale_media_source_query_param(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.jpg',
                'filename' => 'cover.jpg',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 1200,
                'height' => 800,
                'size' => 10,
                'version' => 'cover',
            ],
        ]);

        $app = createApp($catalogPath, 'https://img.example.com');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums?mediaSource=local');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('https://img.example.com/travel/cover.jpg', $payload['items'][0]['coverUrl']);
        self::assertArrayNotHasKey('error', $payload);

        @unlink($catalogPath);
    }

    /**
     * @param list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}> $items
     */
    private function writeCatalog(array $items): string
    {
        $path = sys_get_temp_dir() . '/gallery-albums-action-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents($path, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => $items,
        ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

        return $path;
    }
}
