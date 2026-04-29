import type { GalleryConcreteMediaSource } from '../utils/gallerySettings';
import type { Photo } from '../types/photo';
import { createSessionRequestCache } from './requestCache';

const photosRequestCache = createSessionRequestCache<Photo[]>();

function getPhotosApiUrl(mediaSource: GalleryConcreteMediaSource) {
  const path = `/api/photos?mediaSource=${encodeURIComponent(mediaSource)}`;

  return typeof window === 'undefined' ? path : new URL(path, window.location.origin).toString();
}

export function resetPhotoRequestCache() {
  photosRequestCache.reset();
}

export function fetchPhotos(mediaSource: GalleryConcreteMediaSource, signal?: AbortSignal): Promise<Photo[]> {
  return photosRequestCache.read(
    mediaSource,
    async (sharedSignal) => {
      const response = await fetch(getPhotosApiUrl(mediaSource), { signal: sharedSignal });

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as { items: Photo[] };

      return payload.items;
    },
    signal,
  );
}
