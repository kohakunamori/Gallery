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

    await expect(fetchPhotos()).resolves.toEqual([samplePhoto]);
    expect(fetchMock).toHaveBeenCalledWith(new URL('/api/photos', window.location.origin).toString(), {
      signal: expect.any(AbortSignal),
    });
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchPhotos()).rejects.toThrow('Request failed with status 500');
  });

  it('uses an internal abort signal when the caller does not provide one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchPhotos();

    expect(fetchMock).toHaveBeenCalledWith(new URL('/api/photos', window.location.origin).toString(), {
      signal: expect.any(AbortSignal),
    });
  });

  it('deduplicates concurrent requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    const [firstResult, secondResult] = await Promise.all([fetchPhotos(), fetchPhotos()]);

    expect(firstResult).toEqual([samplePhoto]);
    expect(secondResult).toEqual([samplePhoto]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a fulfilled response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchPhotos();
    await fetchPhotos();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches again after resetPhotoRequestCache clears the session cache', async () => {
    const firstPhoto = { ...samplePhoto, id: 'photo-1' };
    const secondPhoto = { ...samplePhoto, id: 'photo-2', filename: 'after-upload.jpg' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [firstPhoto] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [secondPhoto] }),
      });

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPhotos()).resolves.toEqual([firstPhoto]);
    resetPhotoRequestCache();
    await expect(fetchPhotos()).resolves.toEqual([secondPhoto]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
