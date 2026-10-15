<?php

declare(strict_types=1);

namespace Gallery\Service;

final class MediaSourceAvailabilityService
{
    /**
     * @param array<string, string> $mediaBaseUrls
     */
    public function __construct(
        private readonly array $mediaBaseUrls,
        private readonly ?QiniuUsageService $qiniuUsageService = null,
    ) {
    }

    /**
     * @return list<string>
     */
    public function getSupportedSources(): array
    {
        return ['r2', 'qiniu', 'local'];
    }

    public function isSupported(string $mediaSource): bool
    {
        return in_array($mediaSource, $this->getSupportedSources(), true);
    }

    public function isAvailable(string $mediaSource): bool
    {
        return $this->getSourceStatus($mediaSource)['isAvailable'];
    }

    public function resolveMediaBaseUrl(string $mediaSource): string
    {
        if (!$this->isSupported($mediaSource)) {
            return $this->mediaBaseUrls['r2'] ?? '/media';
        }

        if ($mediaSource === 'qiniu' && !$this->isAvailable('qiniu')) {
            return $this->mediaBaseUrls['r2'] ?? '/media';
        }

        return $this->mediaBaseUrls[$mediaSource] ?? ($this->mediaBaseUrls['r2'] ?? '/media');
    }

    /**
     * @return array{source:string,isAvailable:bool,isDisabled:bool,status:string,message?:string,usage?:array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string}}
     */
    public function getSourceStatus(string $mediaSource): array
    {
        if ($mediaSource === 'qiniu') {
            if ($this->qiniuUsageService === null || !isset($this->mediaBaseUrls['qiniu']) || $this->mediaBaseUrls['qiniu'] === '') {
                return [
                    'source' => 'qiniu',
                    'isAvailable' => false,
                    'isDisabled' => true,
                    'status' => 'unconfigured',
                    'message' => 'Qiniu media source is not configured.',
                ];
            }

            $usage = $this->qiniuUsageService->getUsageStatus();

            return [
                'source' => 'qiniu',
                'isAvailable' => $usage['isAvailable'],
                'isDisabled' => $usage['isDisabled'],
                'status' => $usage['status'],
                'message' => $usage['message'] ?? null,
                'usage' => $usage,
            ];
        }

        return [
            'source' => $mediaSource,
            'isAvailable' => isset($this->mediaBaseUrls[$mediaSource]) && $this->mediaBaseUrls[$mediaSource] !== '',
            'isDisabled' => false,
            'status' => 'available',
        ];
    }

    /**
     * @return list<array{source:string,isAvailable:bool,isDisabled:bool,status:string,message?:string,usage?:array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string}}>
     */
    public function getAllSourceStatuses(): array
    {
        return array_map(fn (string $source): array => $this->getSourceStatus($source), $this->getSupportedSources());
    }
}
