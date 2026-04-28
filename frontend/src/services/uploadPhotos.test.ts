import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadPhotos } from './uploadPhotos';

function streamResponse(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

describe('uploadPhotos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts selected files to the upload endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
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

  it('sends an upload token when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({ files: [], output: [] }),
    });

    vi.stubGlobal('fetch', fetchMock);

    await uploadPhotos([new File(['body'], 'fresh.avif')], { uploadToken: ' secret ' });

    expect(fetchMock).toHaveBeenCalledWith('/upload', expect.objectContaining({
      headers: { 'X-Upload-Token': 'secret' },
    }));
  });

  it('streams script output and resolves with the complete event', async () => {
    const onOutput = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse([
          JSON.stringify({ type: 'output', stream: 'stdout', line: 'uploading r2' }) + '\n',
          JSON.stringify({
            type: 'complete',
            files: [{ name: 'fresh.webp', path: 'uploads/fresh.webp', size: 4 }],
            output: ['uploading r2'],
          }) + '\n',
        ]),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')], { onOutput })).resolves.toEqual({
      files: [{ name: 'fresh.webp', path: 'uploads/fresh.webp', size: 4 }],
      output: ['uploading r2'],
    });
    expect(onOutput).toHaveBeenCalledWith('uploading r2', 'stdout');
  });

  it('parses ndjson events split across chunk boundaries', async () => {
    const completeEvent = JSON.stringify({
      type: 'complete',
      files: [{ name: 'fresh.webp', path: 'uploads/fresh.webp', size: 4 }],
      output: [],
    }) + '\n';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse([completeEvent.slice(0, 20), completeEvent.slice(20)]),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).resolves.toEqual({
      files: [{ name: 'fresh.webp', path: 'uploads/fresh.webp', size: 4 }],
      output: [],
    });
  });

  it('reports invalid html lines in upload streams', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse(['<br /> Fatal error\n']),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).rejects.toThrow(
      'Upload stream returned a server error: Fatal error',
    );
  });

  it('rejects malformed upload stream events', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse([JSON.stringify({ type: 'complete', files: [{ name: 'fresh.webp' }] }) + '\n']),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).rejects.toThrow(
      'Upload stream contained an invalid complete event.',
    );
  });

  it('retains only the latest streamed output lines', async () => {
    const outputEvents = Array.from({ length: 502 }, (_, index) => (
      JSON.stringify({ type: 'output', line: `line-${index}` }) + '\n'
    ));

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse([
          ...outputEvents,
          JSON.stringify({ type: 'complete', files: [], output: undefined }) + '\n',
        ]),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).resolves.toEqual({
      files: [],
      output: expect.arrayContaining(['line-2', 'line-501']),
    });
  });

  it('rejects terminal stream errors after emitting script output', async () => {
    const onOutput = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Type': 'application/x-ndjson' }),
        body: streamResponse([
          JSON.stringify({ type: 'output', stream: 'stderr', line: 'remote failed' }) + '\n',
          JSON.stringify({ type: 'error', error: 'Remote upload failed. Continue reading logs.' }) + '\n',
        ]),
      }),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')], { onOutput })).rejects.toThrow(
      'Remote upload failed. Continue reading logs.',
    );
    expect(onOutput).toHaveBeenCalledWith('remote failed', 'stderr');
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

  it('shows text from non-json error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<br /> Fatal error', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      })),
    );

    await expect(uploadPhotos([new File(['body'], 'fresh.webp')])).rejects.toThrow('Fatal error');
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
