# Gallery Redesign and Albums Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the gallery UI so Photos Timeline and Photo Viewer look much closer to the Stitch references, and add a real Albums page backed by folder-based aggregation from the filesystem.

**Architecture:** Keep the current PHP + Slim backend and React + Vite + Tailwind frontend, but evolve the backend scanner to understand first-level album folders and add a new `/api/albums` endpoint. On the frontend, replace the simplified MVP presentation with a stronger app shell, a Stitch-faithful timeline, a more immersive viewer overlay, and a real Albums page sharing the same navigation frame.

**Tech Stack:** PHP 8.2+ + Slim 4 + PHPUnit + React 19 + Vite + Tailwind CSS + Vitest + React Testing Library

---

## File Map

### Backend
- Modify: `backend/src/Service/PhotoScannerInterface.php` — broaden scanner contract from flat scan to structure-aware discovery
- Modify: `backend/src/Service/PhotoScanner.php` — return root images and first-level album folder images
- Create: `backend/src/Service/AlbumIndexService.php` — aggregate first-level folders into album summaries
- Create: `backend/src/Action/GetAlbumsAction.php` — `/api/albums` JSON endpoint
- Modify: `backend/src/createApp.php` — wire the new albums service and endpoint
- Create: `backend/tests/Service/AlbumIndexServiceTest.php` — album aggregation coverage
- Modify: `backend/tests/Service/PhotoScannerTest.php` — scanner structure-aware coverage
- Modify: `backend/tests/Service/PhotoIndexServiceTest.php` — timeline continues to include root and folder images
- Create: `backend/tests/Action/GetAlbumsActionTest.php` — endpoint contract tests

### Frontend layout and routing
- Create: `frontend/src/components/layout/AppShell.tsx` — shared shell for sidebar + topbar + page content
- Modify: `frontend/src/components/layout/Sidebar.tsx` — real route-aware active states for Photos and Albums
- Modify: `frontend/src/components/layout/Topbar.tsx` — stronger Stitch-like styling and route-sensitive title behavior
- Create: `frontend/src/components/layout/AppShell.test.tsx` — shell route-state coverage
- Create: `frontend/src/AppRouter.tsx` — lightweight route switch for Photos vs Albums
- Modify: `frontend/src/App.tsx` — switch from single page mount to app shell + router

### Frontend data layer
- Create: `frontend/src/types/album.ts` — album type definition
- Create: `frontend/src/services/albums.ts` — `/api/albums` client
- Create: `frontend/src/services/albums.test.ts` — album client coverage

### Frontend photos timeline redesign
- Modify: `frontend/src/pages/PhotosPage.tsx` — rebuild page structure around redesigned sections
- Modify: `frontend/src/components/timeline/TimelineSection.tsx` — editorial section layout
- Modify: `frontend/src/components/timeline/PhotoCard.tsx` — Stitch-like hover and mixed card presentation
- Create: `frontend/src/components/timeline/TimelineRail.tsx` — right-side time rail / month navigation treatment
- Modify: `frontend/src/pages/PhotosPage.test.tsx` — updated route and rendering coverage

### Frontend viewer redesign
- Modify: `frontend/src/components/viewer/PhotoViewerModal.tsx` — immersive full-screen overlay with top bar, side info, and action bar
- Create: `frontend/src/components/viewer/ViewerTopBar.tsx` — header controls and image identity block
- Create: `frontend/src/components/viewer/ViewerSidePanel.tsx` — metadata/info column
- Create: `frontend/src/components/viewer/ViewerActionBar.tsx` — floating bottom control strip
- Modify: `frontend/src/components/viewer/PhotoViewerModal.test.tsx` — redesigned viewer coverage

### Frontend albums page
- Create: `frontend/src/components/albums/AlbumCard.tsx` — visual album card
- Create: `frontend/src/pages/AlbumsPage.tsx` — data-driven albums list page
- Create: `frontend/src/pages/AlbumsPage.test.tsx` — albums rendering and navigation coverage

## Task 1: Add folder-aware scanning and album aggregation on the backend

**Files:**
- Modify: `backend/src/Service/PhotoScannerInterface.php`
- Modify: `backend/src/Service/PhotoScanner.php`
- Create: `backend/src/Service/AlbumIndexService.php`
- Create: `backend/tests/Service/AlbumIndexServiceTest.php`
- Modify: `backend/tests/Service/PhotoScannerTest.php`
- Modify: `backend/tests/Service/PhotoIndexServiceTest.php`

- [ ] **Step 1: Write the failing backend tests for folder-aware scanning and album aggregation**

Replace `backend/tests/Service/PhotoScannerTest.php` with:
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoScanner;
use PHPUnit\Framework\TestCase;

final class PhotoScannerTest extends TestCase
{
    public function test_it_returns_root_images_and_first_level_album_images(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-scan-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);
        mkdir($directory . '/travel/nested', 0777, true);
        mkdir($directory . '/family', 0777, true);

        file_put_contents($directory . '/root.jpg', 'jpg');
        file_put_contents($directory . '/travel/cover.png', 'png');
        file_put_contents($directory . '/family/photo.webp', 'webp');
        file_put_contents($directory . '/travel/nested/skip.jpg', 'jpg');
        file_put_contents($directory . '/notes.txt', 'txt');

        $scanner = new PhotoScanner();
        $result = $scanner->scan($directory);

        self::assertSame(
            ['root.jpg', 'travel/cover.png', 'family/photo.webp'],
            array_map(
                static fn (array $item): string => str_replace('\\', '/', $item['relativePath']),
                $result,
            ),
        );
    }
}
```

Create `backend/tests/Service/AlbumIndexServiceTest.php`:
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\AlbumIndexService;
use Gallery\Service\PhotoMetadataReaderInterface;
use Gallery\Service\PhotoScannerInterface;
use PHPUnit\Framework\TestCase;

final class AlbumIndexServiceTest extends TestCase
{
    public function test_it_builds_album_summaries_from_first_level_folders(): void
    {
        $scanner = new class implements PhotoScannerInterface {
            public function scan(string $directory): array
            {
                return [
                    ['absolutePath' => $directory . '/root.jpg', 'relativePath' => 'root.jpg'],
                    ['absolutePath' => $directory . '/travel/one.jpg', 'relativePath' => 'travel/one.jpg'],
                    ['absolutePath' => $directory . '/travel/two.jpg', 'relativePath' => 'travel/two.jpg'],
                    ['absolutePath' => $directory . '/family/cover.png', 'relativePath' => 'family/cover.png'],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return match (basename($path)) {
                    'one.jpg' => ['takenAt' => '2026-03-29T09:00:00+00:00', 'width' => 1200, 'height' => 800],
                    'two.jpg' => ['takenAt' => '2026-03-31T09:00:00+00:00', 'width' => 1200, 'height' => 800],
                    'cover.png' => ['takenAt' => null, 'width' => 1200, 'height' => 800],
                    default => ['takenAt' => null, 'width' => 1200, 'height' => 800],
                };
            }
        };

        $service = new AlbumIndexService($scanner, $metadataReader, '/photos', '/media');
        $albums = $service->all();

        self::assertSame(['travel', 'family'], array_column($albums, 'name'));
        self::assertSame('/media/travel/two.jpg', $albums[0]['coverUrl']);
        self::assertSame(2, $albums[0]['photoCount']);
    }
}
```

Replace `backend/tests/Service/PhotoIndexServiceTest.php` with:
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use ArrayObject;
use Gallery\Service\FilePhotoCache;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReaderInterface;
use Gallery\Service\PhotoScannerInterface;
use PHPUnit\Framework\TestCase;

final class PhotoIndexServiceTest extends TestCase
{
    public function test_it_builds_sorted_photo_records_from_root_and_album_folders(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);

        $root = $directory . '/root.png';
        $folder = $directory . '/travel/with-exif.jpg';
        file_put_contents($root, 'root');
        file_put_contents($folder, 'folder');
        touch($root, strtotime('2026-03-31 11:00:00 UTC'));
        touch($folder, strtotime('2026-03-25 09:00:00 UTC'));

        $scanner = new class([$root, $folder]) implements PhotoScannerInterface {
            public function __construct(private readonly array $paths)
            {
            }

            public function scan(string $directory): array
            {
                return [
                    ['absolutePath' => $this->paths[0], 'relativePath' => 'root.png'],
                    ['absolutePath' => $this->paths[1], 'relativePath' => 'travel/with-exif.jpg'],
                ];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return str_contains($path, 'with-exif.jpg')
                    ? ['takenAt' => '2026-03-31T10:00:00+00:00', 'width' => 2048, 'height' => 1365]
                    : ['takenAt' => null, 'width' => 1600, 'height' => 900];
            }
        };

        $service = new PhotoIndexService($scanner, $metadataReader, $directory, '/media');
        $items = $service->all();

        self::assertSame(['root.png', 'with-exif.jpg'], array_column($items, 'filename'));
        self::assertSame('/media/root.png', $items[0]['url']);
        self::assertSame('/media/travel/with-exif.jpg', $items[1]['url']);
    }

    public function test_it_reuses_a_cached_photo_index_until_the_ttl_expires(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        $cacheDirectory = sys_get_temp_dir() . '/gallery-cache-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);
        mkdir($cacheDirectory, 0777, true);

        $photo = $directory . '/cached.jpg';
        file_put_contents($photo, 'cached');
        touch($photo, strtotime('2026-03-31 12:00:00 UTC'));

        $scanCounter = new ArrayObject(['count' => 0]);

        $scanner = new class($photo, $scanCounter) implements PhotoScannerInterface {
            public function __construct(
                private readonly string $path,
                private readonly ArrayObject $scanCounter,
            ) {
            }

            public function scan(string $directory): array
            {
                $this->scanCounter['count']++;

                return [['absolutePath' => $this->path, 'relativePath' => 'cached.jpg']];
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return ['takenAt' => null, 'width' => 1200, 'height' => 800];
            }
        };

        $service = new PhotoIndexService(
            $scanner,
            $metadataReader,
            $directory,
            '/media',
            new FilePhotoCache($cacheDirectory),
            30,
        );

        $service->all();
        $service->all();

        self::assertSame(1, $scanCounter['count']);
    }
}
```

- [ ] **Step 2: Run the failing backend tests**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif vendor/bin/phpunit tests/Service/PhotoScannerTest.php tests/Service/PhotoIndexServiceTest.php tests/Service/AlbumIndexServiceTest.php
```

Expected: FAIL because the scanner contract and album aggregation service do not exist in the required form yet.

- [ ] **Step 3: Implement folder-aware scanning and album aggregation**

Replace `backend/src/Service/PhotoScannerInterface.php` with:
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoScannerInterface
{
    /**
     * @return list<array{absolutePath:string,relativePath:string}>
     */
    public function scan(string $directory): array;
}
```

Replace `backend/src/Service/PhotoScanner.php` with:
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

use DirectoryIterator;

final class PhotoScanner implements PhotoScannerInterface
{
    private const SUPPORTED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

    public function scan(string $directory): array
    {
        if (!is_dir($directory)) {
            return [];
        }

        $items = [];

        foreach (new DirectoryIterator($directory) as $fileInfo) {
            if ($fileInfo->isDot()) {
                continue;
            }

            if ($fileInfo->isFile() && $this->isSupported($fileInfo->getExtension())) {
                $items[] = [
                    'absolutePath' => $fileInfo->getPathname(),
                    'relativePath' => $fileInfo->getFilename(),
                ];
                continue;
            }

            if (!$fileInfo->isDir()) {
                continue;
            }

            foreach (new DirectoryIterator($fileInfo->getPathname()) as $child) {
                if ($child->isDot() || !$child->isFile() || !$this->isSupported($child->getExtension())) {
                    continue;
                }

                $items[] = [
                    'absolutePath' => $child->getPathname(),
                    'relativePath' => $fileInfo->getFilename() . '/' . $child->getFilename(),
                ];
            }
        }

        usort(
            $items,
            static fn (array $left, array $right): int => strcmp($left['relativePath'], $right['relativePath']),
        );

        return $items;
    }

    private function isSupported(string $extension): bool
    {
        return in_array(strtolower($extension), self::SUPPORTED_EXTENSIONS, true);
    }
}
```

Create `backend/src/Service/AlbumIndexService.php`:
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

use DateTimeImmutable;
use DateTimeZone;

final class AlbumIndexService
{
    public function __construct(
        private readonly PhotoScannerInterface $scanner,
        private readonly PhotoMetadataReaderInterface $metadataReader,
        private readonly string $photosDirectory,
        private readonly string $mediaBaseUrl,
    ) {
    }

    /**
     * @return list<array{id:string,name:string,coverUrl:string,photoCount:int,latestSortTime:string}>
     */
    public function all(): array
    {
        $albums = [];

        foreach ($this->scanner->scan($this->photosDirectory) as $item) {
            if (!str_contains($item['relativePath'], '/')) {
                continue;
            }

            [$folderName] = explode('/', $item['relativePath'], 2);
            $metadata = $this->metadataReader->read($item['absolutePath']);
            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) filemtime($item['absolutePath'])))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);
            $url = rtrim($this->mediaBaseUrl, '/') . '/' . str_replace('%2F', '/', rawurlencode($item['relativePath']));

            if (!isset($albums[$folderName])) {
                $albums[$folderName] = [
                    'id' => sha1($folderName),
                    'name' => $folderName,
                    'coverUrl' => $url,
                    'photoCount' => 0,
                    'latestSortTime' => $sortTime,
                ];
            }

            $albums[$folderName]['photoCount']++;

            if ($sortTime > $albums[$folderName]['latestSortTime']) {
                $albums[$folderName]['latestSortTime'] = $sortTime;
                $albums[$folderName]['coverUrl'] = $url;
            }
        }

        $result = array_values($albums);

        usort(
            $result,
            static fn (array $left, array $right): int => strcmp($right['latestSortTime'], $left['latestSortTime']),
        );

        return $result;
    }
}
```

Replace `backend/src/Service/PhotoIndexService.php` with:
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

use DateTimeImmutable;
use DateTimeZone;

final class PhotoIndexService
{
    public function __construct(
        private readonly PhotoScannerInterface $scanner,
        private readonly PhotoMetadataReaderInterface $metadataReader,
        private readonly string $photosDirectory,
        private readonly string $mediaBaseUrl,
        private readonly ?PhotoCacheInterface $cache = null,
        private readonly int $cacheTtlSeconds = 15,
    ) {
    }

    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>
     */
    public function all(): array
    {
        $cacheKey = sha1($this->photosDirectory . '|' . $this->mediaBaseUrl);

        if ($this->cache !== null) {
            $cached = $this->cache->get($cacheKey);

            if ($cached !== null) {
                return $cached;
            }
        }

        $items = [];

        foreach ($this->scanner->scan($this->photosDirectory) as $item) {
            if (!is_file($item['absolutePath']) || !is_readable($item['absolutePath'])) {
                continue;
            }

            $metadata = $this->metadataReader->read($item['absolutePath']);
            $filename = basename($item['absolutePath']);
            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) filemtime($item['absolutePath'])))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);
            $url = rtrim($this->mediaBaseUrl, '/') . '/' . str_replace('%2F', '/', rawurlencode($item['relativePath']));

            $items[] = [
                'id' => sha1($item['relativePath'] . '|' . (string) filemtime($item['absolutePath'])),
                'filename' => $filename,
                'url' => $url,
                'thumbnailUrl' => $url,
                'takenAt' => $metadata['takenAt'],
                'sortTime' => $sortTime,
                'width' => $metadata['width'],
                'height' => $metadata['height'],
            ];
        }

        usort(
            $items,
            static fn (array $left, array $right): int => strcmp($right['sortTime'], $left['sortTime']),
        );

        if ($this->cache !== null) {
            $this->cache->put($cacheKey, $items, $this->cacheTtlSeconds);
        }

        return $items;
    }
}
```

- [ ] **Step 4: Run the backend tests again and verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif vendor/bin/phpunit tests/Service/PhotoScannerTest.php tests/Service/PhotoIndexServiceTest.php tests/Service/AlbumIndexServiceTest.php
```

Expected: PASS for all service tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/Service/PhotoScannerInterface.php backend/src/Service/PhotoScanner.php backend/src/Service/PhotoIndexService.php backend/src/Service/AlbumIndexService.php backend/tests/Service/PhotoScannerTest.php backend/tests/Service/PhotoIndexServiceTest.php backend/tests/Service/AlbumIndexServiceTest.php
git commit -m "feat: add folder-based album aggregation"
```

### Task 2: Expose the `/api/albums` endpoint

**Files:**
- Create: `backend/src/Action/GetAlbumsAction.php`
- Modify: `backend/src/createApp.php`
- Create: `backend/tests/Action/GetAlbumsActionTest.php`

- [ ] **Step 1: Write the failing endpoint contract test**

Create `backend/tests/Action/GetAlbumsActionTest.php`:
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use PHPUnit\Framework\TestCase;
use Slim\Psr7\Factory\ServerRequestFactory;

final class GetAlbumsActionTest extends TestCase
{
    public function test_it_returns_an_album_payload(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-albums-' . bin2hex(random_bytes(4));
        mkdir($directory . '/travel', 0777, true);
        file_put_contents($directory . '/travel/cover.jpg', 'jpg');
        touch($directory . '/travel/cover.jpg', strtotime('2026-03-31 09:00:00 UTC'));

        $app = createApp($directory, '/media');
        $request = (new ServerRequestFactory())->createServerRequest('GET', '/api/albums');
        $response = $app->handle($request);

        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame('travel', $payload['items'][0]['name']);
        self::assertSame(1, $payload['items'][0]['photoCount']);
    }
}
```

- [ ] **Step 2: Run the endpoint test to verify it fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif vendor/bin/phpunit tests/Action/GetAlbumsActionTest.php
```

Expected: FAIL because `/api/albums` is not registered yet.

- [ ] **Step 3: Implement the endpoint**

Create `backend/src/Action/GetAlbumsAction.php`:
```php
<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\AlbumIndexService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class GetAlbumsAction
{
    public function __construct(
        private readonly AlbumIndexService $albumIndexService,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $response->getBody()->write(
            json_encode(['items' => $this->albumIndexService->all()], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
```

Replace `backend/src/createApp.php` with:
```php
<?php

declare(strict_types=1);

use Gallery\Action\GetAlbumsAction;
use Gallery\Action\GetPhotosAction;
use Gallery\Service\AlbumIndexService;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoScanner;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;
use Slim\Psr7\Factory\ResponseFactory;

function createApp(
    string $photosDirectory,
    string $mediaBaseUrl = '/media',
    ?PhotoCacheInterface $cache = null,
): \Slim\App {
    $app = AppFactory::create();
    $scanner = new PhotoScanner();
    $metadataReader = new PhotoMetadataReader();

    $photoIndexService = new PhotoIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
        $cache ?? new NullPhotoCache(),
        15,
    );

    $albumIndexService = new AlbumIndexService(
        $scanner,
        $metadataReader,
        $photosDirectory,
        $mediaBaseUrl,
    );

    $app->addRoutingMiddleware();
    $errorMiddleware = $app->addErrorMiddleware(true, true, true);
    $errorMiddleware->setDefaultErrorHandler(
        static function (Request $request, Throwable $exception, bool $displayErrorDetails) {
            $response = (new ResponseFactory())->createResponse(500);
            $response->getBody()->write(
                json_encode([
                    'error' => $displayErrorDetails ? $exception->getMessage() : 'Internal Server Error',
                ], JSON_THROW_ON_ERROR),
            );

            return $response->withHeader('Content-Type', 'application/json');
        },
    );

    $app->get('/health', static function (Request $request, Response $response): Response {
        $response->getBody()->write('ok');

        return $response;
    });

    $app->get('/api/photos', new GetPhotosAction($photoIndexService));
    $app->get('/api/albums', new GetAlbumsAction($albumIndexService));

    $app->get('/media/{path:.*}', static function (Request $request, Response $response, array $args) use ($photosDirectory): Response {
        $relativePath = trim((string) ($args['path'] ?? ''), '/');

        if ($relativePath === '' || str_contains($relativePath, '..')) {
            return $response->withStatus(404);
        }

        $path = rtrim($photosDirectory, '/\\') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);

        if (!is_file($path) || !is_readable($path)) {
            return $response->withStatus(404);
        }

        $mimeType = mime_content_type($path) ?: 'application/octet-stream';
        $stream = fopen($path, 'rb');

        if ($stream === false) {
            return $response->withStatus(404);
        }

        $body = $response->getBody();
        while (!feof($stream)) {
            $chunk = fread($stream, 8192);
            if ($chunk === false) {
                break;
            }
            $body->write($chunk);
        }
        fclose($stream);

        return $response
            ->withHeader('Content-Type', $mimeType)
            ->withHeader('Content-Length', (string) filesize($path));
    });

    return $app;
}
```

- [ ] **Step 4: Run the endpoint tests again and verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif vendor/bin/phpunit tests/Action/GetPhotosActionTest.php tests/Action/GetAlbumsActionTest.php
```

Expected: PASS for both endpoint tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/Action/GetAlbumsAction.php backend/src/createApp.php backend/tests/Action/GetAlbumsActionTest.php
git commit -m "feat: expose album data through the api"
```

### Task 3: Add route-aware app shell and albums data client on the frontend

**Files:**
- Create: `frontend/src/types/album.ts`
- Create: `frontend/src/services/albums.ts`
- Create: `frontend/src/services/albums.test.ts`
- Create: `frontend/src/components/layout/AppShell.tsx`
- Create: `frontend/src/components/layout/AppShell.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/components/layout/Topbar.tsx`
- Create: `frontend/src/AppRouter.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write the failing frontend tests for albums service and route-aware shell**

Create `frontend/src/services/albums.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAlbums } from './albums';

const sampleAlbum = {
  id: 'travel',
  name: 'travel',
  coverUrl: '/media/travel/cover.jpg',
  photoCount: 12,
  latestSortTime: '2026-03-31T08:30:00+00:00',
};

describe('fetchAlbums', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the items array from the albums API payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [sampleAlbum] }),
      }),
    );

    await expect(fetchAlbums()).resolves.toEqual([sampleAlbum]);
  });
});
```

Create `frontend/src/components/layout/AppShell.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';

describe('AppShell', () => {
  it('marks Albums active when the route is /albums', () => {
    render(
      <AppShell route="albums">
        <div>Albums content</div>
      </AppShell>,
    );

    expect(screen.getByRole('link', { name: 'Albums' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Photos' })).not.toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run the failing frontend tests**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/services/albums.test.ts src/components/layout/AppShell.test.tsx
```

Expected: FAIL because the albums client and app shell do not exist yet.

- [ ] **Step 3: Implement the albums client and route-aware shell**

Create `frontend/src/types/album.ts`:
```ts
export type Album = {
  id: string;
  name: string;
  coverUrl: string;
  photoCount: number;
  latestSortTime: string;
};
```

Create `frontend/src/services/albums.ts`:
```ts
import type { Album } from '../types/album';

export async function fetchAlbums(): Promise<Album[]> {
  const response = await fetch('/api/albums');

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Album[] };

  return payload.items;
}
```

Replace `frontend/src/components/layout/Sidebar.tsx` with:
```tsx
type SidebarProps = {
  route: 'photos' | 'albums';
};

const futureItems = ['Sharing', 'Archive', 'Trash'];

export function Sidebar({ route }: SidebarProps) {
  return (
    <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col gap-2 bg-neutral-50 p-4 text-on-surface">
      <div className="mb-4 flex items-center gap-3 px-4 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-container text-white">▣</div>
        <div>
          <p className="font-headline text-lg font-black leading-tight text-primary">Immich</p>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-neutral-500">Your Digital Archive</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Primary navigation">
        <a
          href="/photos"
          aria-current={route === 'photos' ? 'page' : undefined}
          className={route === 'photos'
            ? 'flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700'
            : 'flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-100'}
        >
          <span>Photos</span>
        </a>

        <a
          href="/albums"
          aria-current={route === 'albums' ? 'page' : undefined}
          className={route === 'albums'
            ? 'flex items-center gap-3 rounded-lg bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700'
            : 'flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-neutral-600 hover:bg-neutral-100'}
        >
          <span>Albums</span>
        </a>

        {futureItems.map((item) => (
          <button
            key={item}
            type="button"
            disabled
            className="flex items-center gap-3 rounded-lg px-4 py-3 text-left text-sm text-neutral-500 opacity-70"
          >
            <span>{item}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
```

Replace `frontend/src/components/layout/Topbar.tsx` with:
```tsx
type TopbarProps = {
  route: 'photos' | 'albums';
};

export function Topbar({ route }: TopbarProps) {
  return (
    <header className="glass-nav sticky top-0 z-30 flex h-16 items-center justify-between px-6 md:px-12">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative w-full max-w-xl">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-outline">⌕</span>
          <input
            type="text"
            placeholder="Search your memories..."
            disabled
            className="w-full rounded-full bg-surface-container-high py-2.5 pl-12 pr-4 text-sm"
          />
        </div>
      </div>

      <div className="ml-4 text-sm font-semibold text-on-surface">
        {route === 'photos' ? 'Photos' : 'Albums'}
      </div>
    </header>
  );
}
```

Create `frontend/src/components/layout/AppShell.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

type AppShellProps = {
  route: 'photos' | 'albums';
  children: ReactNode;
};

export function AppShell({ route, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-on-surface font-body">
      <Sidebar route={route} />
      <main className="min-h-screen bg-surface md:ml-64">
        <Topbar route={route} />
        {children}
      </main>
    </div>
  );
}
```

Create `frontend/src/AppRouter.tsx`:
```tsx
import { AlbumsPage } from './pages/AlbumsPage';
import { PhotosPage } from './pages/PhotosPage';

export function AppRouter() {
  const path = window.location.pathname;

  if (path === '/albums') {
    return <AlbumsPage />;
  }

  return <PhotosPage />;
}
```

Replace `frontend/src/App.tsx` with:
```tsx
import { AppRouter } from './AppRouter';

export default function App() {
  return <AppRouter />;
}
```

- [ ] **Step 4: Run the frontend tests again and verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/services/albums.test.ts src/components/layout/AppShell.test.tsx src/components/layout/Sidebar.test.tsx
```

Expected: PASS for the new service and shell tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/album.ts frontend/src/services/albums.ts frontend/src/services/albums.test.ts frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/Topbar.tsx frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/AppShell.test.tsx frontend/src/AppRouter.tsx frontend/src/App.tsx
git commit -m "feat: add route-aware shell for photos and albums"
```

### Task 4: Rebuild the Photos timeline page to follow the Stitch reference more closely

**Files:**
- Modify: `frontend/src/pages/PhotosPage.tsx`
- Modify: `frontend/src/components/timeline/TimelineSection.tsx`
- Modify: `frontend/src/components/timeline/PhotoCard.tsx`
- Create: `frontend/src/components/timeline/TimelineRail.tsx`
- Modify: `frontend/src/pages/PhotosPage.test.tsx`

- [ ] **Step 1: Write the failing timeline redesign test**

Replace `frontend/src/pages/PhotosPage.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { fetchPhotos } from '../services/photos';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);

const photos = [
  {
    id: 'fresh',
    filename: 'fresh.jpg',
    url: '/media/fresh.jpg',
    thumbnailUrl: '/media/fresh.jpg',
    takenAt: '2026-03-31T09:00:00+00:00',
    sortTime: '2026-03-31T09:00:00+00:00',
    width: 1200,
    height: 800,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: '/media/older.jpg',
    thumbnailUrl: '/media/older.jpg',
    takenAt: '2026-03-28T12:00:00+00:00',
    sortTime: '2026-03-28T12:00:00+00:00',
    width: 1200,
    height: 800,
  },
];

describe('PhotosPage', () => {
  beforeEach(() => {
    mockedFetchPhotos.mockReset();
    window.history.replaceState({}, '', '/photos');
  });

  it('renders the redesigned timeline shell and grouped sections', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mar 28, 2026' })).toBeInTheDocument();
    expect(screen.getByText('New Moments')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });

  it('opens the viewer from the redesigned cards', async () => {
    const user = userEvent.setup();
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing timeline test**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/pages/PhotosPage.test.tsx
```

Expected: FAIL because the current timeline does not render the Stitch-style shell elements.

- [ ] **Step 3: Implement the redesigned timeline page**

Create `frontend/src/components/timeline/TimelineRail.tsx`:
```tsx
type TimelineRailProps = {
  year: string;
  labels: string[];
};

export function TimelineRail({ year, labels }: TimelineRailProps) {
  return (
    <nav className="fixed right-6 top-1/2 hidden -translate-y-1/2 flex-col items-end gap-6 text-[10px] font-bold uppercase tracking-[0.25em] text-outline xl:flex">
      <span className="text-primary">{year}</span>
      {labels.map((label) => (
        <span key={label} className="cursor-default transition-colors hover:text-primary">
          {label}
        </span>
      ))}
      <div className="relative h-20 w-1 rounded-full bg-outline-variant/20">
        <div className="absolute left-0 top-0 h-1/4 w-full rounded-full bg-primary"></div>
      </div>
    </nav>
  );
}
```

Replace `frontend/src/components/timeline/PhotoCard.tsx` with:
```tsx
import type { Photo } from '../../types/photo';

type PhotoCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
  variant?: 'portrait' | 'square' | 'wide';
};

export function PhotoCard({ photo, onOpen, variant = 'portrait' }: PhotoCardProps) {
  const variantClass = variant === 'wide'
    ? 'aspect-[3/2] md:col-span-2'
    : variant === 'square'
      ? 'aspect-square'
      : 'aspect-[4/5]';

  return (
    <button
      type="button"
      onClick={() => onOpen(photo.id)}
      aria-label={`Open ${photo.filename}`}
      className={`group relative overflow-hidden rounded-xl bg-surface-container text-left transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:z-10 ${variantClass}`}
    >
      <img
        src={photo.thumbnailUrl}
        alt={photo.filename}
        loading="lazy"
        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
      />
      <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/60 via-transparent to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <span className="text-xs font-medium text-white">{photo.filename}</span>
      </div>
    </button>
  );
}
```

Replace `frontend/src/components/timeline/TimelineSection.tsx` with:
```tsx
import type { Photo } from '../../types/photo';
import { PhotoCard } from './PhotoCard';

type TimelineSectionProps = {
  title: string;
  photos: Photo[];
  onOpen: (photoId: string) => void;
};

export function TimelineSection({ title, photos, onOpen }: TimelineSectionProps) {
  const variants: Array<'portrait' | 'square' | 'wide'> = ['portrait', 'square', 'wide'];

  return (
    <section className="mb-20">
      <div className="mb-8 flex items-baseline justify-between">
        <h2 className="font-headline text-[3.5rem] font-extrabold leading-none tracking-tighter text-on-surface">{title}</h2>
        <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
          New Moments
        </span>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo, index) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onOpen={onOpen}
            variant={variants[index % variants.length]}
          />
        ))}
      </div>
    </section>
  );
}
```

Replace `frontend/src/pages/PhotosPage.tsx` with:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { TimelineRail } from '../components/timeline/TimelineRail';
import { TimelineSection } from '../components/timeline/TimelineSection';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos } from '../services/photos';
import type { Photo } from '../types/photo';
import { groupPhotosByDate } from '../utils/groupPhotosByDate';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';

export function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());

  useEffect(() => {
    let cancelled = false;

    fetchPhotos()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setPhotos(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupPhotosByDate(photos), [photos]);
  const selectedIndex = photos.findIndex((photo) => photo.id === selectedPhotoId);

  const openPhoto = (photoId: string) => {
    setSelectedPhotoId(photoId);
    writeSelectedPhotoId(photoId);
  };

  const closeViewer = () => {
    setSelectedPhotoId(null);
    writeSelectedPhotoId(null);
  };

  const selectPhotoAtIndex = (index: number) => {
    const nextPhoto = photos[index];

    if (!nextPhoto) {
      return;
    }

    setSelectedPhotoId(nextPhoto.id);
    writeSelectedPhotoId(nextPhoto.id);
  };

  return (
    <AppShell route="photos">
      <div className="relative mx-auto max-w-7xl px-6 py-12 md:px-12">
        {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading gallery…</p>}
        {status === 'error' && <p className="text-sm text-red-700">Unable to load photos right now.</p>}
        {status === 'empty' && <p className="text-sm text-on-surface-variant">No photos found in the server folder yet.</p>}
        {status === 'ready' && groups.map((group) => (
          <TimelineSection
            key={group.title}
            title={group.title}
            photos={group.photos}
            onOpen={openPhoto}
          />
        ))}
      </div>

      <TimelineRail year="2026" labels={['Mar', 'Feb', 'Jan']} />

      {status === 'ready' && selectedIndex >= 0 && (
        <PhotoViewerModal
          photos={photos}
          selectedIndex={selectedIndex}
          onSelectIndex={selectPhotoAtIndex}
          onClose={closeViewer}
        />
      )}
    </AppShell>
  );
}
```

- [ ] **Step 4: Run the timeline tests again and verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/pages/PhotosPage.test.tsx
```

Expected: PASS for both timeline tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/timeline/PhotoCard.tsx frontend/src/components/timeline/TimelineSection.tsx frontend/src/components/timeline/TimelineRail.tsx frontend/src/pages/PhotosPage.tsx frontend/src/pages/PhotosPage.test.tsx
git commit -m "feat: redesign the photos timeline to match stitch"
```

### Task 5: Rebuild the viewer into an immersive Stitch-like overlay

**Files:**
- Create: `frontend/src/components/viewer/ViewerTopBar.tsx`
- Create: `frontend/src/components/viewer/ViewerSidePanel.tsx`
- Create: `frontend/src/components/viewer/ViewerActionBar.tsx`
- Modify: `frontend/src/components/viewer/PhotoViewerModal.tsx`
- Modify: `frontend/src/components/viewer/PhotoViewerModal.test.tsx`

- [ ] **Step 1: Write the failing viewer redesign test**

Replace `frontend/src/components/viewer/PhotoViewerModal.test.tsx` with:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PhotoViewerModal } from './PhotoViewerModal';

const photos = [
  {
    id: 'one',
    filename: 'one.jpg',
    url: '/media/one.jpg',
    thumbnailUrl: '/media/one.jpg',
    takenAt: '2026-03-31T09:00:00+00:00',
    sortTime: '2026-03-31T09:00:00+00:00',
    width: 1200,
    height: 800,
  },
  {
    id: 'two',
    filename: 'two.jpg',
    url: '/media/two.jpg',
    thumbnailUrl: '/media/two.jpg',
    takenAt: '2026-03-30T09:00:00+00:00',
    sortTime: '2026-03-30T09:00:00+00:00',
    width: 1200,
    height: 800,
  },
];

describe('PhotoViewerModal', () => {
  it('renders immersive viewer chrome and supports navigation', async () => {
    const user = userEvent.setup();
    const onSelectIndex = vi.fn();
    const onClose = vi.fn();

    render(
      <PhotoViewerModal
        photos={photos}
        selectedIndex={0}
        onSelectIndex={onSelectIndex}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
    expect(screen.getByText('Info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the failing viewer redesign test**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/components/viewer/PhotoViewerModal.test.tsx
```

Expected: FAIL because the current viewer does not include the immersive chrome.

- [ ] **Step 3: Implement the redesigned viewer pieces**

Create `frontend/src/components/viewer/ViewerTopBar.tsx`:
```tsx
import type { Photo } from '../../types/photo';

type ViewerTopBarProps = {
  photo: Photo;
  onClose: () => void;
};

export function ViewerTopBar({ photo, onClose }: ViewerTopBarProps) {
  return (
    <header className="absolute left-0 right-0 top-0 z-50 flex h-16 items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-6">
      <div className="flex items-center gap-4">
        <button type="button" aria-label="Close viewer" onClick={onClose} className="rounded-full p-2 text-white hover:bg-white/10">
          ←
        </button>
        <div className="flex flex-col">
          <span className="font-headline text-sm font-semibold tracking-tight text-neutral-100">{photo.filename}</span>
          <span className="text-[10px] uppercase tracking-widest text-neutral-400">{new Date(photo.sortTime).toLocaleString('en-US')}</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-white/90">
        <button type="button" className="rounded-full p-2 hover:bg-white/10">★</button>
        <button type="button" className="rounded-full p-2 hover:bg-white/10">↗</button>
        <button type="button" className="rounded-full p-2 hover:bg-white/10">i</button>
      </div>
    </header>
  );
}
```

Create `frontend/src/components/viewer/ViewerSidePanel.tsx`:
```tsx
import type { Photo } from '../../types/photo';

type ViewerSidePanelProps = {
  photo: Photo;
};

export function ViewerSidePanel({ photo }: ViewerSidePanelProps) {
  return (
    <aside className="z-50 hidden h-full w-96 flex-col overflow-y-auto border-l border-white/5 bg-neutral-900 p-8 text-white lg:flex">
      <div className="space-y-8">
        <div className="space-y-2">
          <h2 className="font-headline text-2xl font-bold tracking-tight">Info</h2>
          <p className="text-sm text-neutral-400">Filesystem-backed photo metadata</p>
        </div>

        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <span className="mt-1 text-neutral-500">◷</span>
            <div>
              <p className="text-sm font-medium text-neutral-200">{new Date(photo.sortTime).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</p>
              <p className="text-xs text-neutral-500">{new Date(photo.sortTime).toLocaleTimeString('en-US')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/5 bg-white/5 p-4">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500">Width</span>
              <p className="font-headline font-semibold text-neutral-200">{photo.width ?? '—'}</p>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/5 p-4">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500">Height</span>
              <p className="font-headline font-semibold text-neutral-200">{photo.height ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
```

Create `frontend/src/components/viewer/ViewerActionBar.tsx`:
```tsx
export function ViewerActionBar() {
  return (
    <div className="absolute bottom-8 left-1/2 z-50 flex -translate-x-1/2 items-center gap-6 rounded-full border border-white/5 bg-neutral-900/80 px-6 py-3 text-white shadow-2xl backdrop-blur-xl">
      <button type="button" className="text-xs uppercase tracking-tight text-neutral-200">Zoom</button>
      <button type="button" className="text-xs uppercase tracking-tight text-neutral-200">Edit</button>
      <button type="button" className="text-xs uppercase tracking-tight text-neutral-200">Trash</button>
      <button type="button" className="text-xs uppercase tracking-tight text-neutral-200">Save</button>
    </div>
  );
}
```

Replace `frontend/src/components/viewer/PhotoViewerModal.tsx` with:
```tsx
import type { Photo } from '../../types/photo';
import { ViewerActionBar } from './ViewerActionBar';
import { ViewerSidePanel } from './ViewerSidePanel';
import { ViewerTopBar } from './ViewerTopBar';

type PhotoViewerModalProps = {
  photos: Photo[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
};

export function PhotoViewerModal({ photos, selectedIndex, onSelectIndex, onClose }: PhotoViewerModalProps) {
  if (selectedIndex < 0 || selectedIndex >= photos.length) {
    return null;
  }

  const photo = photos[selectedIndex];

  return (
    <div className="fixed inset-0 z-50 flex h-screen w-screen overflow-hidden bg-neutral-950 text-white" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <ViewerTopBar photo={photo} onClose={onClose} />

      <button
        type="button"
        aria-label="Previous photo"
        disabled={selectedIndex === 0}
        onClick={() => onSelectIndex(selectedIndex - 1)}
        className="absolute inset-y-0 left-0 z-40 hidden w-32 items-center justify-start pl-6 text-white disabled:opacity-30 md:flex"
      >
        <span className="rounded-full bg-black/20 p-3 backdrop-blur-md">‹</span>
      </button>

      <section className="relative flex h-full flex-1 items-center justify-center p-4 md:p-12 lg:p-20">
        <div className="relative max-h-full max-w-full">
          <img src={photo.url} alt={photo.filename} className="max-h-[870px] w-auto object-contain shadow-2xl" />
          <ViewerActionBar />
        </div>
      </section>

      <button
        type="button"
        aria-label="Next photo"
        disabled={selectedIndex === photos.length - 1}
        onClick={() => onSelectIndex(selectedIndex + 1)}
        className="absolute inset-y-0 right-[24rem] z-40 hidden w-32 items-center justify-end pr-6 text-white disabled:opacity-30 lg:flex"
      >
        <span className="rounded-full bg-black/20 p-3 backdrop-blur-md">›</span>
      </button>

      <ViewerSidePanel photo={photo} />
    </div>
  );
}
```

- [ ] **Step 4: Run the viewer tests again and verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/components/viewer/PhotoViewerModal.test.tsx src/pages/PhotosPage.test.tsx
```

Expected: PASS for viewer and timeline integration tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/ViewerTopBar.tsx frontend/src/components/viewer/ViewerSidePanel.tsx frontend/src/components/viewer/ViewerActionBar.tsx frontend/src/components/viewer/PhotoViewerModal.tsx frontend/src/components/viewer/PhotoViewerModal.test.tsx frontend/src/pages/PhotosPage.test.tsx
git commit -m "feat: redesign the photo viewer to match stitch"
```

### Task 6: Add the Albums page and sidebar navigation

**Files:**
- Create: `frontend/src/components/albums/AlbumCard.tsx`
- Create: `frontend/src/pages/AlbumsPage.tsx`
- Create: `frontend/src/pages/AlbumsPage.test.tsx`
- Modify: `frontend/src/AppRouter.tsx`

- [ ] **Step 1: Write the failing Albums page test**

Create `frontend/src/pages/AlbumsPage.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { fetchAlbums } from '../services/albums';

vi.mock('../services/albums', () => ({
  fetchAlbums: vi.fn(),
}));

const mockedFetchAlbums = vi.mocked(fetchAlbums);

describe('AlbumsPage', () => {
  beforeEach(() => {
    mockedFetchAlbums.mockReset();
    window.history.replaceState({}, '', '/albums');
  });

  it('renders real albums from the API', async () => {
    mockedFetchAlbums.mockResolvedValue([
      {
        id: 'travel',
        name: 'travel',
        coverUrl: '/media/travel/cover.jpg',
        photoCount: 12,
        latestSortTime: '2026-03-31T08:30:00+00:00',
      },
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Albums' })).toBeInTheDocument();
    expect(screen.getByText('travel')).toBeInTheDocument();
    expect(screen.getByText('12 photos')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing Albums test**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/pages/AlbumsPage.test.tsx
```

Expected: FAIL because the Albums page does not exist yet.

- [ ] **Step 3: Implement the Albums page**

Create `frontend/src/components/albums/AlbumCard.tsx`:
```tsx
import type { Album } from '../../types/album';

type AlbumCardProps = {
  album: Album;
};

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <article className="group overflow-hidden rounded-2xl bg-surface-container-lowest shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-ambient">
      <div className="aspect-[4/3] overflow-hidden bg-surface-container">
        <img src={album.coverUrl} alt={album.name} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" />
      </div>
      <div className="space-y-1 px-5 py-4">
        <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">{album.name}</h2>
        <p className="text-sm text-on-surface-variant">{album.photoCount} photos</p>
      </div>
    </article>
  );
}
```

Create `frontend/src/pages/AlbumsPage.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { AlbumCard } from '../components/albums/AlbumCard';
import { AppShell } from '../components/layout/AppShell';
import { fetchAlbums } from '../services/albums';
import type { Album } from '../types/album';

export function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    fetchAlbums()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setAlbums(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell route="albums">
      <section className="mx-auto max-w-7xl px-6 py-12 md:px-12">
        <div className="mb-10 flex items-baseline justify-between">
          <h1 className="font-headline text-5xl font-extrabold tracking-tight text-on-surface">Albums</h1>
          <span className="text-xs font-bold uppercase tracking-widest text-primary">Folder Collections</span>
        </div>

        {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading albums…</p>}
        {status === 'error' && <p className="text-sm text-red-700">Unable to load albums right now.</p>}
        {status === 'empty' && <p className="text-sm text-on-surface-variant">No album folders found yet.</p>}
        {status === 'ready' && (
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
```

Replace `frontend/src/AppRouter.tsx` with:
```tsx
import { AlbumsPage } from './pages/AlbumsPage';
import { PhotosPage } from './pages/PhotosPage';

export function AppRouter() {
  const path = window.location.pathname;

  if (path === '/albums') {
    return <AlbumsPage />;
  }

  return <PhotosPage />;
}
```

- [ ] **Step 4: Run the Albums test again and verify it passes**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- src/pages/AlbumsPage.test.tsx src/components/layout/AppShell.test.tsx
```

Expected: PASS for the Albums route and rendering tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/albums/AlbumCard.tsx frontend/src/pages/AlbumsPage.tsx frontend/src/pages/AlbumsPage.test.tsx frontend/src/AppRouter.tsx
git commit -m "feat: add the albums list page"
```

### Task 7: Verify the full redesign slice

**Files:**
- Modify: none
- Test: backend + frontend + production build + smoke checks

- [ ] **Step 1: Run the backend test suite**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif vendor/bin/phpunit
```

Expected: PASS for all backend tests, including albums coverage.

- [ ] **Step 2: Run the frontend test suite**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test
```

Expected: PASS for photos, albums, viewer, layout, and data-layer tests.

- [ ] **Step 3: Run the frontend production build**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run build
```

Expected: PASS with generated assets in `frontend/dist`.

- [ ] **Step 4: Smoke-test both backend endpoints with real files and folders**

Run:
```bash
mkdir -p "/c/Users/万华镜/Desktop/Project/Gallery/storage/photos/travel" && cp "/c/Users/万华镜/Desktop/Project/Gallery/stitch_exports/10475339810720302491/9c1e443f3d364116867b61ef52dc6a0d.png" "/c/Users/万华镜/Desktop/Project/Gallery/storage/photos/travel/cover.png" && cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && "../phpenv/php-8.5.4-Win32-vs17-x64/php.exe" -n -d extension_dir="C:/Users/万华镜/Desktop/Project/Gallery/phpenv/php-8.5.4-Win32-vs17-x64/ext" -d extension=openssl -d extension=mbstring -d extension=fileinfo -d extension=exif -S 127.0.0.1:8080 -t public >/tmp/gallery-backend.log 2>&1 & BACKEND_PID=$! && sleep 2 && curl -s "http://127.0.0.1:8080/api/photos" && curl -s "http://127.0.0.1:8080/api/albums" && kill $BACKEND_PID
```

Expected: `/api/photos` includes root and folder images; `/api/albums` includes the `travel` album.

- [ ] **Step 5: Run the browser-level visual smoke check**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run dev -- --host 127.0.0.1 --port 5173 >/tmp/gallery-frontend.log 2>&1 & FRONTEND_PID=$! && echo "Open http://127.0.0.1:5173/photos and /albums, verify the redesigned timeline, immersive viewer, and albums page all feel materially closer to the Stitch references." && kill $FRONTEND_PID
```

Expected: manual confirmation that the visual redesign is materially closer to the Stitch references.

- [ ] **Step 6: Commit**

```bash
git add backend frontend storage/photos/travel/cover.png
git commit -m "feat: deliver the stitch-faithful redesign with albums"
```
