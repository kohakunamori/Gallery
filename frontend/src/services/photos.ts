import type { GalleryMediaSourcePreference } from '../components/exhibition/GallerySettingsModal';
import type { Photo } from '../types/photo';

export async function fetchPhotos(mediaSource: GalleryMediaSourcePreference): Promise<Photo[]> {
  const response = await fetch(`/api/photos?mediaSource=${encodeURIComponent(mediaSource)}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Photo[] };

  return payload.items;
}
