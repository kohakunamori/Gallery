import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaSourceStatuses } from './mediaSources';

describe('fetchMediaSourceStatuses', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            source: 'qiniu',
            isAvailable: false,
            isDisabled: true,
            status: 'over-quota',
            usage: {
              period: '2026-04',
              usedBytes: 11,
              quotaBytes: 10,
              remainingBytes: 0,
              isDisabled: true,
              isAvailable: false,
              status: 'over-quota',
              lastUpdatedAt: '2026-04-06T00:00:00Z',
            },
          },
        ],
      }),
    });
    const controller = new AbortController();

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMediaSourceStatuses(controller.signal)).resolves.toEqual([
      {
        source: 'qiniu',
        isAvailable: false,
        isDisabled: true,
        status: 'over-quota',
        usage: {
          period: '2026-04',
          usedBytes: 11,
          quotaBytes: 10,
          remainingBytes: 0,
          isDisabled: true,
          isAvailable: false,
          status: 'over-quota',
          lastUpdatedAt: '2026-04-06T00:00:00Z',
        },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/media-sources', { signal: controller.signal });
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchMediaSourceStatuses()).rejects.toThrow('Request failed with status 500');
  });
});
