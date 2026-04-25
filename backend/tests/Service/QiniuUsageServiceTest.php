<?php

declare(strict_types=1);

namespace Gallery\Tests\Service;

use Gallery\Service\QiniuUsageService;
use PHPUnit\Framework\TestCase;
use RuntimeException;

final class QiniuUsageServiceTest extends TestCase
{
    public function test_it_returns_a_stale_successful_cache_when_refresh_fails(): void
    {
        $cachePath = sys_get_temp_dir() . '/qiniu-usage-cache-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents(
            $cachePath,
            json_encode([
                'expiresAt' => time() - 5,
                'value' => [
                    'period' => '2026-04',
                    'usedBytes' => 1024,
                    'quotaBytes' => 10 * 1024 * 1024 * 1024,
                    'remainingBytes' => (10 * 1024 * 1024 * 1024) - 1024,
                    'isDisabled' => false,
                    'isAvailable' => true,
                    'status' => 'available',
                    'lastUpdatedAt' => '2026-04-07T00:00:00+00:00',
                    'message' => null,
                ],
            ], JSON_THROW_ON_ERROR),
        );

        $service = new QiniuUsageService(
            'ak',
            'sk',
            'bucket',
            'cdn.example.com',
            'api.qiniuapi.com',
            $cachePath,
            900,
            10 * 1024 * 1024 * 1024,
            static function (): string {
                throw new RuntimeException('Qiniu usage request failed with status 401.');
            },
        );

        $status = $service->getUsageStatus();

        self::assertSame('available', $status['status']);
        self::assertTrue($status['isAvailable']);
        self::assertFalse($status['isDisabled']);
        self::assertSame(1024, $status['usedBytes']);
    }

    public function test_it_ignores_a_stale_unavailable_cache_and_retries_fetching(): void
    {
        $cachePath = sys_get_temp_dir() . '/qiniu-usage-cache-' . bin2hex(random_bytes(4)) . '.json';
        file_put_contents(
            $cachePath,
            json_encode([
                'expiresAt' => time() - 5,
                'value' => [
                    'period' => '2026-04',
                    'usedBytes' => 0,
                    'quotaBytes' => 10 * 1024 * 1024 * 1024,
                    'remainingBytes' => 10 * 1024 * 1024 * 1024,
                    'isDisabled' => true,
                    'isAvailable' => false,
                    'status' => 'unavailable',
                    'lastUpdatedAt' => '2026-04-07T00:00:00+00:00',
                    'message' => 'Qiniu usage request failed with status 401.',
                ],
            ], JSON_THROW_ON_ERROR),
        );

        $service = new QiniuUsageService(
            'ak',
            'sk',
            'bucket',
            'cdn.example.com',
            'api.qiniuapi.com',
            $cachePath,
            900,
            10 * 1024 * 1024 * 1024,
            static fn (): string => json_encode([
                [
                    'values' => [
                        'flow' => 2048,
                    ],
                ],
            ], JSON_THROW_ON_ERROR),
        );

        $status = $service->getUsageStatus();

        self::assertSame('available', $status['status']);
        self::assertTrue($status['isAvailable']);
        self::assertFalse($status['isDisabled']);
        self::assertSame(2048, $status['usedBytes']);
    }
}
