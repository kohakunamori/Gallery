import { describe, expect, it, vi } from 'vitest';
import { IMAGE_CACHE_SERVICE_WORKER_URL, registerImageCacheServiceWorker } from './imageCacheServiceWorker';

describe('registerImageCacheServiceWorker', () => {
  it('registers the image cache service worker when supported', async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    await expect(registerImageCacheServiceWorker({ register })).resolves.toBe(registration);
    expect(register).toHaveBeenCalledWith(IMAGE_CACHE_SERVICE_WORKER_URL);
  });

  it('returns null when service workers are unavailable', async () => {
    await expect(registerImageCacheServiceWorker(undefined)).resolves.toBeNull();
  });

  it('returns null when registration fails', async () => {
    const register = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(registerImageCacheServiceWorker({ register })).resolves.toBeNull();
  });
});
