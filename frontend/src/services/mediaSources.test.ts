import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaSourceStatuses, resetMediaSourceStatusRequestCache } from './mediaSources';

const sampleStatuses = [
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
] as const;

describe('fetchMediaSourceStatuses', () => {
  afterEach(() => {
    resetMediaSourceStatusRequestCache();
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: sampleStatuses,
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchMediaSourceStatuses()).resolves.toEqual(sampleStatuses);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/api/media-sources', window.location.origin).toString(), { signal: expect.any(AbortSignal) });
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

  it('deduplicates concurrent requests for media source statuses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: sampleStatuses,
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const [firstResult, secondResult] = await Promise.all([fetchMediaSourceStatuses(), fetchMediaSourceStatuses()]);

    expect(firstResult).toEqual(sampleStatuses);
    expect(secondResult).toEqual(sampleStatuses);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a fulfilled response within the same session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: sampleStatuses,
      }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchMediaSourceStatuses();
    await fetchMediaSourceStatuses();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
