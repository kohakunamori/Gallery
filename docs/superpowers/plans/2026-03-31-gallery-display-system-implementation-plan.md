# Gallery Display System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Stitch-inspired gallery timeline and photo viewer that reads server-side images from `storage/photos`, sorts them newest-first, and renders them through a Slim API + React frontend.

**Architecture:** The backend is a Slim 4 app that scans `storage/photos`, extracts EXIF capture time when available, falls back to file modification time, and caches the normalized photo index in a short-lived JSON file. The frontend is a React/Vite/Tailwind single-page app that fetches `/api/photos`, groups items by date, renders the timeline, and opens a viewer overlay without leaving the timeline.

**Tech Stack:** PHP 8.2 + Slim 4 + PHPUnit + React 19 + Vite + Tailwind CSS + Vitest + React Testing Library

---

## File Map

### Backend
- Create: `backend/composer.json` — Slim + PHPUnit dependencies and scripts
- Create: `backend/phpunit.xml` — backend test configuration
- Create: `backend/public/index.php` — backend entrypoint
- Create: `backend/src/createApp.php` — app assembly and dependency wiring
- Create: `backend/src/Action/GetPhotosAction.php` — `/api/photos` JSON handler
- Create: `backend/src/Service/PhotoScannerInterface.php` — scanner contract
- Create: `backend/src/Service/PhotoScanner.php` — file-system scanner for supported image types
- Create: `backend/src/Service/PhotoMetadataReaderInterface.php` — metadata reader contract
- Create: `backend/src/Service/PhotoMetadataReader.php` — EXIF + image-dimension reader
- Create: `backend/src/Service/PhotoCacheInterface.php` — cache contract for the normalized photo list
- Create: `backend/src/Service/FilePhotoCache.php` — short-lived JSON file cache
- Create: `backend/src/Service/NullPhotoCache.php` — no-op cache for tests
- Create: `backend/src/Service/PhotoIndexService.php` — normalize, sort, and cache photo records
- Create: `backend/tests/Action/GetPhotosActionTest.php` — route contract tests
- Create: `backend/tests/Service/PhotoMetadataReaderTest.php` — metadata parsing tests
- Create: `backend/tests/Service/PhotoScannerTest.php` — supported-extension tests
- Create: `backend/tests/Service/PhotoIndexServiceTest.php` — sorting + cache tests

### Frontend
- Create: `frontend/package.json` — frontend dependencies and scripts
- Create: `frontend/tsconfig.json` — TypeScript config
- Create: `frontend/vite.config.ts` — Vite config and dev proxy
- Create: `frontend/postcss.config.cjs` — Tailwind/PostCSS wiring
- Create: `frontend/tailwind.config.ts` — Stitch-inspired theme tokens
- Create: `frontend/index.html` — HTML shell and font imports
- Create: `frontend/src/main.tsx` — React mount
- Create: `frontend/src/index.css` — Tailwind layers and global styles
- Create: `frontend/src/App.tsx` — top-level shell composition
- Create: `frontend/src/types/photo.ts` — shared frontend photo type
- Create: `frontend/src/services/photos.ts` — `/api/photos` client
- Create: `frontend/src/services/photos.test.ts` — API client tests
- Create: `frontend/src/utils/groupPhotosByDate.ts` — date bucketing logic
- Create: `frontend/src/utils/groupPhotosByDate.test.ts` — date bucketing tests
- Create: `frontend/src/utils/photoQuery.ts` — viewer query-string helpers
- Create: `frontend/src/components/layout/Sidebar.tsx` — sidebar with disabled future sections
- Create: `frontend/src/components/layout/Topbar.tsx` — Stitch-inspired top bar
- Create: `frontend/src/components/layout/Sidebar.test.tsx` — sidebar interaction tests
- Create: `frontend/src/components/timeline/PhotoCard.tsx` — timeline card
- Create: `frontend/src/components/timeline/TimelineSection.tsx` — grouped date section
- Create: `frontend/src/components/viewer/PhotoViewerModal.tsx` — overlay viewer
- Create: `frontend/src/components/viewer/PhotoViewerModal.test.tsx` — viewer tests
- Create: `frontend/src/pages/PhotosPage.tsx` — timeline page and data flow
- Create: `frontend/src/pages/PhotosPage.test.tsx` — page-level rendering tests
- Create: `frontend/src/test/setup.ts` — Vitest DOM matchers

## Task 1: Bootstrap the Slim API shell

**Files:**
- Create: `backend/composer.json`
- Create: `backend/phpunit.xml`
- Create: `backend/public/index.php`
- Create: `backend/src/createApp.php`
- Create: `backend/src/Action/GetPhotosAction.php`
- Create: `backend/src/Service/PhotoIndexService.php`
- Test: `backend/tests/Action/GetPhotosActionTest.php`

- [ ] **Step 1: Write the failing route contract test and backend toolchain files**

`backend/composer.json`
```json
{
  "name": "gallery/backend",
  "type": "project",
  "require": {
    "php": "^8.2",
    "slim/slim": "^4.14",
    "slim/psr7": "^1.7"
  },
  "require-dev": {
    "phpunit/phpunit": "^11.5"
  },
  "autoload": {
    "psr-4": {
      "Gallery\\": "src/"
    },
    "files": [
      "src/createApp.php"
    ]
  },
  "autoload-dev": {
    "psr-4": {
      "Gallery\\Tests\\": "tests/"
    }
  },
  "scripts": {
    "serve": "php -S 127.0.0.1:8080 -t public",
    "test": "phpunit"
  }
}
```

`backend/phpunit.xml`
```xml
<?xml version="1.0" encoding="UTF-8"?>
<phpunit bootstrap="vendor/autoload.php" cacheDirectory=".phpunit.cache" colors="true">
  <testsuites>
    <testsuite name="backend">
      <directory>tests</directory>
    </testsuite>
  </testsuites>
</phpunit>
```

`backend/tests/Action/GetPhotosActionTest.php`
```php
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
```

- [ ] **Step 2: Run the backend test to verify it fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer install && composer test -- --filter GetPhotosActionTest
```

Expected: FAIL because `createApp()` / the backend app files do not exist yet.

- [ ] **Step 3: Write the minimal Slim app implementation**

`backend/src/Service/PhotoIndexService.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

final class PhotoIndexService
{
    public function __construct(
        private readonly string $photosDirectory,
        private readonly string $mediaBaseUrl,
    ) {
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function all(): array
    {
        return [];
    }
}
```

`backend/src/Action/GetPhotosAction.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\PhotoIndexService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class GetPhotosAction
{
    public function __construct(
        private readonly PhotoIndexService $photoIndexService,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $response->getBody()->write(
            json_encode(['items' => $this->photoIndexService->all()], JSON_THROW_ON_ERROR),
        );

        return $response->withHeader('Content-Type', 'application/json');
    }
}
```

`backend/src/createApp.php`
```php
<?php

declare(strict_types=1);

use Gallery\Action\GetPhotosAction;
use Gallery\Service\PhotoIndexService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

function createApp(string $photosDirectory, string $mediaBaseUrl = '/media'): \Slim\App
{
    $app = AppFactory::create();
    $photoIndexService = new PhotoIndexService($photosDirectory, $mediaBaseUrl);

    $app->get('/health', static function (Request $request, Response $response): Response {
        $response->getBody()->write('ok');

        return $response;
    });

    $app->get('/api/photos', new GetPhotosAction($photoIndexService));

    return $app;
}
```

`backend/public/index.php`
```php
<?php

declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

$app = createApp(dirname(__DIR__, 2) . '/storage/photos', '/media');
$app->run();
```

- [ ] **Step 4: Run the backend test again to verify it passes**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter GetPhotosActionTest
```

Expected: PASS with 1 test, 1 assertion.

- [ ] **Step 5: Commit the backend shell if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add backend/composer.json backend/phpunit.xml backend/public/index.php backend/src/createApp.php backend/src/Action/GetPhotosAction.php backend/src/Service/PhotoIndexService.php backend/tests/Action/GetPhotosActionTest.php && git commit -m "feat: bootstrap slim photos api"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 2: Implement metadata reading with EXIF fallback behavior

**Files:**
- Create: `backend/src/Service/PhotoMetadataReaderInterface.php`
- Create: `backend/src/Service/PhotoMetadataReader.php`
- Test: `backend/tests/Service/PhotoMetadataReaderTest.php`

- [ ] **Step 1: Write the failing metadata reader tests**

`backend/tests/Service/PhotoMetadataReaderTest.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoMetadataReader;
use PHPUnit\Framework\TestCase;

final class PhotoMetadataReaderTest extends TestCase
{
    public function test_it_reads_dimensions_and_returns_null_taken_at_when_no_exif_exists(): void
    {
        $file = sys_get_temp_dir() . '/gallery-image-' . bin2hex(random_bytes(4)) . '.png';
        file_put_contents(
            $file,
            base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', true),
        );

        $reader = new PhotoMetadataReader();
        $result = $reader->read($file);

        self::assertSame(null, $result['takenAt']);
        self::assertSame(1, $result['width']);
        self::assertSame(1, $result['height']);
    }

    public function test_it_parses_datetime_original_from_exif_data(): void
    {
        $file = sys_get_temp_dir() . '/gallery-image-' . bin2hex(random_bytes(4)) . '.jpg';
        file_put_contents($file, 'fake-jpeg-body');

        $reader = new PhotoMetadataReader(
            static fn (string $path): array => [
                'EXIF' => [
                    'DateTimeOriginal' => '2026:03:31 15:04:05',
                ],
            ],
        );

        $result = $reader->read($file);

        self::assertSame('2026-03-31T15:04:05+00:00', $result['takenAt']);
    }
}
```

- [ ] **Step 2: Run the metadata reader test to verify it fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter PhotoMetadataReaderTest
```

Expected: FAIL because `PhotoMetadataReader` does not exist yet.

- [ ] **Step 3: Write the metadata reader implementation**

`backend/src/Service/PhotoMetadataReaderInterface.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoMetadataReaderInterface
{
    /**
     * @return array{takenAt:?string,width:?int,height:?int}
     */
    public function read(string $path): array;
}
```

`backend/src/Service/PhotoMetadataReader.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

use Closure;
use DateTimeImmutable;
use DateTimeZone;

final class PhotoMetadataReader implements PhotoMetadataReaderInterface
{
    public function __construct(
        private readonly ?Closure $readExif = null,
    ) {
    }

    /**
     * @return array{takenAt:?string,width:?int,height:?int}
     */
    public function read(string $path): array
    {
        $dimensions = @getimagesize($path) ?: [null, null];
        [$width, $height] = $dimensions;

        return [
            'takenAt' => $this->readTakenAt($path),
            'width' => is_int($width) ? $width : null,
            'height' => is_int($height) ? $height : null,
        ];
    }

    private function readTakenAt(string $path): ?string
    {
        $exif = null;

        if ($this->readExif instanceof Closure) {
            $exif = ($this->readExif)($path);
        } elseif (function_exists('exif_read_data')) {
            $exif = @exif_read_data($path, 'EXIF', true);
        }

        if (!is_array($exif)) {
            return null;
        }

        $rawValue = $exif['EXIF']['DateTimeOriginal'] ?? $exif['EXIF']['DateTimeDigitized'] ?? null;

        if (!is_string($rawValue)) {
            return null;
        }

        $parsed = DateTimeImmutable::createFromFormat('Y:m:d H:i:s', $rawValue, new DateTimeZone('UTC'));

        return $parsed?->format(DATE_ATOM);
    }
}
```

- [ ] **Step 4: Run the metadata reader tests again to verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter PhotoMetadataReaderTest
```

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the metadata reader if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add backend/src/Service/PhotoMetadataReaderInterface.php backend/src/Service/PhotoMetadataReader.php backend/tests/Service/PhotoMetadataReaderTest.php && git commit -m "feat: read photo metadata from image files"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 3: Implement file scanning, normalization, and time sorting

**Files:**
- Create: `backend/src/Service/PhotoScannerInterface.php`
- Create: `backend/src/Service/PhotoScanner.php`
- Modify: `backend/src/Service/PhotoIndexService.php`
- Modify: `backend/src/createApp.php`
- Test: `backend/tests/Service/PhotoScannerTest.php`
- Test: `backend/tests/Service/PhotoIndexServiceTest.php`

- [ ] **Step 1: Write the failing scanner and index service tests**

`backend/tests/Service/PhotoScannerTest.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoScanner;
use PHPUnit\Framework\TestCase;

final class PhotoScannerTest extends TestCase
{
    public function test_it_only_returns_supported_image_files(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-scan-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        file_put_contents($directory . '/keep.jpg', 'jpg');
        file_put_contents($directory . '/keep.PNG', 'png');
        file_put_contents($directory . '/keep.webp', 'webp');
        file_put_contents($directory . '/skip.txt', 'txt');

        $scanner = new PhotoScanner();
        $paths = $scanner->scan($directory);

        self::assertSame(
            ['keep.jpg', 'keep.PNG', 'keep.webp'],
            array_map('basename', $paths),
        );
    }
}
```

`backend/tests/Service/PhotoIndexServiceTest.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReaderInterface;
use Gallery\Service\PhotoScannerInterface;
use PHPUnit\Framework\TestCase;

final class PhotoIndexServiceTest extends TestCase
{
    public function test_it_builds_sorted_photo_records_from_scanner_and_metadata(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $fallback = $directory . '/fallback.png';
        $withExif = $directory . '/with-exif.jpg';
        $older = $directory . '/older.jpg';

        file_put_contents($fallback, 'fallback');
        file_put_contents($withExif, 'with-exif');
        file_put_contents($older, 'older');

        touch($fallback, strtotime('2026-03-31 11:00:00 UTC'));
        touch($withExif, strtotime('2026-03-25 09:00:00 UTC'));
        touch($older, strtotime('2026-03-20 09:00:00 UTC'));

        $scanner = new class([$withExif, $fallback, $older]) implements PhotoScannerInterface {
            public function __construct(private readonly array $paths)
            {
            }

            public function scan(string $directory): array
            {
                return $this->paths;
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return match (basename($path)) {
                    'with-exif.jpg' => ['takenAt' => '2026-03-31T10:00:00+00:00', 'width' => 2048, 'height' => 1365],
                    'fallback.png' => ['takenAt' => null, 'width' => 1600, 'height' => 900],
                    default => ['takenAt' => '2026-03-18T08:00:00+00:00', 'width' => 1024, 'height' => 768],
                };
            }
        };

        $service = new PhotoIndexService($scanner, $metadataReader, $directory, '/media');
        $items = $service->all();

        self::assertSame(['fallback.png', 'with-exif.jpg', 'older.jpg'], array_column($items, 'filename'));
        self::assertSame('/media/fallback.png', $items[0]['url']);
        self::assertSame('/media/fallback.png', $items[0]['thumbnailUrl']);
        self::assertSame('2026-03-31T11:00:00+00:00', $items[0]['sortTime']);
        self::assertNotSame($items[0]['id'], $items[1]['id']);
    }
}
```

- [ ] **Step 2: Run the scanner/index tests to verify they fail**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter "PhotoScannerTest|PhotoIndexServiceTest"
```

Expected: FAIL because the scanner interfaces / implementations are not wired yet.

- [ ] **Step 3: Implement scanning, normalization, and sorting**

`backend/src/Service/PhotoScannerInterface.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoScannerInterface
{
    /**
     * @return list<string>
     */
    public function scan(string $directory): array;
}
```

`backend/src/Service/PhotoScanner.php`
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

        $paths = [];

        foreach (new DirectoryIterator($directory) as $fileInfo) {
            if ($fileInfo->isDot() || !$fileInfo->isFile()) {
                continue;
            }

            if (!in_array(strtolower($fileInfo->getExtension()), self::SUPPORTED_EXTENSIONS, true)) {
                continue;
            }

            $paths[] = $fileInfo->getPathname();
        }

        sort($paths, SORT_NATURAL | SORT_FLAG_CASE);

        return array_values($paths);
    }
}
```

`backend/src/Service/PhotoIndexService.php`
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
    ) {
    }

    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>
     */
    public function all(): array
    {
        $items = [];

        foreach ($this->scanner->scan($this->photosDirectory) as $path) {
            $metadata = $this->metadataReader->read($path);
            $filename = basename($path);
            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) filemtime($path)))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);
            $url = rtrim($this->mediaBaseUrl, '/') . '/' . rawurlencode($filename);

            $items[] = [
                'id' => sha1($filename . '|' . (string) filemtime($path)),
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

        return $items;
    }
}
```

`backend/src/createApp.php`
```php
<?php

declare(strict_types=1);

use Gallery\Action\GetPhotosAction;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoScanner;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

function createApp(string $photosDirectory, string $mediaBaseUrl = '/media'): \Slim\App
{
    $app = AppFactory::create();
    $photoIndexService = new PhotoIndexService(
        new PhotoScanner(),
        new PhotoMetadataReader(),
        $photosDirectory,
        $mediaBaseUrl,
    );

    $app->get('/health', static function (Request $request, Response $response): Response {
        $response->getBody()->write('ok');

        return $response;
    });

    $app->get('/api/photos', new GetPhotosAction($photoIndexService));

    return $app;
}
```

- [ ] **Step 4: Run the scanner/index tests again to verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter "PhotoScannerTest|PhotoIndexServiceTest"
```

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the file scanning layer if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add backend/src/Service/PhotoScannerInterface.php backend/src/Service/PhotoScanner.php backend/src/Service/PhotoIndexService.php backend/src/createApp.php backend/tests/Service/PhotoScannerTest.php backend/tests/Service/PhotoIndexServiceTest.php && git commit -m "feat: index photo files for the timeline api"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 4: Add a short-lived file cache around the photo index

**Files:**
- Create: `backend/src/Service/PhotoCacheInterface.php`
- Create: `backend/src/Service/FilePhotoCache.php`
- Create: `backend/src/Service/NullPhotoCache.php`
- Modify: `backend/src/Service/PhotoIndexService.php`
- Modify: `backend/src/createApp.php`
- Modify: `backend/public/index.php`
- Modify: `backend/tests/Service/PhotoIndexServiceTest.php`

- [ ] **Step 1: Extend the index service test with a failing cache assertion**

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
    public function test_it_builds_sorted_photo_records_from_scanner_and_metadata(): void
    {
        $directory = sys_get_temp_dir() . '/gallery-index-' . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        $fallback = $directory . '/fallback.png';
        $withExif = $directory . '/with-exif.jpg';
        $older = $directory . '/older.jpg';

        file_put_contents($fallback, 'fallback');
        file_put_contents($withExif, 'with-exif');
        file_put_contents($older, 'older');

        touch($fallback, strtotime('2026-03-31 11:00:00 UTC'));
        touch($withExif, strtotime('2026-03-25 09:00:00 UTC'));
        touch($older, strtotime('2026-03-20 09:00:00 UTC'));

        $scanner = new class([$withExif, $fallback, $older]) implements PhotoScannerInterface {
            public function __construct(private readonly array $paths)
            {
            }

            public function scan(string $directory): array
            {
                return $this->paths;
            }
        };

        $metadataReader = new class implements PhotoMetadataReaderInterface {
            public function read(string $path): array
            {
                return match (basename($path)) {
                    'with-exif.jpg' => ['takenAt' => '2026-03-31T10:00:00+00:00', 'width' => 2048, 'height' => 1365],
                    'fallback.png' => ['takenAt' => null, 'width' => 1600, 'height' => 900],
                    default => ['takenAt' => '2026-03-18T08:00:00+00:00', 'width' => 1024, 'height' => 768],
                };
            }
        };

        $service = new PhotoIndexService($scanner, $metadataReader, $directory, '/media');
        $items = $service->all();

        self::assertSame(['fallback.png', 'with-exif.jpg', 'older.jpg'], array_column($items, 'filename'));
        self::assertSame('/media/fallback.png', $items[0]['url']);
        self::assertSame('/media/fallback.png', $items[0]['thumbnailUrl']);
        self::assertSame('2026-03-31T11:00:00+00:00', $items[0]['sortTime']);
        self::assertNotSame($items[0]['id'], $items[1]['id']);
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

        $scanner = new class([$photo], $scanCounter) implements PhotoScannerInterface {
            public function __construct(
                private readonly array $paths,
                private readonly ArrayObject $scanCounter,
            ) {
            }

            public function scan(string $directory): array
            {
                $this->scanCounter['count']++;

                return $this->paths;
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

- [ ] **Step 2: Run the index service test to verify the cache assertion fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter PhotoIndexServiceTest
```

Expected: FAIL because `FilePhotoCache` / cache wiring does not exist yet.

- [ ] **Step 3: Implement the file cache and wire it into the app**

`backend/src/Service/PhotoCacheInterface.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

interface PhotoCacheInterface
{
    /**
     * @return list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}>|null
     */
    public function get(string $key): ?array;

    /**
     * @param list<array{id:string,filename:string,url:string,thumbnailUrl:string,takenAt:?string,sortTime:string,width:?int,height:?int}> $value
     */
    public function put(string $key, array $value, int $ttlSeconds): void;
}
```

`backend/src/Service/NullPhotoCache.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

final class NullPhotoCache implements PhotoCacheInterface
{
    public function get(string $key): ?array
    {
        return null;
    }

    public function put(string $key, array $value, int $ttlSeconds): void
    {
    }
}
```

`backend/src/Service/FilePhotoCache.php`
```php
<?php

declare(strict_types=1);

namespace Gallery\Service;

final class FilePhotoCache implements PhotoCacheInterface
{
    public function __construct(
        private readonly string $cacheDirectory,
    ) {
    }

    public function get(string $key): ?array
    {
        $path = $this->pathFor($key);

        if (!is_file($path)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($path), true);

        if (!is_array($decoded) || !isset($decoded['expiresAt'], $decoded['value'])) {
            return null;
        }

        if ((int) $decoded['expiresAt'] < time()) {
            @unlink($path);

            return null;
        }

        return is_array($decoded['value']) ? $decoded['value'] : null;
    }

    public function put(string $key, array $value, int $ttlSeconds): void
    {
        if (!is_dir($this->cacheDirectory)) {
            mkdir($this->cacheDirectory, 0777, true);
        }

        file_put_contents(
            $this->pathFor($key),
            json_encode(
                ['expiresAt' => time() + $ttlSeconds, 'value' => $value],
                JSON_THROW_ON_ERROR,
            ),
        );
    }

    private function pathFor(string $key): string
    {
        return rtrim($this->cacheDirectory, '/\\') . DIRECTORY_SEPARATOR . sha1($key) . '.json';
    }
}
```

`backend/src/Service/PhotoIndexService.php`
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

        foreach ($this->scanner->scan($this->photosDirectory) as $path) {
            $metadata = $this->metadataReader->read($path);
            $filename = basename($path);
            $sortTime = $metadata['takenAt']
                ?? (new DateTimeImmutable('@' . (string) filemtime($path)))
                    ->setTimezone(new DateTimeZone('UTC'))
                    ->format(DATE_ATOM);
            $url = rtrim($this->mediaBaseUrl, '/') . '/' . rawurlencode($filename);

            $items[] = [
                'id' => sha1($filename . '|' . (string) filemtime($path)),
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

`backend/src/createApp.php`
```php
<?php

declare(strict_types=1);

use Gallery\Action\GetPhotosAction;
use Gallery\Service\NullPhotoCache;
use Gallery\Service\PhotoIndexService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoScanner;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\Factory\AppFactory;

function createApp(
    string $photosDirectory,
    string $mediaBaseUrl = '/media',
    ?PhotoCacheInterface $cache = null,
): \Slim\App {
    $app = AppFactory::create();
    $photoIndexService = new PhotoIndexService(
        new PhotoScanner(),
        new PhotoMetadataReader(),
        $photosDirectory,
        $mediaBaseUrl,
        $cache ?? new NullPhotoCache(),
        15,
    );

    $app->get('/health', static function (Request $request, Response $response): Response {
        $response->getBody()->write('ok');

        return $response;
    });

    $app->get('/api/photos', new GetPhotosAction($photoIndexService));

    return $app;
}
```

`backend/public/index.php`
```php
<?php

declare(strict_types=1);

use Gallery\Service\FilePhotoCache;

require __DIR__ . '/../vendor/autoload.php';

$app = createApp(
    dirname(__DIR__, 2) . '/storage/photos',
    '/media',
    new FilePhotoCache(dirname(__DIR__) . '/var/cache'),
);

$app->run();
```

- [ ] **Step 4: Run the index service test again to verify the cache works**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test -- --filter PhotoIndexServiceTest
```

Expected: PASS with 2 tests.

- [ ] **Step 5: Commit the cache layer if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add backend/src/Service/PhotoCacheInterface.php backend/src/Service/FilePhotoCache.php backend/src/Service/NullPhotoCache.php backend/src/Service/PhotoIndexService.php backend/src/createApp.php backend/public/index.php backend/tests/Service/PhotoIndexServiceTest.php && git commit -m "feat: cache the normalized photo index"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 5: Scaffold the React/Tailwind frontend shell

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/postcss.config.cjs`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/components/layout/Sidebar.tsx`
- Create: `frontend/src/components/layout/Topbar.tsx`
- Create: `frontend/src/pages/PhotosPage.tsx`
- Create: `frontend/src/test/setup.ts`
- Test: `frontend/src/components/layout/Sidebar.test.tsx`

- [ ] **Step 1: Write the failing sidebar test and frontend toolchain files**

`frontend/package.json`
```json
{
  "name": "gallery-frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.0.4",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.2",
    "vite": "^6.0.1",
    "vitest": "^2.1.8"
  }
}
```

`frontend/tsconfig.json`
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

`frontend/vite.config.ts`
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/media': 'http://127.0.0.1:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
```

`frontend/postcss.config.cjs`
```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`frontend/tailwind.config.ts`
```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#f9f9f9',
        surface: '#f9f9f9',
        'surface-container': '#eeeeee',
        'surface-container-low': '#f3f3f3',
        'surface-container-lowest': '#ffffff',
        'surface-container-high': '#e8e8e8',
        primary: '#005bb3',
        'primary-container': '#0073e0',
        'primary-fixed': '#d6e3ff',
        outline: '#717785',
        'outline-variant': '#c1c6d6',
        'on-surface': '#1a1c1c',
        'on-surface-variant': '#414754',
      },
      fontFamily: {
        headline: ['"Plus Jakarta Sans"', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        ambient: '0 24px 60px rgba(26, 28, 28, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

`frontend/index.html`
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gallery Timeline</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/test/setup.ts`
```ts
import '@testing-library/jest-dom/vitest';
```

`frontend/src/components/layout/Sidebar.test.tsx`
```tsx
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';

describe('Sidebar', () => {
  it('keeps Photos active and future sections disabled', () => {
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Albums' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sharing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Trash' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the sidebar test to verify it fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm install && npm run test -- Sidebar.test.tsx
```

Expected: FAIL because the layout components do not exist yet.

- [ ] **Step 3: Implement the shell, theme, and disabled navigation**

`frontend/src/index.css`
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, sans-serif;
  color: #1a1c1c;
  background: #f9f9f9;
}

body {
  margin: 0;
  min-width: 320px;
  min-height: 100vh;
  background: #f9f9f9;
}

button,
input {
  font: inherit;
}
```

`frontend/src/components/layout/Sidebar.tsx`
```tsx
const futureItems = ['Albums', 'Sharing', 'Archive', 'Trash'];

export function Sidebar() {
  return (
    <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col gap-4 bg-surface-container-low px-4 py-6 text-on-surface">
      <div className="px-4">
        <p className="font-headline text-xl font-extrabold tracking-tight text-primary">Immich</p>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-on-surface-variant">Your Digital Archive</p>
      </div>

      <nav className="flex flex-col gap-2 px-2" aria-label="Primary navigation">
        <a
          href="/"
          aria-current="page"
          className="rounded-xl bg-primary-fixed px-4 py-3 text-left text-sm font-semibold text-primary"
        >
          Photos
        </a>

        {futureItems.map((item) => (
          <button
            key={item}
            type="button"
            disabled
            className="rounded-xl px-4 py-3 text-left text-sm font-medium text-on-surface-variant opacity-60"
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
```

`frontend/src/components/layout/Topbar.tsx`
```tsx
export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-outline-variant/40 bg-white/80 px-6 backdrop-blur md:px-12">
      <label className="flex w-full max-w-xl items-center gap-3 rounded-full bg-surface-container-high px-4 py-2 text-sm text-on-surface-variant">
        <span aria-hidden="true">⌕</span>
        <input
          type="text"
          placeholder="Search your memories..."
          className="w-full border-0 bg-transparent outline-none"
          disabled
        />
      </label>

      <button
        type="button"
        disabled
        className="ml-4 rounded-xl bg-gradient-to-r from-primary to-primary-container px-4 py-2 text-sm font-semibold text-white opacity-60"
      >
        Upload
      </button>
    </header>
  );
}
```

`frontend/src/pages/PhotosPage.tsx`
```tsx
import { Topbar } from '../components/layout/Topbar';

export function PhotosPage() {
  return (
    <main className="min-h-screen bg-surface md:ml-64">
      <Topbar />
      <section className="mx-auto max-w-7xl px-6 py-12 md:px-12">
        <p className="text-sm text-on-surface-variant">Loading gallery…</p>
      </section>
    </main>
  );
}
```

`frontend/src/App.tsx`
```tsx
import { Sidebar } from './components/layout/Sidebar';
import { PhotosPage } from './pages/PhotosPage';

export default function App() {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Sidebar />
      <PhotosPage />
    </div>
  );
}
```

`frontend/src/main.tsx`
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 4: Run the sidebar test again to verify it passes**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- Sidebar.test.tsx
```

Expected: PASS with 1 test.

- [ ] **Step 5: Commit the frontend shell if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add frontend/package.json frontend/tsconfig.json frontend/vite.config.ts frontend/postcss.config.cjs frontend/tailwind.config.ts frontend/index.html frontend/src/main.tsx frontend/src/index.css frontend/src/App.tsx frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/Topbar.tsx frontend/src/components/layout/Sidebar.test.tsx frontend/src/pages/PhotosPage.tsx frontend/src/test/setup.ts && git commit -m "feat: add stitch-inspired frontend shell"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 6: Add the photo API client and date grouping utilities

**Files:**
- Create: `frontend/src/types/photo.ts`
- Create: `frontend/src/services/photos.ts`
- Create: `frontend/src/services/photos.test.ts`
- Create: `frontend/src/utils/groupPhotosByDate.ts`
- Create: `frontend/src/utils/groupPhotosByDate.test.ts`

- [ ] **Step 1: Write the failing service and grouping tests**

`frontend/src/services/photos.test.ts`
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPhotos } from './photos';

const samplePhoto = {
  id: 'photo-1',
  filename: 'fresh.jpg',
  url: '/media/fresh.jpg',
  thumbnailUrl: '/media/fresh.jpg',
  takenAt: '2026-03-31T09:00:00+00:00',
  sortTime: '2026-03-31T09:00:00+00:00',
  width: 1200,
  height: 800,
};

describe('fetchPhotos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [samplePhoto] }),
      }),
    );

    await expect(fetchPhotos()).resolves.toEqual([samplePhoto]);
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchPhotos()).rejects.toThrow('Request failed with status 500');
  });
});
```

`frontend/src/utils/groupPhotosByDate.test.ts`
```ts
import { describe, expect, it } from 'vitest';
import { groupPhotosByDate } from './groupPhotosByDate';

const photos = [
  {
    id: 'today',
    filename: 'today.jpg',
    url: '/media/today.jpg',
    thumbnailUrl: '/media/today.jpg',
    takenAt: '2026-03-31T09:00:00+00:00',
    sortTime: '2026-03-31T09:00:00+00:00',
    width: 100,
    height: 100,
  },
  {
    id: 'yesterday',
    filename: 'yesterday.jpg',
    url: '/media/yesterday.jpg',
    thumbnailUrl: '/media/yesterday.jpg',
    takenAt: '2026-03-30T11:00:00+00:00',
    sortTime: '2026-03-30T11:00:00+00:00',
    width: 100,
    height: 100,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: '/media/older.jpg',
    thumbnailUrl: '/media/older.jpg',
    takenAt: '2026-03-28T08:00:00+00:00',
    sortTime: '2026-03-28T08:00:00+00:00',
    width: 100,
    height: 100,
  },
];

describe('groupPhotosByDate', () => {
  it('creates Today, Yesterday, and formatted older sections', () => {
    const groups = groupPhotosByDate(photos, new Date('2026-03-31T12:00:00+00:00'));

    expect(groups.map((group) => group.title)).toEqual(['Today', 'Yesterday', 'Mar 28, 2026']);
    expect(groups[0].photos).toHaveLength(1);
    expect(groups[1].photos).toHaveLength(1);
    expect(groups[2].photos).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the service/grouping tests to verify they fail**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- "photos.test.ts|groupPhotosByDate.test.ts"
```

Expected: FAIL because the photo type, client, and grouping utility do not exist yet.

- [ ] **Step 3: Implement the photo type, client, and date grouping**

`frontend/src/types/photo.ts`
```ts
export type Photo = {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  takenAt: string | null;
  sortTime: string;
  width: number | null;
  height: number | null;
};
```

`frontend/src/services/photos.ts`
```ts
import type { Photo } from '../types/photo';

export async function fetchPhotos(): Promise<Photo[]> {
  const response = await fetch('/api/photos');

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Photo[] };

  return payload.items;
}
```

`frontend/src/utils/groupPhotosByDate.ts`
```ts
import type { Photo } from '../types/photo';

export type PhotoGroup = {
  title: string;
  photos: Photo[];
};

export function groupPhotosByDate(photos: Photo[], now = new Date()): PhotoGroup[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const groups = new Map<string, Photo[]>();

  for (const photo of photos) {
    const photoDate = new Date(photo.sortTime);
    const startOfPhotoDate = new Date(photoDate.getFullYear(), photoDate.getMonth(), photoDate.getDate());
    const diffInDays = Math.round((startOfNow.getTime() - startOfPhotoDate.getTime()) / 86_400_000);

    const title = diffInDays === 0
      ? 'Today'
      : diffInDays === 1
        ? 'Yesterday'
        : formatter.format(photoDate);

    if (!groups.has(title)) {
      groups.set(title, []);
    }

    groups.get(title)!.push(photo);
  }

  return Array.from(groups.entries()).map(([title, groupedPhotos]) => ({
    title,
    photos: groupedPhotos,
  }));
}
```

- [ ] **Step 4: Run the service/grouping tests again to verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- "photos.test.ts|groupPhotosByDate.test.ts"
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the data layer if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add frontend/src/types/photo.ts frontend/src/services/photos.ts frontend/src/services/photos.test.ts frontend/src/utils/groupPhotosByDate.ts frontend/src/utils/groupPhotosByDate.test.ts && git commit -m "feat: add frontend photo data utilities"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 7: Render the timeline page from API data

**Files:**
- Create: `frontend/src/components/timeline/PhotoCard.tsx`
- Create: `frontend/src/components/timeline/TimelineSection.tsx`
- Modify: `frontend/src/pages/PhotosPage.tsx`
- Test: `frontend/src/pages/PhotosPage.test.tsx`

- [ ] **Step 1: Write the failing page-level rendering test**

`frontend/src/pages/PhotosPage.test.tsx`
```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { fetchPhotos } from '../services/photos';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);

describe('PhotosPage', () => {
  beforeEach(() => {
    mockedFetchPhotos.mockReset();
  });

  it('renders grouped timeline sections from the API response', async () => {
    mockedFetchPhotos.mockResolvedValue([
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
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mar 28, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'fresh.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'older.jpg' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the page test to verify it fails**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- PhotosPage.test.tsx
```

Expected: FAIL because the timeline components and page data flow are not implemented yet.

- [ ] **Step 3: Implement the timeline page and photo cards**

`frontend/src/components/timeline/PhotoCard.tsx`
```tsx
import type { Photo } from '../../types/photo';

type PhotoCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
};

export function PhotoCard({ photo, onOpen }: PhotoCardProps) {
  const timeLabel = new Date(photo.sortTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <button
      type="button"
      onClick={() => onOpen(photo.id)}
      aria-label={`Open ${photo.filename}`}
      className="group relative overflow-hidden rounded-2xl bg-surface-container text-left shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-ambient"
    >
      <img
        src={photo.thumbnailUrl}
        alt={photo.filename}
        loading="lazy"
        className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-[1.02]"
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 py-4 text-white opacity-0 transition group-hover:opacity-100">
        <p className="text-sm font-medium">{photo.filename}</p>
        <p className="text-xs text-white/80">{timeLabel}</p>
      </div>
    </button>
  );
}
```

`frontend/src/components/timeline/TimelineSection.tsx`
```tsx
import type { Photo } from '../../types/photo';
import { PhotoCard } from './PhotoCard';

type TimelineSectionProps = {
  title: string;
  photos: Photo[];
  onOpen: (photoId: string) => void;
};

export function TimelineSection({ title, photos, onOpen }: TimelineSectionProps) {
  return (
    <section className="mb-16">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2 className="font-headline text-5xl font-extrabold tracking-tight text-on-surface">{title}</h2>
        <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          {photos.length} items
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo) => (
          <PhotoCard key={photo.id} photo={photo} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
```

`frontend/src/pages/PhotosPage.tsx`
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
import { TimelineSection } from '../components/timeline/TimelineSection';
import { fetchPhotos } from '../services/photos';
import type { Photo } from '../types/photo';
import { groupPhotosByDate } from '../utils/groupPhotosByDate';

export function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen bg-surface md:ml-64">
      <Topbar />
      <section className="mx-auto max-w-7xl px-6 py-12 md:px-12">
        {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading gallery…</p>}
        {status === 'error' && <p className="text-sm text-red-700">Unable to load photos right now.</p>}
        {status === 'empty' && <p className="text-sm text-on-surface-variant">No photos found in the server folder yet.</p>}
        {status === 'ready' && groups.map((group) => (
          <TimelineSection
            key={group.title}
            title={group.title}
            photos={group.photos}
            onOpen={setSelectedPhotoId}
          />
        ))}
        {selectedPhotoId && <span className="sr-only">Selected photo: {selectedPhotoId}</span>}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run the page test again to verify it passes**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- PhotosPage.test.tsx
```

Expected: PASS with 1 test.

- [ ] **Step 5: Commit the timeline UI if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add frontend/src/components/timeline/PhotoCard.tsx frontend/src/components/timeline/TimelineSection.tsx frontend/src/pages/PhotosPage.tsx frontend/src/pages/PhotosPage.test.tsx && git commit -m "feat: render the gallery timeline from api data"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 8: Add the photo viewer overlay and query-string persistence

**Files:**
- Create: `frontend/src/utils/photoQuery.ts`
- Create: `frontend/src/components/viewer/PhotoViewerModal.tsx`
- Create: `frontend/src/components/viewer/PhotoViewerModal.test.tsx`
- Modify: `frontend/src/pages/PhotosPage.tsx`
- Modify: `frontend/src/pages/PhotosPage.test.tsx`

- [ ] **Step 1: Write the failing viewer tests**

`frontend/src/components/viewer/PhotoViewerModal.test.tsx`
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
  it('renders the selected photo and supports previous/next navigation', async () => {
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
    expect(screen.getByRole('button', { name: 'Previous photo' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next photo' }));
    expect(onSelectIndex).toHaveBeenCalledWith(1);

    await user.click(screen.getByRole('button', { name: 'Close viewer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

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
    window.history.replaceState({}, '', '/');
  });

  it('renders grouped timeline sections from the API response', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mar 28, 2026' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'fresh.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'older.jpg' })).toBeInTheDocument();
  });

  it('opens the viewer and persists the selection in the query string', async () => {
    const user = userEvent.setup();
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
    expect(window.location.search).toContain('photo=fresh');
  });
});
```

- [ ] **Step 2: Run the viewer/page tests to verify they fail**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- "PhotoViewerModal.test.tsx|PhotosPage.test.tsx"
```

Expected: FAIL because the viewer modal and query helpers do not exist yet.

- [ ] **Step 3: Implement the overlay viewer and query persistence**

`frontend/src/utils/photoQuery.ts`
```ts
export function readSelectedPhotoId(): string | null {
  return new URL(window.location.href).searchParams.get('photo');
}

export function writeSelectedPhotoId(photoId: string | null): void {
  const url = new URL(window.location.href);

  if (photoId === null) {
    url.searchParams.delete('photo');
  } else {
    url.searchParams.set('photo', photoId);
  }

  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
```

`frontend/src/components/viewer/PhotoViewerModal.tsx`
```tsx
import type { Photo } from '../../types/photo';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-6 py-8" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <button
        type="button"
        aria-label="Close viewer"
        onClick={onClose}
        className="absolute right-6 top-6 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white"
      >
        Close
      </button>

      <button
        type="button"
        aria-label="Previous photo"
        disabled={selectedIndex === 0}
        onClick={() => onSelectIndex(selectedIndex - 1)}
        className="mr-4 rounded-full bg-white/10 px-4 py-3 text-white disabled:opacity-40"
      >
        ‹
      </button>

      <figure className="max-w-5xl overflow-hidden rounded-3xl bg-white/5 p-4 shadow-ambient">
        <img src={photo.url} alt={photo.filename} className="max-h-[75vh] w-full rounded-2xl object-contain" />
        <figcaption className="mt-4 text-sm text-white/80">{photo.filename}</figcaption>
      </figure>

      <button
        type="button"
        aria-label="Next photo"
        disabled={selectedIndex === photos.length - 1}
        onClick={() => onSelectIndex(selectedIndex + 1)}
        className="ml-4 rounded-full bg-white/10 px-4 py-3 text-white disabled:opacity-40"
      >
        ›
      </button>
    </div>
  );
}
```

`frontend/src/pages/PhotosPage.tsx`
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '../components/layout/Topbar';
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

  useEffect(() => {
    if (selectedPhotoId !== null && selectedIndex === -1 && photos.length > 0) {
      setSelectedPhotoId(null);
      writeSelectedPhotoId(null);
    }
  }, [photos.length, selectedIndex, selectedPhotoId]);

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
    <main className="min-h-screen bg-surface md:ml-64">
      <Topbar />
      <section className="mx-auto max-w-7xl px-6 py-12 md:px-12">
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
      </section>

      {status === 'ready' && selectedIndex >= 0 && (
        <PhotoViewerModal
          photos={photos}
          selectedIndex={selectedIndex}
          onSelectIndex={selectPhotoAtIndex}
          onClose={closeViewer}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Run the viewer/page tests again to verify they pass**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test -- "PhotoViewerModal.test.tsx|PhotosPage.test.tsx"
```

Expected: PASS with 3 tests.

- [ ] **Step 5: Commit the viewer workflow if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add frontend/src/utils/photoQuery.ts frontend/src/components/viewer/PhotoViewerModal.tsx frontend/src/components/viewer/PhotoViewerModal.test.tsx frontend/src/pages/PhotosPage.tsx frontend/src/pages/PhotosPage.test.tsx && git commit -m "feat: add a photo viewer overlay for the timeline"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.

### Task 9: Verify the full working slice

**Files:**
- Modify: none
- Test: backend + frontend suites + manual smoke check

- [ ] **Step 1: Run the backend test suite**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && composer test
```

Expected: PASS for `GetPhotosActionTest`, `PhotoMetadataReaderTest`, `PhotoScannerTest`, and `PhotoIndexServiceTest`.

- [ ] **Step 2: Run the frontend test suite**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run test
```

Expected: PASS for sidebar, service, grouping, page, and viewer tests.

- [ ] **Step 3: Run the frontend production build**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run build
```

Expected: Vite build completes successfully with generated assets in `frontend/dist`.

- [ ] **Step 4: Smoke-test the backend API with a real file**

Run:
```bash
mkdir -p "/c/Users/万华镜/Desktop/Project/Gallery/storage/photos" && cp "/c/Users/万华镜/Desktop/Project/Gallery/stitch_exports/10475339810720302491/9c1e443f3d364116867b61ef52dc6a0d.png" "/c/Users/万华镜/Desktop/Project/Gallery/storage/photos/timeline-reference.png" && cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && php -S 127.0.0.1:8080 -t public >/tmp/gallery-backend.log 2>&1 & BACKEND_PID=$! && sleep 2 && curl -s "http://127.0.0.1:8080/api/photos" && kill $BACKEND_PID
```

Expected: JSON response with at least one item named `timeline-reference.png` and a `/media/timeline-reference.png` URL.

- [ ] **Step 5: Run the end-to-end browser checklist locally**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery/backend" && php -S 127.0.0.1:8080 -t public >/tmp/gallery-backend.log 2>&1 & BACKEND_PID=$! && cd "/c/Users/万华镜/Desktop/Project/Gallery/frontend" && npm run dev -- --host 127.0.0.1 --port 5173 >/tmp/gallery-frontend.log 2>&1 & FRONTEND_PID=$! && echo "Open http://127.0.0.1:5173, verify timeline groups render, click a photo, verify viewer opens, next/previous works, close returns to the timeline, and disabled nav items remain inert." && kill $FRONTEND_PID && kill $BACKEND_PID
```

Expected: manual confirmation that the timeline and viewer match the MVP behavior from the spec.

- [ ] **Step 6: Commit the verified slice if git is available**

Run:
```bash
cd "/c/Users/万华镜/Desktop/Project/Gallery" && if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git add backend frontend storage/photos/timeline-reference.png && git commit -m "feat: deliver the gallery timeline mvp"; else echo "git not initialized; skip commit"; fi
```

Expected: a commit is created, or the command prints `git not initialized; skip commit`.
