import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPhotos } from './uploadPhotos';

describe('uploadPhotos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts selected files to the upload endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        files: [{ name: 'fresh.avif', path: 'uploads/fresh.avif', size: 12 }],
        output: ['uploaded'],
      }),
    });
    const controller = new AbortController();
    const file = new File(['body'], 'fresh.avif', { type: 'image/avif' });

    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadPhotos([file], controller.signal)).resolves.toEqual({
      files: [{ name: 'fresh.avif', path: 'uploads/fresh.avif', size: 12 }],
      output: ['uploaded'],
    });

    expect(fetchMock).toHaveBeenCalledWith('/upload', {
      method: 'POST',
      body: expect.any(FormData),
      signal: controller.signal,
    });
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.getAll('files')).toEqual([file]);
  });

  it('throws backend validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Unsupported image format: notes.txt' }),
      }),
    );

    await expect(uploadPhotos([new File(['notes'], 'notes.txt')])).rejects.toThrow(
      'Unsupported image format: notes.txt',
    );
  });

  it('uses a status error when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('bad json');
        },
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).rejects.toThrow('Upload failed with status 502');
  });
});
