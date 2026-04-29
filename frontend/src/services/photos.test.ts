import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPhotos, resetPhotoRequestCache } from './photos';

const samplePhoto = {
  id: 'photo-1',
  filename: 'fresh.jpg',
  url: '/media/fresh.jpg',
  thumbnailUrl: '/media/fresh.jpg',
  takenAt: '2026-03-31T09:00:00+00:00',
  sortTime: '2026-03-31T09:00:00+00:00',
  width: 1200,
  height: 800,
};

describe('fetchPhotos', () => {
  afterEach(() => {
    resetPhotoRequestCache();
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPhotos('r2')).resolves.toEqual([samplePhoto]);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/api/photos?mediaSource=r2', window.location.origin).toString(), { signal: expect.any(AbortSignal) });
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchPhotos('local')).rejects.toThrow('Request failed with status 500');
  });

  it('uses an internal abort signal when the caller does not provide one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchPhotos('r2');

    expect(fetchMock).toHaveBeenCalledWith(new URL('/api/photos?mediaSource=r2', window.location.origin).toString(), { signal: expect.any(AbortSignal) });
  });

  it('deduplicates concurrent requests for the same media source', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const [firstResult, secondResult] = await Promise.all([fetchPhotos('r2'), fetchPhotos('r2')]);

    expect(firstResult).toEqual([samplePhoto]);
    expect(secondResult).toEqual([samplePhoto]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a fulfilled response for the same media source', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchPhotos('r2');
    await fetchPhotos('r2');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
