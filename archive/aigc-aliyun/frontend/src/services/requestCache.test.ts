import { describe, expect, it, vi } from 'vitest';
import { createSessionRequestCache } from './requestCache';

describe('createSessionRequestCache', () => {
  it('abandons the shared request after every subscriber aborts and starts a fresh request next time', async () => {
    const requestCache = createSessionRequestCache<string>();
    const sharedSignals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      sharedSignals.push(signal);

      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          },
          { once: true },
        );
      });
    });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const firstRead = requestCache.read('photos', load, firstController.signal);
    const secondRead = requestCache.read('photos', load, secondController.signal);

    expect(load).toHaveBeenCalledTimes(1);

    firstController.abort();

    await expect(firstRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignals[0]?.aborted).toBe(false);

    secondController.abort();

    await expect(secondRead).rejects.toMatchObject({ name: 'AbortError' });
    expect(sharedSignals[0]?.aborted).toBe(true);

    const freshLoad = vi.fn().mockResolvedValue('fresh');

    await expect(requestCache.read('photos', freshLoad)).resolves.toBe('fresh');
    expect(freshLoad).toHaveBeenCalledTimes(1);
  });

  it('aborts and discards an in-flight request when the cache resets', async () => {
    const requestCache = createSessionRequestCache<string>();
    let resolveFirstRead: ((value: string) => void) | undefined;
    let sharedSignal: AbortSignal | undefined;
    const load = vi.fn((signal: AbortSignal) => {
      sharedSignal = signal;

      return new Promise<string>((resolve) => {
        resolveFirstRead = resolve;
      });
    });

    const firstRead = requestCache.read('photos', load);

    expect(sharedSignal?.aborted).toBe(false);

    requestCache.reset();

    expect(sharedSignal?.aborted).toBe(true);

    resolveFirstRead?.('stale');

    await expect(firstRead).resolves.toBe('stale');

    const freshLoad = vi.fn().mockResolvedValue('fresh');

    await expect(requestCache.read('photos', freshLoad)).resolves.toBe('fresh');
    expect(freshLoad).toHaveBeenCalledTimes(1);
  });
});
