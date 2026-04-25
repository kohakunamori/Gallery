import type { GalleryConcreteMediaSource } from '../utils/gallerySettings';
import type { Photo } from '../types/photo';

export async function fetchPhotos(mediaSource: GalleryConcreteMediaSource, signal?: AbortSignal): Promise<Photo[]> {
  const response = await fetch(`/api/photos?mediaSource=${encodeURIComponent(mediaSource)}`, { signal });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Photo[] };

  return payload.items;
}
