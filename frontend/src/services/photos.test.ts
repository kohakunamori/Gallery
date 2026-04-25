import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchPhotos } from './photos';

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
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });
    const controller = new AbortController();

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchPhotos('r2', controller.signal)).resolves.toEqual([samplePhoto]);
    expect(fetchMock).toHaveBeenCalledWith('/api/photos?mediaSource=r2', { signal: controller.signal });
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

  it('passes through an omitted abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [samplePhoto] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await fetchPhotos('r2');

    expect(fetchMock).toHaveBeenCalledWith('/api/photos?mediaSource=r2', { signal: undefined });
  });
});
