<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use Gallery\Service\FilePhotoCache;
use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class GetPhotosActionTest extends TestCase
{
    public function test_it_returns_an_empty_items_list_for_an_empty_catalog(): void
    {
        $catalogPath = $this->writeCatalog([]);

        $app = createApp($catalogPath, 'https://img.example.com');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/photos');
        $response = $app->handle($request);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        self::assertSame('public, max-age=15, stale-while-revalidate=60', $response->getHeaderLine('Cache-Control'));
        self::assertNotSame('', $response->getHeaderLine('ETag'));
        self::assertSame(
            ['items' => []],
            json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR),
        );

        @unlink($catalogPath);
    }

    public function testReturnsConfiguredMediaBaseUrl(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.png',
                'filename' => 'cover.png',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 319,
                'height' => 512,
                'size' => 100,
                'version' => 'cover-version',
            ],
        ]);
        $cacheDir = sys_get_temp_dir() . '/gallery-configured-media-' . bin2hex(random_bytes(4));
        mkdir($cacheDir, 0777, true);

        $app = createApp(
            $catalogPath,
            'https://img.example.com',
            new FilePhotoCache($cacheDir),
            true,
        );

        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/photos');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['url']);
        self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['thumbnailUrl']);
        self::assertStringContainsString('?v=', $payload['items'][0]['url']);
        self::assertStringContainsString('?v=', $payload['items'][0]['thumbnailUrl']);

        @unlink($catalogPath);
        $this->removeDirectory($cacheDir);
    }

    public function testIgnoresStaleMediaSourceQueryParam(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.png',
                'filename' => 'cover.png',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 319,
                'height' => 512,
                'size' => 100,
                'version' => 'cover-version',
            ],
        ]);

        $app = createApp($catalogPath, 'https://img.example.com', null, true);
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/api/photos?mediaSource=qiniu');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['url']);
        self::assertArrayNotHasKey('error', $payload);

        @unlink($catalogPath);
    }

    public function testReturnsNotModifiedWhenEtagMatches(): void
    {
        $catalogPath = $this->writeCatalog([
            [
                'path' => 'travel/cover.png',
                'filename' => 'cover.png',
                'takenAt' => null,
                'sortTime' => '2026-03-31T09:00:00+00:00',
                'width' => 319,
                'height' => 512,
                'size' => 100,
                'version' => 'cover-version',
            ],
        ]);

        $app = createApp($catalogPath, 'https://img.example.com');
        $first = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/api/photos'));
        $etag = $first->getHeaderLine('ETag');

        $second = $app->handle(
            (new ServerRequestFactory())
                ->createServerRequest('GET', '/api/photos')
                ->withHeader('If-None-Match', $etag),
        );

        self::assertSame(200, $first->getStatusCode());
        self::assertSame(304, $second->getStatusCode());
        self::assertSame($etag, $second->getHeaderLine('ETag'));
        self::assertSame('public, max-age=15, stale-while-revalidate=60', $second->getHeaderLine('Cache-Control'));

        @unlink($catalogPath);
    }

    /**
     * @param list<array{path:string,filename:string,takenAt:?string,sortTime:string,width:?int,height:?int,size:int,version:string}> $items
     */
    private function writeCatalog(array $items): string
    {
        $path = sys_get_temp_dir() . '/gallery-photos-action-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents($path, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => $items,
        ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT));

        return $path;
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        foreach (scandir($directory) ?: [] as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $item;
            is_dir($path) ? $this->removeDirectory($path) : @unlink($path);
        }

        @rmdir($directory);
    }
}
