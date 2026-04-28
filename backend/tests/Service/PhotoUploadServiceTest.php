<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\PhotoUploadService;
use PHPUnit\Framework\TestCase;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use Slim\Psr7\UploadedFile;

final class PhotoUploadServiceTest extends TestCase
{
    public function testItSavesUploadsInScannerReachableFolderAndRunsUploadScript(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog, 0, "remote upload ok\n"));

        $temporaryDirectoryRoot = $this->createTempDirectory('gallery-upload-batches-');
        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, $temporaryDirectoryRoot);
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
        self::assertFileDoesNotExist($photosDirectory . '/' . $result['files'][0]['path']);
        self::assertSame(['remote upload ok'], $result['output']);

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
            'all',
        ], array_slice($commandArguments, 3));
        $environment = json_decode((string) file_get_contents($scriptDirectory . '/environment.json'), true, 512, JSON_THROW_ON_ERROR);
        self::assertStringStartsWith($commandArguments[2], $environment['UPLOAD_TARGET_CACHE_FILE']);
        self::assertStringStartsWith($commandArguments[2], $environment['UPLOAD_PREPARED_CACHE_DIR']);

        $serviceWithDefaultPython = new PhotoUploadService($photosDirectory, $scriptPath);
        $buildPythonCommandPrefix = new \ReflectionMethod($serviceWithDefaultPython, 'buildPythonCommandPrefix');
        self::assertSame([PHP_OS_FAMILY === 'Windows' ? 'python' : 'python3'], $buildPythonCommandPrefix->invoke($serviceWithDefaultPython));

        $this->removeDirectory($photosDirectory);
        $this->removeDirectory($scriptDirectory);
        $this->removeDirectory($temporaryDirectoryRoot);
    }

    public function testItPassesConfiguredEnvFileToUploadScript(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $envFile = $scriptDirectory . '/upload_r2.env';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog, 0, "remote upload ok\n"));
        file_put_contents($envFile, "R2_BUCKET=example\n");

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, $envFile);
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
                'all',
                '--env-file',
                $envFile,
            ], array_slice($commandArguments, 3));
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItTreatsNoFileUploadEntriesAsNoFiles(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/empty';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, '');

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('No image files were uploaded.');

        try {
            $service->upload([
                new UploadedFile($sourcePath, '', 'application/octet-stream', 0, UPLOAD_ERR_NO_FILE),
            ]);
        } finally {
            self::assertFileDoesNotExist($photosDirectory . '/notes');
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsUnsupportedExtensionsBeforeSavingFilesOrRunningScript(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $pythonLog = $scriptDirectory . '/python.log';
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($pythonLog));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);
        $sourcePath = $scriptDirectory . '/notes.txt';
        file_put_contents($sourcePath, 'not an image');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Unsupported image format: notes.txt');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'notes.txt', 'text/plain', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($photosDirectory . '/notes');
            self::assertFileDoesNotExist($pythonLog);
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsSvgUploads(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/vector.svg';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, '<svg></svg>');

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Unsupported image format: vector.svg');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'vector.svg', 'image/svg+xml', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsFakeImageContent(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/fake.png';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, 'not actually a png');

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Uploaded file is not a valid supported image: fake.png');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'fake.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            self::assertFileDoesNotExist($scriptDirectory . '/python.log');
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsTooManyFiles(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));

        $firstPath = $scriptDirectory . '/first.png';
        $secondPath = $scriptDirectory . '/second.png';
        file_put_contents($firstPath, $this->validPngContents());
        file_put_contents($secondPath, $this->validPngContents());

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, null, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Too many files were uploaded. The maximum is 1.');

        try {
            $service->upload([
                new UploadedFile($firstPath, 'first.png', 'image/png', filesize($firstPath), UPLOAD_ERR_OK),
                new UploadedFile($secondPath, 'second.png', 'image/png', filesize($secondPath), UPLOAD_ERR_OK),
            ]);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItRejectsOversizedFilesAndBatches(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));
        file_put_contents($sourcePath, $this->validPngContents());

        $tooSmallForFile = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, null, 20, 1);

        try {
            $tooSmallForFile->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
            self::fail('Expected oversized file rejection.');
        } catch (RuntimeException $exception) {
            self::assertSame('The uploaded file source.png is too large.', $exception->getMessage());
        }

        $tooSmallForBatch = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('The uploaded batch is too large.');

        try {
            $tooSmallForBatch->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItStreamsUploadScriptOutput(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 0, "first line\nsecond line\n"));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);
        $events = [];

        try {
            $output = $service->runUploadScriptStreaming(static function (string $line, string $stream) use (&$events): void {
                $events[] = [$stream, $line];
            });

            self::assertSame(['first line', 'second line'], $output);
            self::assertSame([
                ['stdout', 'first line'],
                ['stdout', 'second line'],
            ], $events);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItTruncatesExcessiveScriptOutput(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 0, "first line\nsecond line\n"));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 314572800, 600, 1);

        try {
            self::assertSame([
                'first line',
                'Upload output truncated after reaching the configured limit.',
            ], $service->runUploadScriptStreaming());
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItTimesOutLongRunningScripts(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, <<<'PHP'
<?php
sleep(2);
PHP);

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY, null, null, 20, 52428800, 314572800, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Remote upload timed out after 1 seconds.');

        try {
            $service->runUploadScriptStreaming();
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItIncludesScriptOutputWhenRemoteUploadFails(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 7, "remote failed\n"));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage("Remote upload failed:\nremote failed");

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    public function testItReportsUnavailablePythonInterpreter(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log'));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, '__missing_python_binary__');
        $sourcePath = $scriptDirectory . '/source.png';
        file_put_contents($sourcePath, $this->validPngContents());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Python interpreter is unavailable');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.png', 'image/png', filesize($sourcePath), UPLOAD_ERR_OK),
            ]);
        } finally {
            $this->removeDirectory($photosDirectory);
            $this->removeDirectory($scriptDirectory);
        }
    }

    private function createTempDirectory(string $prefix): string
    {
        $directory = sys_get_temp_dir() . '/' . $prefix . bin2hex(random_bytes(4));
        mkdir($directory, 0777, true);

        return $directory;
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
