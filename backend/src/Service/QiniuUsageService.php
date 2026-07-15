<?php

declare(strict_types=1);

namespace Gallery\Service;

use Closure;
use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;

final class QiniuUsageService
{
    private const DEFAULT_API_HOST = 'api.qiniuapi.com';
    private const DEFAULT_CACHE_TTL_SECONDS = 900;
    private const DEFAULT_QUOTA_BYTES = 10737418240;
    private const BILLING_TIMEZONE = 'Asia/Shanghai';

    /**
     * @param Closure(string, list<string>): string|null $requestHandler
     */
    public function __construct(
        private readonly string $accessKey,
        private readonly string $secretKey,
        private readonly string $bucket,
        private readonly ?string $domain = null,
        private readonly string $apiHost = self::DEFAULT_API_HOST,
        private readonly ?string $cachePath = null,
        private readonly int $cacheTtlSeconds = self::DEFAULT_CACHE_TTL_SECONDS,
        private readonly int $quotaBytes = self::DEFAULT_QUOTA_BYTES,
        private readonly ?Closure $requestHandler = null,
    ) {
    }

    /**
     * @return array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string}
     */
    public function getUsageStatus(): array
    {
        $cached = $this->readCache();

        if ($cached !== null && $cached['expiresAt'] >= time()) {
            return $cached['value'];
        }

        try {
            $status = $this->fetchUsageStatus();
            $this->writeCache($status);

            return $status;
        } catch (\Throwable $exception) {
            if ($cached !== null && $this->canUseStaleCacheOnFailure($cached['value'])) {
                return $cached['value'];
            }

            return $this->buildUnavailableStatus($exception->getMessage());
        }
    }

    /**
     * @return array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string}
     */
    private function fetchUsageStatus(): array
    {
        $now = new DateTimeImmutable('now', new DateTimeZone(self::BILLING_TIMEZONE));
        $periodStart = $now->modify('first day of this month')->setTime(0, 0, 0);
        $query = $this->buildQuery([
            'begin' => $periodStart->format('YmdHis'),
            'end' => $now->format('YmdHis'),
            'g' => 'month',
            'select' => 'flow',
            '$metric' => 'flow_out',
            '$bucket' => $this->bucket,
            '$domain' => $this->domain,
        ]);
        $requestTarget = '/v6/blob_io?' . $query;
        $xQiniuDate = gmdate('Ymd\THis\Z');
        $headers = [
            'Host: ' . $this->apiHost,
            'X-Qiniu-Date: ' . $xQiniuDate,
            'Authorization: ' . $this->buildAuthorizationHeader($requestTarget, $xQiniuDate),
        ];

        $body = $this->sendRequest($requestTarget, $headers);
        $payload = json_decode($body, true, 512, JSON_THROW_ON_ERROR);

        if (!is_array($payload)) {
            throw new RuntimeException('Unexpected Qiniu usage response payload.');
        }

        $usedBytes = 0;

        foreach ($payload as $row) {
            if (!is_array($row)) {
                continue;
            }

            $flow = $row['values']['flow'] ?? null;

            if (is_int($flow) || is_float($flow) || (is_string($flow) && is_numeric($flow))) {
                $usedBytes += (int) $flow;
            }
        }

        $isDisabled = $usedBytes >= $this->quotaBytes;

        return [
            'period' => $periodStart->format('Y-m'),
            'usedBytes' => $usedBytes,
            'quotaBytes' => $this->quotaBytes,
            'remainingBytes' => max($this->quotaBytes - $usedBytes, 0),
            'isDisabled' => $isDisabled,
            'isAvailable' => !$isDisabled,
            'status' => $isDisabled ? 'over-quota' : 'available',
            'lastUpdatedAt' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DATE_ATOM),
            'message' => $isDisabled ? 'Qiniu monthly traffic quota has been reached.' : null,
        ];
    }

    private function buildAuthorizationHeader(string $requestTarget, string $xQiniuDate): string
    {
        $signingString = "GET {$requestTarget}\nHost: {$this->apiHost}\nX-Qiniu-Date: {$xQiniuDate}\n\n";
        $signature = hash_hmac('sha1', $signingString, $this->secretKey, true);

        return 'Qiniu ' . $this->accessKey . ':' . base64_encode($signature);
    }

    /**
     * @param array<string, scalar|null> $params
     */
    private function buildQuery(array $params): string
    {
        $parts = [];

        foreach ($params as $key => $value) {
            if ($value === null || $value === '') {
                continue;
            }

            $parts[] = $key . '=' . rawurlencode((string) $value);
        }

        return implode('&', $parts);
    }

    /**
     * @param list<string> $headers
     */
    private function sendRequest(string $requestTarget, array $headers): string
    {
        if ($this->requestHandler !== null) {
            $body = ($this->requestHandler)($requestTarget, $headers);

            if (!is_string($body)) {
                throw new RuntimeException('Qiniu usage handler returned a non-string response.');
            }

            return $body;
        }

        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'timeout' => 10,
            ],
        ]);

        $url = 'https://' . $this->apiHost . $requestTarget;
        $body = @file_get_contents($url, false, $context);
        $statusLine = $http_response_header[0] ?? '';

        if ($body === false || !preg_match('/\s(\d{3})\s/', $statusLine, $matches)) {
            throw new RuntimeException('Unable to fetch Qiniu usage data.');
        }

        if ((int) $matches[1] >= 400) {
            throw new RuntimeException('Qiniu usage request failed with status ' . $matches[1] . '.');
        }

        return $body;
    }

    /**
     * @return array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message:string}
     */
    private function buildUnavailableStatus(string $message): array
    {
        $periodStart = (new DateTimeImmutable('now', new DateTimeZone(self::BILLING_TIMEZONE)))
            ->modify('first day of this month')
            ->setTime(0, 0, 0);

        return [
            'period' => $periodStart->format('Y-m'),
            'usedBytes' => 0,
            'quotaBytes' => $this->quotaBytes,
            'remainingBytes' => $this->quotaBytes,
            'isDisabled' => true,
            'isAvailable' => false,
            'status' => 'unavailable',
            'lastUpdatedAt' => (new DateTimeImmutable('now', new DateTimeZone('UTC')))->format(DATE_ATOM),
            'message' => $message,
        ];
    }

    /**
     * @param array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string|null} $status
     */
    private function canUseStaleCacheOnFailure(array $status): bool
    {
        return $status['isAvailable'] && !$status['isDisabled'];
    }

    /**
     * @return array{expiresAt:int, value: array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string}}|null
     */
    private function readCache(): ?array
    {
        if ($this->cachePath === null || !is_file($this->cachePath)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($this->cachePath), true);

        if (!is_array($decoded) || !isset($decoded['expiresAt'], $decoded['value']) || !is_array($decoded['value'])) {
            return null;
        }

        if (($decoded['value']['status'] ?? null) === 'unavailable') {
            @unlink($this->cachePath);

            return null;
        }

        return [
            'expiresAt' => (int) $decoded['expiresAt'],
            'value' => $decoded['value'],
        ];
    }

    /**
     * @param array{period:string,usedBytes:int,quotaBytes:int,remainingBytes:int,isDisabled:bool,isAvailable:bool,status:string,lastUpdatedAt:string,message?:string|null} $status
     */
    private function writeCache(array $status): void
    {
        if ($this->cachePath === null) {
            return;
        }

        $directory = dirname($this->cachePath);

        if (!is_dir($directory)) {
            mkdir($directory, 0777, true);
        }

        file_put_contents(
            $this->cachePath,
            json_encode(
                [
                    'expiresAt' => time() + $this->cacheTtlSeconds,
                    'value' => $status,
                ],
                JSON_THROW_ON_ERROR,
            ),
        );
    }

}
