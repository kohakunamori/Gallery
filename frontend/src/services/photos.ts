import type { Photo } from '../types/photo';
import { createSessionRequestCache } from './requestCache';

const photosRequestCache = createSessionRequestCache<Photo[]>();
const PHOTOS_CACHE_KEY = 'default';

function getPhotosApiUrl() {
  const path = '/api/photos';

  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
}

export function resetPhotoRequestCache() {
  photosRequestCache.reset();
}

export function fetchPhotos(signal?: AbortSignal): Promise<Photo[]> {
  return photosRequestCache.read(
    PHOTOS_CACHE_KEY,
    async (sharedSignal) => {
      const response = await fetch(getPhotosApiUrl(), { signal: sharedSignal });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { items: Photo[] };

      return payload.items;
    },
    signal,
  );
}
