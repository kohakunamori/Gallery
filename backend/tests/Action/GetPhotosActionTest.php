<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class GetPhotosActionTest extends TestCase
{
    public function test_it_returns_an_empty_items_list_for_an_empty_directory(): void
    {
        $emptyDirectory = sys_get_temp_dir() . '/gallery-empty-' . bin2hex(random_bytes(4));
        mkdir($emptyDirectory, 0777, true);

        $app = createApp($emptyDirectory, '/media');
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
    }

    public function testReturnsConfiguredMediaBaseUrl(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $cacheDir = sys_get_temp_dir() . '/gallery-configured-media-' . bin2hex(random_bytes(4));
        mkdir($cacheDir, 0777, true);

        $app = createApp(
            $photosDir,
            'https://img.example.com',
            new \Gallery\Service\FilePhotoCache($cacheDir),
            true,
            '/media',
        );

        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest('GET', '/api/photos');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['url']);
        self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['thumbnailUrl']);
        self::assertStringContainsString('?v=', $payload['items'][0]['url']);
        self::assertStringContainsString('?v=', $payload['items'][0]['thumbnailUrl']);
    }

    public function testReturnsLocalMediaUrlsWhenRequested(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $cacheDir = sys_get_temp_dir() . '/gallery-local-media-' . bin2hex(random_bytes(4));
        mkdir($cacheDir, 0777, true);

        $app = createApp(
            $photosDir,
            'https://img.example.com',
            new \Gallery\Service\FilePhotoCache($cacheDir),
            true,
            '/media',
        );

        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())
            ->createServerRequest('GET', '/api/photos?mediaSource=local');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertStringStartsWith('/media/', $payload['items'][0]['url']);
        self::assertStringStartsWith('/media/', $payload['items'][0]['thumbnailUrl']);
        self::assertStringContainsString('?v=', $payload['items'][0]['url']);
        self::assertStringContainsString('?v=', $payload['items'][0]['thumbnailUrl']);
    }

    public function testRejectsQiniuMediaSourceWhenUnavailable(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $app = createApp($photosDir, 'https://img.example.com', null, true, '/media');

        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())
            ->createServerRequest('GET', '/api/photos?mediaSource=qiniu');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(409, $response->getStatusCode());
        self::assertSame(['error' => 'Media source unavailable', 'mediaSource' => 'qiniu'], $payload);
    }

    public function testRejectsInvalidMediaSource(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $app = createApp($photosDir, 'https://img.example.com', null, true, '/media');

        $request = (new \Slim\Psr7\Factory\ServerRequestFactory())
            ->createServerRequest('GET', '/api/photos?mediaSource=bad');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['error' => 'Invalid mediaSource'], $payload);
    }

    public function testItIndexesAvifFilesInThePhotosApi(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-avif-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);

        $file = $directory . '/travel/lossless.avif';
        file_put_contents($file, 'fake-avif-body');
        $modifiedAt = strtotime('2026-03-31 12:00:00 UTC');
        touch($file, $modifiedAt);

        $app = createApp($directory, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/photos');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $version = sha1('travel/lossless.avif|' . (string) $modifiedAt);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('lossless.avif', $payload['items'][0]['filename']);
        self::assertSame('/media/travel/lossless.avif?v=' . $version, $payload['items'][0]['url']);
        self::assertSame('/media/travel/lossless.avif?v=' . $version, $payload['items'][0]['thumbnailUrl']);
        self::assertSame(null, $payload['items'][0]['width']);
        self::assertSame(null, $payload['items'][0]['height']);
        self::assertSame('2026-03-31T12:00:00+00:00', $payload['items'][0]['sortTime']);
    }

    public function testMediaRouteFallsBackToAvifMimeType(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $contents = 'fake-avif-body';
        $file = $directory . '/pixel.avif';
        file_put_contents($file, $contents);
        $modifiedAt = strtotime('2026-03-31 12:00:00 UTC');
        touch($file, $modifiedAt);

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/media/pixel.avif');
        $response = $app->handle($request);
        $etag = sprintf('"%x-%x"', $modifiedAt, filesize($file));

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('public, max-age=315360000, immutable', $response->getHeaderLine('Cache-Control'));
        self::assertSame($etag, $response->getHeaderLine('ETag'));
        self::assertSame('Tue, 31 Mar 2026 12:00:00 GMT', $response->getHeaderLine('Last-Modified'));
        self::assertSame('image/avif', $response->getHeaderLine('Content-Type'));
        self::assertSame((string) filesize($file), $response->getHeaderLine('Content-Length'));
        self::assertSame($contents, (string) $response->getBody());
    }

    public function testMediaRouteReturnsCacheHeadersForOriginalFiles(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $contents = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnB8AAAAASUVORK5CYII=',
            true,
        );
        self::assertNotFalse($contents);

        $file = $directory . '/pixel.png';
        file_put_contents($file, $contents);
        $modifiedAt = strtotime('2026-03-31 12:00:00 UTC');
        touch($file, $modifiedAt);

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/media/pixel.png');
        $response = $app->handle($request);
        $etag = sprintf('"%x-%x"', $modifiedAt, filesize($file));

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('public, max-age=315360000, immutable', $response->getHeaderLine('Cache-Control'));
        self::assertSame($etag, $response->getHeaderLine('ETag'));
        self::assertSame('Tue, 31 Mar 2026 12:00:00 GMT', $response->getHeaderLine('Last-Modified'));
        self::assertSame('image/png', $response->getHeaderLine('Content-Type'));
        self::assertSame((string) filesize($file), $response->getHeaderLine('Content-Length'));
        self::assertSame($contents, (string) $response->getBody());
    }

    public function testMediaRouteRejectsTraversalPaths(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);
        file_put_contents($directory . '/pixel.png', 'not used');

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $response = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/media/../pixel.png'));

        self::assertSame(404, $response->getStatusCode());

        unlink($directory . '/pixel.png');
        rmdir($directory);
    }

    public function testMediaRouteRejectsSymlinkEscapes(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        $outsideDirectory = sys_get_temp_dir() . '/gallery-media-outside-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);
        mkdir($outsideDirectory, 0777, true);
        file_put_contents($outsideDirectory . '/secret.png', 'secret');

        if (!@symlink($outsideDirectory . '/secret.png', $directory . '/escape.png')) {
            $this->markTestSkipped('Symlinks are unavailable on this filesystem.');
        }

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $response = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/media/escape.png'));

        self::assertSame(404, $response->getStatusCode());

        unlink($directory . '/escape.png');
        unlink($outsideDirectory . '/secret.png');
        rmdir($directory);
        rmdir($outsideDirectory);
    }

    public function testReturnsMediaSourceStatusesIncludingDisabledUnconfiguredQiniu(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $app = createApp($photosDir, 'https://img.example.com', null, true, '/media');

        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/media-sources');
        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('application/json', $response->getHeaderLine('Content-Type'));
        self::assertSame('public, max-age=15, stale-while-revalidate=60', $response->getHeaderLine('Cache-Control'));
        self::assertNotSame('', $response->getHeaderLine('ETag'));
        self::assertSame('r2', $payload['items'][0]['source']);
        self::assertSame('qiniu', $payload['items'][1]['source']);
        self::assertFalse($payload['items'][1]['isAvailable']);
        self::assertTrue($payload['items'][1]['isDisabled']);
        self::assertSame('unconfigured', $payload['items'][1]['status']);
        self::assertSame('Qiniu media source is not configured.', $payload['items'][1]['message']);
        self::assertSame('local', $payload['items'][2]['source']);
    }

    public function testPhotosApiReturnsNotModifiedWhenTheEtagMatches(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $app = createApp($photosDir, 'https://img.example.com', null, true, '/media');

        $initialResponse = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/api/photos'));
        $etag = $initialResponse->getHeaderLine('ETag');

        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/api/photos')
            ->withHeader('If-None-Match', $etag);
        $response = $app->handle($request);

        self::assertSame(304, $response->getStatusCode());
        self::assertSame('public, max-age=15, stale-while-revalidate=60', $response->getHeaderLine('Cache-Control'));
        self::assertSame($etag, $response->getHeaderLine('ETag'));
        self::assertSame('', (string) $response->getBody());
    }

    public function testMediaSourceStatusApiReturnsNotModifiedWhenTheEtagMatches(): void
    {
        $photosDir = dirname(__DIR__, 3) . '/storage/photos';
        $app = createApp($photosDir, 'https://img.example.com', null, true, '/media');

        $initialResponse = $app->handle((new ServerRequestFactory())->createServerRequest('GET', '/api/media-sources'));
        $etag = $initialResponse->getHeaderLine('ETag');

        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/api/media-sources')
            ->withHeader('If-None-Match', $etag);
        $response = $app->handle($request);

        self::assertSame(304, $response->getStatusCode());
        self::assertSame('public, max-age=15, stale-while-revalidate=60', $response->getHeaderLine('Cache-Control'));
        self::assertSame($etag, $response->getHeaderLine('ETag'));
        self::assertSame('', (string) $response->getBody());
    }

    public function testMediaRouteReturnsNotModifiedWhenTheEtagMatches(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $contents = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnB8AAAAASUVORK5CYII=',
            true,
        );
        self::assertNotFalse($contents);

        $file = $directory . '/pixel.png';
        file_put_contents($file, $contents);
        $modifiedAt = strtotime('2026-03-31 12:00:00 UTC');
        touch($file, $modifiedAt);

        $etag = sprintf('"%x-%x"', $modifiedAt, filesize($file));
        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/media/pixel.png')
            ->withHeader('If-None-Match', $etag);
        $response = $app->handle($request);

        self::assertSame(304, $response->getStatusCode());
        self::assertSame('public, max-age=315360000, immutable', $response->getHeaderLine('Cache-Control'));
        self::assertSame($etag, $response->getHeaderLine('ETag'));
        self::assertSame('', (string) $response->getBody());
    }

    public function testMediaRouteReturnsNotModifiedWhenIfModifiedSinceMatches(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-media-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $contents = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnB8AAAAASUVORK5CYII=',
            true,
        );
        self::assertNotFalse($contents);

        $file = $directory . '/pixel.png';
        file_put_contents($file, $contents);
        $modifiedAt = strtotime('2026-03-31 12:00:00 UTC');
        touch($file, $modifiedAt);

        $app = createApp($directory, 'https://img.example.com', null, true, '/media');
        $request = (new ServerRequestFactory())
            ->createServerRequest('GET', '/media/pixel.png')
            ->withHeader('If-Modified-Since', 'Tue, 31 Mar 2026 12:00:00 GMT');
        $response = $app->handle($request);

        self::assertSame(304, $response->getStatusCode());
        self::assertSame('public, max-age=315360000, immutable', $response->getHeaderLine('Cache-Control'));
        self::assertSame('Tue, 31 Mar 2026 12:00:00 GMT', $response->getHeaderLine('Last-Modified'));
        self::assertSame('', (string) $response->getBody());
    }
}
