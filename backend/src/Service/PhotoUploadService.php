<?php

declare(strict_types=1);

namespace Gallery\Service;

use Psr\Http\Message\UploadedFileInterface;
use RuntimeException;
use Throwable;

final class PhotoUploadService
{
    private const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'avif', 'heic'];
    private const UPLOAD_DIRECTORY_NAME = 'uploads';

    public function __construct(
        private readonly string $photosDirectory,
        private readonly string $scriptPath,
        private readonly ?string $pythonBinary = null,
    ) {
    }

    /**
     * @param list<UploadedFileInterface> $files
     * @return array{files:list<array{name:string,path:string,size:int}>,output:list<string>}
     */
    public function upload(array $files): array
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

        $targetDirectory = $this->buildTargetDirectory();
        $savedFiles = [];

        foreach ($validatedFiles as $validatedFile) {
            $filename = $this->uniqueFilename(
                $targetDirectory,
                $this->buildUniqueBaseName($validatedFile['safeBaseName']),
                $validatedFile['extension'],
            );
            $path = $targetDirectory . DIRECTORY_SEPARATOR . $filename;

            try {
                $validatedFile['file']->moveTo($path);
            } catch (Throwable $exception) {
                throw new RuntimeException(
                    sprintf('Unable to save uploaded file %s.', $validatedFile['originalName']),
                    0,
                    $exception,
                );
            }

            $size = filesize($path);

            $savedFiles[] = [
                'name' => $validatedFile['originalName'],
                'path' => $this->relativePath($path),
                'size' => $size === false ? 0 : $size,
            ];
        }

        return [
            'files' => $savedFiles,
            'output' => $this->runUploadScript(),
        ];
    }

    /**
     * @param list<UploadedFileInterface> $files
     * @return list<array{file:UploadedFileInterface,originalName:string,safeBaseName:string,extension:string}>
     */
    private function validateFiles(array $files): array
    {
        $validatedFiles = [];

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

    private function buildTargetDirectory(): string
    {
        $directory = rtrim($this->photosDirectory, '/\\') . DIRECTORY_SEPARATOR . self::UPLOAD_DIRECTORY_NAME;

        if (!is_dir($directory) && !mkdir($directory, 0777, true) && !is_dir($directory)) {
            throw new RuntimeException('Unable to create the upload directory.');
        }

        if (!is_writable($directory)) {
            throw new RuntimeException('The upload directory is not writable.');
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

    private function relativePath(string $path): string
    {
        $normalizedBase = str_replace('\\', '/', rtrim($this->photosDirectory, '/\\'));
        $normalizedPath = str_replace('\\', '/', $path);

        return ltrim(substr($normalizedPath, strlen($normalizedBase)), '/');
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
    private function runUploadScript(): array
    {
        $command = array_merge(
            $this->buildPythonCommandPrefix(),
            [
                $this->scriptPath,
                '--dir',
                $this->photosDirectory,
                '--recursive',
                '--target',
                'all',
            ],
        );
        $descriptorSpec = [
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];
        $process = @proc_open($command, $descriptorSpec, $pipes, dirname($this->scriptPath));

        if (!is_resource($process)) {
            throw new RuntimeException('Python interpreter is unavailable.');
        }

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);
        $output = array_values(array_filter(
            preg_split('/\R/', trim((string) $stdout . "\n" . (string) $stderr)) ?: [],
            static fn (string $line): bool => trim($line) !== '',
        ));

        if ($exitCode === 127 || $exitCode === 9009) {
            throw new RuntimeException($output === [] ? 'Python interpreter is unavailable.' : "Python interpreter is unavailable:\n" . implode("\n", $output));
        }

        if ($exitCode !== 0) {
            throw new RuntimeException($output === [] ? 'Remote upload failed.' : "Remote upload failed:\n" . implode("\n", $output));
        }

        return $output;
    }
}
