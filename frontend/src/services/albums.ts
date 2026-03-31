import type { Album } from '../types/album';

export async function fetchAlbums(): Promise<Album[]> {
  const response = await fetch('/api/albums');

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { items: Album[] };

  return payload.items;
}
