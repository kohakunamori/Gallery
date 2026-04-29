export const IMAGE_CACHE_SERVICE_WORKER_URL = '/image-cache-sw.js';

export async function registerImageCacheServiceWorker(
  serviceWorker: Pick<ServiceWorkerContainer, 'register'> | undefined = globalThis.navigator?.serviceWorker,
): Promise<ServiceWorkerRegistration | null> {
  if (serviceWorker === undefined) {
    return null;
  }

  try {
    return await serviceWorker.register(IMAGE_CACHE_SERVICE_WORKER_URL);
  } catch {
    return null;
  }
}
