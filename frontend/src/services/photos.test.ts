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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [samplePhoto] }),
      }),
    );

    await expect(fetchPhotos()).resolves.toEqual([samplePhoto]);
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
});
