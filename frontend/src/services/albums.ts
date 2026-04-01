import type { GalleryMediaSourcePreference } from '../components/exhibition/GallerySettingsModal';
import type { Album } from '../types/album';

export async function fetchAlbums(mediaSource: GalleryMediaSourcePreference): Promise<Album[]> {
  const response = await fetch(`/api/albums?mediaSource=${encodeURIComponent(mediaSource)}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Album[] };

  return payload.items;
}
