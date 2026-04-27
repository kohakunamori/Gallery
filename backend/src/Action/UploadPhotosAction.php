<?php

declare(strict_types=1);

namespace Gallery\Action;

use Gallery\Service\PhotoCacheInterface;
use Gallery\Service\PhotoUploadService;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Message\UploadedFileInterface;
use RuntimeException;

final class UploadPhotosAction
{
    public function __construct(
        private readonly PhotoUploadService $uploadService,
        private readonly PhotoCacheInterface $photoCache,
    ) {
    }

    public function __invoke(Request $request, Response $response): Response
    {
        $files = $this->extractFiles($request->getUploadedFiles());

        try {
            $result = $this->uploadService->upload($files);
            $this->photoCache->clear();
        } catch (RuntimeException $exception) {
            $response->getBody()->write(
                json_encode(['error' => $exception->getMessage()], JSON_THROW_ON_ERROR),
            );

            return $response
                ->withStatus(400)
                ->withHeader('Content-Type', 'application/json');
        }

        $response->getBody()->write(json_encode($result, JSON_THROW_ON_ERROR));

        return $response->withHeader('Content-Type', 'application/json');
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
