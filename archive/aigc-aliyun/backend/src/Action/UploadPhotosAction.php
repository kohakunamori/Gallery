<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Http\CallbackStream;
use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoUploadService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\UploadedFileInterface;
use Throwable;

final class UploadPhotosAction
{
    public function __construct(
        private readonly PhotoUploadService $uploadService,
        private readonly PhotoCacheInterface $photoCache,
        private readonly ?string $accessToken = null,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        if ($request->getHeaderLine('Sec-Fetch-Site') === 'cross-site') {
            return $this->jsonError($response, 403, 'Cross-site uploads are not allowed.');
        }

        if (!$this->isAuthorized($request)) {
            return $this->jsonError($response, 401, 'Upload token is required or invalid.');
        }

        $files = $this->extractFiles($request->getUploadedFiles());

        try {
            $uploadBatch = $this->uploadService->prepareUpload($files);
        } catch (Throwable $exception) {
            return $this->jsonError($response, 400, $exception->getMessage());
        }

        $stream = new CallbackStream(function () use ($uploadBatch): \Generator {
            $output = [];
            $savedFiles = $uploadBatch['files'];
            $temporaryDirectory = $uploadBatch['temporaryDirectory'];

            try {
                foreach ($savedFiles as $file) {
                    yield $this->encodeStreamEvent(['type' => 'file', 'file' => $file]);
                }

                try {
                    foreach ($this->uploadService->streamUploadScriptOutput($temporaryDirectory) as $event) {
                        $output[] = $event['line'];

                        yield $this->encodeStreamEvent([
                            'type' => 'output',
                            'stream' => $event['stream'],
                            'line' => $event['line'],
                        ]);
                    }

                    $this->photoCache->clear();

                    yield $this->encodeStreamEvent([
                        'type' => 'complete',
                        'files' => $savedFiles,
                        'output' => $output,
                    ]);
                } catch (Throwable $exception) {
                    yield $this->encodeStreamEvent([
                        'type' => 'error',
                        'error' => $exception->getMessage(),
                        'output' => $output,
                    ]);
                }
            } finally {
                $this->uploadService->removeTemporaryDirectory($temporaryDirectory);
            }
        });

        return $response
            ->withBody($stream)
            ->withHeader('Content-Type', 'application/x-ndjson')
            ->withHeader('Cache-Control', 'no-cache')
            ->withHeader('X-Accel-Buffering', 'no');
    }

    private function isAuthorized(Request $request): bool
    {
        if ($this->accessToken === null || $this->accessToken === '') {
            return true;
        }

        $providedToken = $request->getHeaderLine('X-Upload-Token');
        $authorizationHeader = $request->getHeaderLine('Authorization');

        if (str_starts_with($authorizationHeader, 'Bearer ')) {
            $providedToken = substr($authorizationHeader, 7);
        }

        return $providedToken !== '' && hash_equals($this->accessToken, $providedToken);
    }

    private function jsonError(Response $response, int $status, string $message): Response
    {
        $response->getBody()->write(
            json_encode(['error' => $message], JSON_THROW_ON_ERROR),
        );

        return $response
            ->withStatus($status)
            ->withHeader('Content-Type', 'application/json');
    }

    /**
     * @param array<string,mixed> $event
     */
    private function encodeStreamEvent(array $event): string
    {
        return json_encode($event, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE) . "\n";
    }

    /**
     * @param array<string, mixed> $uploadedFiles
     * @return list<UploadedFileInterface>
     */
    private function extractFiles(array $uploadedFiles): array
    {
        $files = [];

        foreach (['files', 'file'] as $fieldName) {
            $fieldFiles = $uploadedFiles[$fieldName] ?? [];
            array_push($files, ...$this->collectUploadedFiles($fieldFiles));
        }

        return $files;
    }

    /**
     * @return list<UploadedFileInterface>
     */
    private function collectUploadedFiles(mixed $value): array
    {
        if ($value instanceof UploadedFileInterface) {
            return [$value];
        }

        if (!is_array($value)) {
            return [];
        }

        $files = [];

        foreach ($value as $item) {
            array_push($files, ...$this->collectUploadedFiles($item));
        }

        return $files;
    }
}
