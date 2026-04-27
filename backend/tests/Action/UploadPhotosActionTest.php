<?php

declare(strict_types=1);

namespace Gallery\Tests\Action;

use Gallery\Service\FilePhotoCache;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use Slim\Psr7\Factory\ServerRequestFactory;
use Slim\Psr7\UploadedFile;

final class UploadPhotosActionTest extends TestCase
{
    public function testItReturnsJsonValidationErrorAndKeepsCacheForUnsupportedFiles(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-action-photos-');
        $cacheDirectory = $this->createTempDirectory('gallery-upload-action-cache-');
        $cache = new FilePhotoCache($cacheDirectory);
        $cachedValue = [['id' => 'stale']];
        $cache->put('photos:r2', $cachedValue, 300);

        $app = createApp($photosDirectory, '/media', $cache, true);
        $request = (new ServerRequestFactory())
            ->createServerRequest('POST', '/upload')
            ->withUploadedFiles([
                'files' => [$this->uploadedFile($photosDirectory, 'source.txt', 'notes.txt', 'notes')],
            ]);

        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['error' => 'Unsupported image format: notes.txt'], $payload);
        self::assertSame($cachedValue, $cache->get('photos:r2'));
        self::assertFileDoesNotExist($photosDirectory . '/uploads');

        $this->removeDirectory($photosDirectory);
        $this->removeDirectory($cacheDirectory);
    }

    public function testItClearsCacheOnlyAfterSuccessfulUpload(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-action-photos-');
        $cacheDirectory = $this->createTempDirectory('gallery-upload-action-cache-');
        $cache = new FilePhotoCache($cacheDirectory);
        $cache->put('photos:r2', [['id' => 'stale']], 300);

        $scriptDirectory = $this->createTempDirectory('gallery-upload-action-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/upload.log'));

        try {
            $app = createApp(
                $photosDirectory,
                '/media',
                $cache,
                true,
                '/media',
                null,
                null,
                null,
                null,
                null,
                $scriptPath,
                PHP_BINARY,
            );
            $request = (new ServerRequestFactory())
                ->createServerRequest('POST', '/upload')
                ->withUploadedFiles([
                    'file' => $this->uploadedFile($photosDirectory, 'source.webp', 'source.webp', 'image-body'),
                ]);

            $response = $app->handle($request);
            $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

            self::assertSame(200, $response->getStatusCode());
            self::assertSame('source.webp', $payload['files'][0]['name']);
            self::assertMatchesRegularExpression('#^uploads/source-\d{8}-\d{6}-[a-f0-9]{8}\.webp$#', $payload['files'][0]['path']);
            self::assertSame(['stub upload ok'], $payload['output']);
            self::assertNull($cache->get('photos:r2'));
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($cacheDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItExtractsNestedMultipartFilesField(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-action-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-action-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/upload.log'));

        try {
            $app = createApp(
                $photosDirectory,
                '/media',
                null,
                true,
                '/media',
                null,
                null,
                null,
                null,
                null,
                $scriptPath,
                PHP_BINARY,
            );
            $request = (new ServerRequestFactory())
                ->createServerRequest('POST', '/upload')
                ->withUploadedFiles([
                    'files' => [
                        'nested' => [$this->uploadedFile($photosDirectory, 'nested.avif', 'nested.avif', 'image-body')],
                    ],
                ]);

            $response = $app->handle($request);
            $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

            self::assertSame(200, $response->getStatusCode());
            self::assertSame('nested.avif', $payload['files'][0]['name']);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItReturnsNoFilesValidationError(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-action-photos-');
        $app = createApp($photosDirectory, '/media', null, true);
        $request = (new ServerRequestFactory())->createServerRequest('POST', '/upload');

        $response = $app->handle($request);
        $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['error' => 'No image files were uploaded.'], $payload);

        $this->removeDirectory($photosDirectory);
    }

    private function uploadedFile(string $directory, string $sourceName, string $clientName, string $contents): UploadedFile
    {
        $path = $directory . '/' . $sourceName;
        file_put_contents($path, $contents);

        return new UploadedFile($path, $clientName, 'image/' . pathinfo($clientName, PATHINFO_EXTENSION), filesize($path), UPLOAD_ERR_OK);
    }

    private function phpUploadScriptStub(string $logPath): string
    {
        return sprintf(
            <<<'PHP'
<?php
file_put_contents(%s, json_encode($argv, JSON_THROW_ON_ERROR));
fwrite(STDOUT, "stub upload ok\n");
exit(0);
PHP,
            var_export($logPath, true),
        );
    }

    private function createTempDirectory(string $prefix): string
    {
        $directory = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        return $directory;
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
