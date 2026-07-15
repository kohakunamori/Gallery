import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAlbums } from './albums';

const sampleAlbum = {
  id: 'travel',
  name: 'travel',
  coverUrl: '/media/travel/cover.jpg',
  photoCount: 3,
  latestSortTime: '2026-03-31T09:00:00+00:00',
};

describe('fetchAlbums', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the items array from the API payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [sampleAlbum] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchAlbums()).resolves.toEqual([sampleAlbum]);
    expect(fetchMock).toHaveBeenCalledWith('/api/albums');
  });

  it('throws on non-ok responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    await expect(fetchAlbums()).rejects.toThrow('Request failed with status 500');
  });
});
