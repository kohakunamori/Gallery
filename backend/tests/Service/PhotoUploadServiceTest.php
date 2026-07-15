<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoCatalogService;
use Gallery\Service\PhotoMetadataReader;
use Gallery\Service\PhotoUploadService;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Slim\Psr7\UploadedFile;

final class PhotoUploadServiceTest extends TestCase
{
    public function testItStagesUploadsTemporarilyRunsScriptCommitsCatalogAndDeletesBatch(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog, 0, "remote upload ok\n"));

        $temporaryDirectoryRoot = $this->createTempDirectory('gallery-upload-batches-');
        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, $temporaryDirectoryRoot);
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());
        $sourceSize = filesize($sourcePath);

        $result = $service->upload([
            new UploadedFile($sourcePath, 'unsafe name.png', 'image/png', $sourceSize, UPLOAD_ERR_OK),
        ]);

        self::assertCount(1, $result['files']);
        self::assertSame('unsafe name.png', $result['files'][0]['name']);
        self::assertSame($sourceSize, $result['files'][0]['size']);
        self::assertMatchesRegularExpression('#^unsafe-name-\d{8}-\d{6}-[a-f0-9]{8}\.avif$#', $result['files'][0]['path']);
        self::assertSame(['remote upload ok'], $result['output']);

        $catalog = json_decode((string) file_get_contents($catalogPath), true, 512, JSON_THROW_ON_ERROR);
        self::assertCount(1, $catalog['items']);
        self::assertSame($result['files'][0]['path'], $catalog['items'][0]['path']);
        self::assertSame(1, $catalog['items'][0]['width']);
        self::assertSame(1, $catalog['items'][0]['height']);

        $commandArguments = json_decode((string) file_get_contents($pythonLog), true, 512, JSON_THROW_ON_ERROR);
        self::assertSame([
            $scriptPath,
            '--dir',
        ], array_slice($commandArguments, 0, 2));
        self::assertStringStartsWith($temporaryDirectoryRoot . DIRECTORY_SEPARATOR, $commandArguments[2]);
        self::assertStringContainsString('gallery-upload-batch-', $commandArguments[2]);
        self::assertFileDoesNotExist($commandArguments[2]);
        self::assertSame([
            '--recursive',
            '--target',
            'r2',
        ], array_slice($commandArguments, 3));
        $environment = json_decode((string) file_get_contents($scriptDirectory . '/environment.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertStringStartsWith($commandArguments[2], $environment['UPLOAD_TARGET_CACHE_FILE']);
        self::assertStringStartsWith($commandArguments[2], $environment['UPLOAD_PREPARED_CACHE_DIR']);
        self::assertSame('1', $environment['UPLOAD_DISCARD_PREPARED_CACHE']);
        self::assertSame($catalogPath, $environment['PHOTO_CATALOG_PATH']);

        $serviceWithDefaultPython = $this->createService($catalogPath, $scriptPath);
        $buildPythonCommandPrefix = new \ReflectionMethod($serviceWithDefaultPython, 'buildPythonCommandPrefix');
        self::assertSame([PHP_OS_FAMILY === 'Windows' ? 'python' : 'python3'], $buildPythonCommandPrefix->invoke($serviceWithDefaultPython));

        @unlink($catalogPath);
        $this->removeDirectory($scriptDirectory);
        $this->removeDirectory($temporaryDirectoryRoot);
    }

    public function testItPassesConfiguredEnvFileToUploadScript(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $envFile = $scriptDirectory . '/upload_r2.env';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog, 0, "remote upload ok\n"));
        file_put_contents($envFile, "R2_BUCKET=example\n");

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY, $envFile);
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);

            $commandArguments = json_decode((string) file_get_contents($pythonLog), true, 512, JSON_THROW_ON_ERROR);
            self::assertSame([
                $scriptPath,
                '--dir',
            ], array_slice($commandArguments, 0, 2));
            self::assertStringContainsString('gallery-upload-batch-', $commandArguments[2]);
            self::assertSame([
                '--recursive',
                '--target',
                'r2',
                '--env-file',
                $envFile,
            ], array_slice($commandArguments, 3));
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItTreatsNoFileUploadEntriesAsNoFiles(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/empty';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, '');

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('No image files were uploaded.');

        try {
            $service->upload([
                new UploadedFile($sourcePath, '', 'application/octet-stream', 0, UPLOAD_ERR_NO_FILE),
            ]);
        } finally {
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsUnsupportedExtensionsBeforeSavingFilesOrRunningScript(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog));

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);
        $sourcePath = $scriptDirectory . '/notes.txt';
        file_put_contents($sourcePath, 'not an image');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Unsupported image format: notes.txt');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'notes.txt', 'text/plain', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($pythonLog);
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsSvgUploads(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/vector.svg';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, '<svg></svg>');

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Unsupported image format: vector.svg');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'vector.svg', 'image/svg+xml', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsFakeImageContent(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/fake.png';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, 'not actually a png');

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Uploaded file is not a valid supported image: fake.png');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'fake.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsTooManyFiles(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));

        $firstPath = $scriptDirectory . '/first.png';
        $secondPath = $scriptDirectory . '/second.png';
        file_put_contents($firstPath, $this->validPngContents());
        file_put_contents($secondPath, $this->validPngContents());

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, null, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Too many files were uploaded. The maximum is 1.');

        try {
            $service->upload([
                new UploadedFile($firstPath, 'first.png', 'image/png', filesize($firstPath), UPLOAD_ERR_OK),
                new UploadedFile($secondPath, 'second.png', 'image/png', filesize($secondPath), UPLOAD_ERR_OK),
            ]);
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsOversizedFilesAndBatches(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, $this->validPngContents());

        $tooSmallForFile = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, null, 20, 1);

        try {
            $tooSmallForFile->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
            self::fail('Expected oversized file rejection.');
        } catch (RuntimeException $exception) {
            self::assertSame('The uploaded file source.png is too large.', $exception->getMessage());
        }

        $tooSmallForBatch = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('The uploaded batch is too large.');

        try {
            $tooSmallForBatch->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItStreamsUploadScriptOutput(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $batchDirectory = $this->createTempDirectory('gallery-upload-batch-');

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 0, "first line\nsecond line\n"));

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);
        $events = [];

        try {
            $output = $service->runUploadScriptStreaming(static function (string $line, string $stream) use (&$events): void {
                $events[] = [$stream, $line];
            }, $batchDirectory);

            self::assertSame(['first line', 'second line'], $output);
            self::assertSame([
                ['stdout', 'first line'],
                ['stdout', 'second line'],
            ], $events);
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
            $this->removeDirectory($batchDirectory);
        }
    }

    public function testItResolvesCachedProcessStatusExitCode(): void
    {
        $service = $this->createService(sys_get_temp_dir() . '/unused.json', __FILE__, PHP_BINARY);
        $resolveProcessStatusExitCode = new \ReflectionMethod($service, 'resolveProcessStatusExitCode');

        self::assertSame(0, $resolveProcessStatusExitCode->invoke($service, ['exitcode' => -1, 'cached_exitcode' => 0]));
        self::assertSame(7, $resolveProcessStatusExitCode->invoke($service, ['exitcode' => 7]));
        self::assertNull($resolveProcessStatusExitCode->invoke($service, ['exitcode' => -1]));
    }

    public function testItTruncatesExcessiveScriptOutput(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $batchDirectory = $this->createTempDirectory('gallery-upload-batch-');

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 0, "first line\nsecond line\n"));

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 314572800, 600, 1);

        try {
            self::assertSame([
                'first line',
                'Upload output truncated after reaching the configured limit.',
            ], $service->runUploadScriptStreaming(null, $batchDirectory));
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
            $this->removeDirectory($batchDirectory);
        }
    }

    public function testItTimesOutLongRunningScripts(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $batchDirectory = $this->createTempDirectory('gallery-upload-batch-');

        file_put_contents($scriptPath, <<<'PHP'
<?php
sleep(2);
PHP);

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 314572800, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Remote upload timed out after 1 seconds.');

        try {
            $service->runUploadScriptStreaming(null, $batchDirectory);
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
            $this->removeDirectory($batchDirectory);
        }
    }

    public function testItIncludesScriptOutputWhenRemoteUploadFails(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 7, "remote failed\n"));

        $service = $this->createService($catalogPath, $scriptPath, PHP_BINARY);
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage("Remote upload failed:\nremote failed");

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            $catalog = json_decode((string) file_get_contents($catalogPath), true, 512, JSON_THROW_ON_ERROR);
            self::assertSame([], $catalog['items'] ?? []);
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItReportsUnavailablePythonInterpreter(): void
    {
        $catalogPath = $this->createTempFile('gallery-upload-catalog-', '.json');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));

        $service = $this->createService($catalogPath, $scriptPath, '__missing_python_binary__');
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Python interpreter is unavailable');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            @unlink($catalogPath);
            $this->removeDirectory($scriptDirectory);
        }
    }

    private function createService(
        string $catalogPath,
        string $scriptPath,
        ?string $pythonBinary = null,
        ?string $scriptEnvFile = null,
        ?string $temporaryDirectoryRoot = null,
        int $maxFiles = 20,
        int $maxFileBytes = 52428800,
        int $maxTotalBytes = 314572800,
        int $scriptTimeoutSeconds = 600,
        int $maxOutputLines = 500,
        int $maxOutputBytes = 262144,
    ): PhotoUploadService {
        return new PhotoUploadService(
            new PhotoCatalogService($catalogPath),
            new PhotoMetadataReader(),
            $scriptPath,
            $pythonBinary,
            $scriptEnvFile,
            $temporaryDirectoryRoot,
            $maxFiles,
            $maxFileBytes,
            $maxTotalBytes,
            $scriptTimeoutSeconds,
            $maxOutputLines,
            $maxOutputBytes,
        );
    }

    private function createTempDirectory(string $prefix): string
    {
        $directory = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        return $directory;
    }

    private function createTempFile(string $prefix, string $suffix): string
    {
        $path = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(4)) . $suffix;
        file_put_contents($path, json_encode([
            'version' => 1,
            'updatedAt' => gmdate(DATE_ATOM),
            'items' => [],
        ], JSON_THROW_ON_ERROR));

        return $path;
    }

    private function validPngContents(): string
    {
        $contents = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+XnB8AAAAASUVORK5CYII=',
            true,
        );
        self::assertNotFalse($contents);

        return $contents;
    }

    private function phpUploadScriptStub(string $logPath, int $exitCode = 0, string $output = ''): string
    {
        return sprintf(
            <<<'PHP'
<?php
file_put_contents(%s, json_encode($argv, JSON_THROW_ON_ERROR));
file_put_contents(dirname(%s) . '/environment.json', json_encode([
    'UPLOAD_TARGET_CACHE_FILE' => getenv('UPLOAD_TARGET_CACHE_FILE'),
    'UPLOAD_PREPARED_CACHE_DIR' => getenv('UPLOAD_PREPARED_CACHE_DIR'),
    'UPLOAD_DISCARD_PREPARED_CACHE' => getenv('UPLOAD_DISCARD_PREPARED_CACHE'),
    'PHOTO_CATALOG_PATH' => getenv('PHOTO_CATALOG_PATH'),
], JSON_THROW_ON_ERROR));
fwrite(STDOUT, %s);
exit(%d);
PHP,
            var_export($logPath, true),
            var_export($logPath, true),
            var_export($output, true),
            $exitCode,
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
