<?php

declare(strict_types=1);

namespace Gallery\Service;

use Psr\Http\Message\UploadedFileInterface;
use RuntimeException;
use Throwable;

final class PhotoUploadService
{
    private const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif', 'heic'];
    private const EXTENSION_MIME_TYPES = [
        'jpg' => ['image/jpeg'],
        'jpeg' => ['image/jpeg'],
        'png' => ['image/png'],
        'webp' => ['image/webp'],
        'gif' => ['image/gif'],
        'bmp' => ['image/bmp', 'image/x-ms-bmp'],
        'tiff' => ['image/tiff'],
        'avif' => ['image/avif'],
        'heic' => ['image/heic', 'image/heif'],
    ];
    private const TEMPORARY_UPLOAD_PREFIX = 'gallery-upload-batch-';
    private const OUTPUT_TRUNCATION_LINE = 'Upload output truncated after reaching the configured limit.';

    public function __construct(
        private readonly string $photosDirectory,
        private readonly string $scriptPath,
        private readonly ?string $pythonBinary = null,
        private readonly ?string $scriptEnvFile = null,
        private readonly ?string $temporaryDirectoryRoot = null,
        private readonly int $maxFiles = 20,
        private readonly int $maxFileBytes = 52428800,
        private readonly int $maxTotalBytes = 314572800,
        private readonly int $scriptTimeoutSeconds = 600,
        private readonly int $maxOutputLines = 500,
        private readonly int $maxOutputBytes = 262144,
    ) {
    }

    /**
     * @param list<UploadedFileInterface> $files
     * @return array{files:list<array{name:string,path:string,size:int}>,output:list<string>}
     */
    public function upload(array $files): array
    {
        $uploadBatch = $this->prepareUpload($files);

        try {
            return [
                'files' => $uploadBatch['files'],
                'output' => $this->runUploadScriptStreaming(null, $uploadBatch['temporaryDirectory']),
            ];
        } finally {
            $this->removeDirectory($uploadBatch['temporaryDirectory']);
        }
    }

    /**
     * @param list<UploadedFileInterface> $files
     * @return array{files:list<array{name:string,path:string,size:int}>,temporaryDirectory:string}
     */
    public function prepareUpload(array $files): array
    {
        if ($files === []) {
            throw new RuntimeException('No image files were uploaded.');
        }

        $validatedFiles = $this->validateFiles($files);

        if ($validatedFiles === []) {
            throw new RuntimeException('No image files were uploaded.');
        }

        if (!is_file($this->scriptPath)) {
            throw new RuntimeException('Upload script is unavailable.');
        }

        $temporaryDirectory = $this->buildTemporaryDirectory();
        $savedFiles = [];

        try {
            foreach ($validatedFiles as $validatedFile) {
                $filename = $this->uniqueFilename(
                    $temporaryDirectory,
                    $this->buildUniqueBaseName($validatedFile['safeBaseName']),
                    $validatedFile['extension'],
                );
                $temporaryPath = $temporaryDirectory . DIRECTORY_SEPARATOR . $filename;

                try {
                    $validatedFile['file']->moveTo($temporaryPath);
                } catch (Throwable $exception) {
                    throw new RuntimeException(
                        sprintf('Unable to stage uploaded file %s.', $validatedFile['originalName']),
                        0,
                        $exception,
                    );
                }

                $this->validateStagedFileContent($temporaryPath, $validatedFile['extension'], $validatedFile['originalName']);
                $size = filesize($temporaryPath);

                $savedFiles[] = [
                    'name' => $validatedFile['originalName'],
                    'path' => $this->publishedRelativePath($filename),
                    'size' => $size === false ? 0 : $size,
                ];
            }
        } catch (Throwable $exception) {
            $this->removeDirectory($temporaryDirectory);

            throw $exception;
        }

        return [
            'files' => $savedFiles,
            'temporaryDirectory' => $temporaryDirectory,
        ];
    }

    /**
     * @param list<UploadedFileInterface> $files
     * @return list<array{file:UploadedFileInterface,originalName:string,safeBaseName:string,extension:string}>
     */
    private function validateFiles(array $files): array
    {
        $validatedFiles = [];
        $totalBytes = 0;

        foreach ($files as $file) {
            $originalName = $this->normalizeOriginalName($file->getClientFilename());

            if ($file->getError() === UPLOAD_ERR_NO_FILE) {
                continue;
            }

            if ($file->getError() !== UPLOAD_ERR_OK) {
                throw new RuntimeException(sprintf(
                    'Upload failed for %s: %s',
                    $originalName,
                    $this->uploadErrorMessage($file->getError()),
                ));
            }

            if (count($validatedFiles) >= $this->maxFiles) {
                throw new RuntimeException(sprintf('Too many files were uploaded. The maximum is %d.', $this->maxFiles));
            }

            $size = $file->getSize();

            if (!is_int($size) || $size < 0) {
                throw new RuntimeException(sprintf('Unable to determine the uploaded file size for %s.', $originalName));
            }

            if ($size > $this->maxFileBytes) {
                throw new RuntimeException(sprintf('The uploaded file %s is too large.', $originalName));
            }

            $totalBytes += $size;

            if ($totalBytes > $this->maxTotalBytes) {
                throw new RuntimeException('The uploaded batch is too large.');
            }

            $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));

            if ($extension === '' || !in_array($extension, self::ALLOWED_EXTENSIONS, true)) {
                throw new RuntimeException(sprintf('Unsupported image format: %s', $originalName));
            }

            $validatedFiles[] = [
                'file' => $file,
                'originalName' => $originalName,
                'safeBaseName' => $this->sanitizeBaseName(pathinfo($originalName, PATHINFO_FILENAME)),
                'extension' => $extension,
            ];
        }

        return $validatedFiles;
    }

    private function validateStagedFileContent(string $path, string $extension, string $originalName): void
    {
        $detectedTypes = [];

        if (function_exists('finfo_open')) {
            $fileInfo = finfo_open(FILEINFO_MIME_TYPE);

            if ($fileInfo !== false) {
                $mimeType = finfo_file($fileInfo, $path);
                finfo_close($fileInfo);

                if (is_string($mimeType) && $mimeType !== '') {
                    $detectedTypes[] = strtolower($mimeType);
                }
            }
        }

        $imageInfo = @getimagesize($path);

        if (is_array($imageInfo) && isset($imageInfo['mime']) && is_string($imageInfo['mime'])) {
            $detectedTypes[] = strtolower($imageInfo['mime']);
        }

        $allowedTypes = self::EXTENSION_MIME_TYPES[$extension] ?? [];

        foreach (array_unique($detectedTypes) as $detectedType) {
            if (in_array($detectedType, $allowedTypes, true)) {
                return;
            }
        }

        if (in_array($extension, ['avif', 'heic'], true) && $this->hasIsoImageBrand($path, $extension)) {
            return;
        }

        throw new RuntimeException(sprintf('Uploaded file is not a valid supported image: %s', $originalName));
    }

    private function hasIsoImageBrand(string $path, string $extension): bool
    {
        $handle = @fopen($path, 'rb');

        if ($handle === false) {
            return false;
        }

        $header = fread($handle, 64);
        fclose($handle);

        if ($header === false || !str_contains($header, 'ftyp')) {
            return false;
        }

        if ($extension === 'avif') {
            return str_contains($header, 'avif') || str_contains($header, 'avis');
        }

        return str_contains($header, 'heic') || str_contains($header, 'heix') || str_contains($header, 'hevc') || str_contains($header, 'hevx') || str_contains($header, 'mif1');
    }

    private function buildTemporaryDirectory(): string
    {
        $root = rtrim($this->temporaryDirectoryRoot ?? sys_get_temp_dir(), '/\\');

        if (!is_dir($root) && !@mkdir($root, 0770, true) && !is_dir($root)) {
            throw new RuntimeException('Unable to create the temporary upload root directory.');
        }

        if (!is_writable($root)) {
            throw new RuntimeException('The temporary upload root directory is not writable.');
        }

        $directory = $root . DIRECTORY_SEPARATOR . self::TEMPORARY_UPLOAD_PREFIX . bin2hex(random_bytes(8));

        if (!@mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create the temporary upload directory.');
        }

        return $directory;
    }

    private function normalizeOriginalName(?string $originalName): string
    {
        $normalizedName = trim(str_replace("\0", '', (string) ($originalName ?? '')));

        return $normalizedName === '' ? 'image' : basename(str_replace('\\', '/', $normalizedName));
    }

    private function sanitizeBaseName(string $baseName): string
    {
        $baseName = preg_replace('/[^A-Za-z0-9._-]+/', '-', $baseName) ?? '';
        $baseName = trim($baseName, '.-_');

        return $baseName === '' ? 'image' : substr($baseName, 0, 120);
    }

    private function buildUniqueBaseName(string $safeBaseName): string
    {
        return sprintf('%s-%s-%s', $safeBaseName, gmdate('Ymd-His'), bin2hex(random_bytes(4)));
    }

    private function uniqueFilename(string $directory, string $baseName, string $extension): string
    {
        $filename = $baseName . '.' . $extension;
        $counter = 2;

        while (is_file($directory . DIRECTORY_SEPARATOR . $filename)) {
            $filename = sprintf('%s-%d.%s', $baseName, $counter, $extension);
            $counter++;
        }

        return $filename;
    }

    private function publishedRelativePath(string $filename): string
    {
        $compression = $_ENV['UPLOAD_COMPRESSION'] ?? getenv('UPLOAD_COMPRESSION') ?: 'avif-lossless';

        if ($compression === 'avif-lossless' && in_array(strtolower(pathinfo($filename, PATHINFO_EXTENSION)), ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'], true)) {
            return pathinfo($filename, PATHINFO_FILENAME) . '.avif';
        }

        return $filename;
    }

    private function uploadErrorMessage(int $error): string
    {
        return match ($error) {
            UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The uploaded file is too large.',
            UPLOAD_ERR_PARTIAL => 'The uploaded file was only partially received.',
            UPLOAD_ERR_NO_FILE => 'No file was uploaded.',
            UPLOAD_ERR_NO_TMP_DIR => 'The server is missing a temporary upload directory.',
            UPLOAD_ERR_CANT_WRITE => 'The server could not write the uploaded file.',
            UPLOAD_ERR_EXTENSION => 'A server extension stopped the upload.',
            default => 'The upload transport reported an error.',
        };
    }

    /**
     * @return list<string>
     */
    private function buildPythonCommandPrefix(): array
    {
        if ($this->pythonBinary !== null && $this->pythonBinary !== '') {
            return [$this->pythonBinary];
        }

        if (PHP_OS_FAMILY === 'Windows') {
            return ['python'];
        }

        return ['python3'];
    }

    /**
     * @return list<string>
     */
    public function runUploadScriptStreaming(?callable $onOutput = null, ?string $uploadDirectory = null): array
    {
        $output = [];

        foreach ($this->streamUploadScriptOutput($uploadDirectory) as $event) {
            $output[] = $event['line'];

            if ($onOutput !== null) {
                $onOutput($event['line'], $event['stream']);
            }
        }

        return $output;
    }

    /**
     * @return \Generator<int,array{line:string,stream:string},void,list<string>>
     */
    public function streamUploadScriptOutput(?string $uploadDirectory = null): \Generator
    {
        $command = array_merge($this->buildPythonCommandPrefix(), $this->buildUploadScriptArguments($uploadDirectory ?? $this->photosDirectory));
        $descriptorSpec = [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = @proc_open($command, $descriptorSpec, $pipes, dirname($this->scriptPath), $this->processEnvironment($uploadDirectory));

        if (!is_resource($process)) {
            throw new RuntimeException('Python interpreter is unavailable.');
        }

        stream_set_blocking($pipes[1], false);
        stream_set_blocking($pipes[2], false);

        $output = [];
        $outputLineCount = 0;
        $outputByteCount = 0;
        $hasTruncatedOutput = false;
        $startedAt = microtime(true);
        $buffers = ['stdout' => '', 'stderr' => ''];
        $openPipes = ['stdout' => $pipes[1], 'stderr' => $pipes[2]];

        $timedOut = false;
        $statusExitCode = null;

        do {
            $status = proc_get_status($process);
            $processRunning = $status['running'] ?? false;
            $statusExitCode = $this->resolveProcessStatusExitCode($status) ?? $statusExitCode;

            if ($this->scriptTimeoutSeconds > 0 && microtime(true) - $startedAt > $this->scriptTimeoutSeconds) {
                $timedOut = true;
                proc_terminate($process);
                break;
            }

            foreach ($openPipes as $streamName => $pipe) {
                $chunk = stream_get_contents($pipe);

                if ($chunk !== false && $chunk !== '') {
                    $buffers[$streamName] .= $chunk;

                    foreach ($this->extractCompleteOutputLines($buffers[$streamName]) as $line) {
                        $nextLine = $this->recordOutputLine($line, $output, $outputLineCount, $outputByteCount, $hasTruncatedOutput);

                        if ($nextLine !== null) {
                            yield ['line' => $nextLine, 'stream' => $streamName];
                        }
                    }
                }

                if (feof($pipe)) {
                    if (trim($buffers[$streamName]) !== '') {
                        $line = rtrim($buffers[$streamName], "\r\n");
                        $nextLine = $this->recordOutputLine($line, $output, $outputLineCount, $outputByteCount, $hasTruncatedOutput);

                        if ($nextLine !== null) {
                            yield ['line' => $nextLine, 'stream' => $streamName];
                        }
                    }

                    fclose($pipe);
                    unset($openPipes[$streamName]);
                }
            }

            if ($openPipes !== [] || $processRunning) {
                usleep(10000);
            }
        } while ($openPipes !== [] || $processRunning);

        foreach ($openPipes as $pipe) {
            if (is_resource($pipe)) {
                fclose($pipe);
            }
        }

        $exitCode = proc_close($process);

        if ($exitCode === -1 && $statusExitCode !== null) {
            $exitCode = $statusExitCode;
        }

        if ($timedOut) {
            throw new RuntimeException(sprintf('Remote upload timed out after %d seconds.', $this->scriptTimeoutSeconds));
        }

        if ($exitCode === 127 || $exitCode === 9009) {
            throw new RuntimeException($output === [] ? 'Python interpreter is unavailable.' : "Python interpreter is unavailable:\n" . implode("\n", $output));
        }

        if ($exitCode !== 0) {
            throw new RuntimeException($output === [] ? 'Remote upload failed.' : "Remote upload failed:\n" . implode("\n", $output));
        }

        return $output;
    }

    /**
     * @param array<string,mixed> $status
     */
    private function resolveProcessStatusExitCode(array $status): ?int
    {
        foreach (['cached_exitcode', 'exitcode'] as $key) {
            $exitCode = $status[$key] ?? null;

            if (is_int($exitCode) && $exitCode >= 0) {
                return $exitCode;
            }
        }

        return null;
    }

    /**
     * @param list<string> $output
     */
    private function recordOutputLine(string $line, array &$output, int &$lineCount, int &$byteCount, bool &$hasTruncatedOutput): ?string
    {
        if ($hasTruncatedOutput) {
            return null;
        }

        $nextByteCount = $byteCount + strlen($line);

        if ($lineCount >= $this->maxOutputLines || $nextByteCount > $this->maxOutputBytes) {
            $hasTruncatedOutput = true;
            $output[] = self::OUTPUT_TRUNCATION_LINE;

            return self::OUTPUT_TRUNCATION_LINE;
        }

        $lineCount++;
        $byteCount = $nextByteCount;
        $output[] = $line;

        return $line;
    }

    /**
     * @return array<string,string>
     */
    private function processEnvironment(?string $uploadDirectory = null): array
    {
        $environment = [];

        $sourceEnvironment = getenv();

        if (!is_array($sourceEnvironment)) {
            $sourceEnvironment = [];
        }

        foreach (array_merge($sourceEnvironment, $_ENV, $_SERVER) as $key => $value) {
            if (is_string($key) && (is_string($value) || is_numeric($value))) {
                $environment[$key] = (string) $value;
            }
        }

        $environment['PYTHONUNBUFFERED'] = '1';

        if ($uploadDirectory !== null) {
            $cacheDirectory = rtrim($uploadDirectory, '/\\') . DIRECTORY_SEPARATOR . '.upload-runtime-cache';
            $environment['UPLOAD_TARGET_CACHE_FILE'] = $cacheDirectory . DIRECTORY_SEPARATOR . '.upload_target_cache.json';
            $environment['UPLOAD_PREPARED_CACHE_DIR'] = $cacheDirectory . DIRECTORY_SEPARATOR . '.upload_prepared_cache';
        }

        return $environment;
    }

    /**
     * @return list<string>
     */
    private function buildUploadScriptArguments(string $uploadDirectory): array
    {
        $arguments = [
            $this->scriptPath,
            '--dir',
            $uploadDirectory,
            '--recursive',
            '--target',
            'all',
        ];

        if ($this->scriptEnvFile !== null && $this->scriptEnvFile !== '') {
            $arguments[] = '--env-file';
            $arguments[] = $this->scriptEnvFile;
        }

        return $arguments;
    }

    public function removeTemporaryDirectory(string $directory): void
    {
        if (str_starts_with(basename($directory), self::TEMPORARY_UPLOAD_PREFIX)) {
            $this->removeDirectory($directory);
        }
    }

    private function removeDirectory(string $directory): void
    {
        if (!is_dir($directory)) {
            return;
        }

        $items = scandir($directory);

        if ($items === false) {
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $path = $directory . DIRECTORY_SEPARATOR . $item;

            if (is_dir($path) && !is_link($path)) {
                $this->removeDirectory($path);

                continue;
            }

            @unlink($path);
        }

        @rmdir($directory);
    }

    /**
     * @return list<string>
     */
    private function extractCompleteOutputLines(string &$buffer): array
    {
        $lines = [];

        while (preg_match('/\R/', $buffer, $match, PREG_OFFSET_CAPTURE) === 1) {
            $separator = $match[0][0];
            $offset = $match[0][1];
            $line = substr($buffer, 0, $offset);
            $buffer = substr($buffer, $offset + strlen($separator));

            if (trim($line) !== '') {
                $lines[] = $line;
            }
        }

        return $lines;
    }
}
