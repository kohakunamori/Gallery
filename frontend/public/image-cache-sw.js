const CACHE_NAME_PREFIX = 'gallery-remote-image-cache';
const CACHE_NAME = `${CACHE_NAME_PREFIX}-v2`;
const IMAGE_CACHE_PROBE_QUERY_PARAM = 'cacheProbe';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith(CACHE_NAME_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (!shouldHandleRequest(event.request)) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);

      if (cachedResponse !== undefined) {
        return cachedResponse;
      }

      const cacheableResponse = await fetchCacheableImageResponse(event.request);

      if (cacheableResponse !== null) {
        await cache.put(event.request, cacheableResponse.clone());
        return cacheableResponse;
      }

      return fetch(event.request);
    })(),
  );
});

async function fetchCacheableImageResponse(request) {
  try {
    const response = await fetch(request.url, {
      credentials: 'omit',
      mode: 'cors',
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type');

    if (contentType !== null && !contentType.startsWith('image/')) {
      return null;
    }

    return response;
  } catch {
    return null;
  }
}

function shouldHandleRequest(request) {
  if (request.method !== 'GET' || request.destination !== 'image') {
    return false;
  }

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  if (url.searchParams.has(IMAGE_CACHE_PROBE_QUERY_PARAM)) {
    return false;
  }

  return url.searchParams.has('v');
}
