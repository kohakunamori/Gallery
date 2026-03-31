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
        self::assertSame(
            ['items' => []],
            json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR),
        );
    }
}
