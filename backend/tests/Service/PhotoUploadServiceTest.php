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
        $sourcePath = $scriptDirectory . '/source.avif';
        file_put_contents($sourcePath, 'image-body');

        $result = $service->upload([
            new UploadedFile($sourcePath, 'unsafe name.avif', 'image/avif', filesize($sourcePath), UPLOAD_ERR_OK),
        ]);

        self::assertCount(1, $result['files']);
        self::assertSame('unsafe name.avif', $result['files'][0]['name']);
        self::assertSame(strlen('image-body'), $result['files'][0]['size']);
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
        $sourcePath = $scriptDirectory . '/source.webp';
        file_put_contents($sourcePath, 'image-body');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.webp', 'image/webp', filesize($sourcePath), UPLOAD_ERR_OK),
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

    public function testItIncludesScriptOutputWhenRemoteUploadFails(): void
    {
        $photosDirectory = $this->createTempDirectory('gallery-upload-photos-');
        $scriptDirectory = $this->createTempDirectory('gallery-upload-script-');
        $scriptPath = $scriptDirectory . '/upload_r2.php';

        file_put_contents($scriptPath, $this->phpUploadScriptStub($scriptDirectory . '/python.log', 7, "remote failed\n"));

        $service = new PhotoUploadService($photosDirectory, $scriptPath, PHP_BINARY);
        $sourcePath = $scriptDirectory . '/source.webp';
        file_put_contents($sourcePath, 'image-body');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage("Remote upload failed:\nremote failed");

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.webp', 'image/webp', filesize($sourcePath), UPLOAD_ERR_OK),
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
        $sourcePath = $scriptDirectory . '/source.webp';
        file_put_contents($sourcePath, 'image-body');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('Python interpreter is unavailable');

        try {
            $service->upload([
                new UploadedFile($sourcePath, 'source.webp', 'image/webp', filesize($sourcePath), UPLOAD_ERR_OK),
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
