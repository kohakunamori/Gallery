import type { Photo } from '../types/photo';

/**
 * Albums deep-link strategy (no router library; path routing in App.tsx):
 * - `/albums` — album list
 * - `/albums/{id}` — album detail wall (`id` is album.id, URL-encoded)
 * - Soft fallback: `/albums?album={id}` still opens detail, but path form is preferred
 *
 * Exhibition remains `/`. Upload remains `/upload`.
 * Photo deep links (`?photo=`) from exhibition are preserved and not used on album routes.
 */

export type AppRoute =
  | { name: 'exhibition' }
  | { name: 'upload' }
  | { name: 'albums' }
  | { name: 'album-detail'; albumId: string };

function normalizePathname(pathname: string): string {
  if (pathname === '') {
    return '/';
  }

  if (pathname !== '/' && pathname.endsWith('/')) {
    return pathname.replace(/\/+$/, '') || '/';
  }

  return pathname;
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function buildAlbumPath(albumId: string): string {
  return `/albums/${encodeURIComponent(albumId)}`;
}

export function resolveAppRoute(pathname: string, search = ''): AppRoute {
  const path = normalizePathname(pathname);

  if (path === '/upload') {
    return { name: 'upload' };
  }

  if (path === '/albums') {
    const albumFromQuery = new URLSearchParams(search).get('album')?.trim() ?? '';

    if (albumFromQuery !== '') {
      return { name: 'album-detail', albumId: albumFromQuery };
    }

    return { name: 'albums' };
  }

  if (path.startsWith('/albums/')) {
    const remainder = path.slice('/albums/'.length);
    const encodedId = remainder.split('/').filter(Boolean)[0] ?? '';
    const albumId = decodePathSegment(encodedId).trim();

    if (albumId !== '') {
      return { name: 'album-detail', albumId };
    }

    return { name: 'albums' };
  }

  return { name: 'exhibition' };
}

/**
 * Album id is the first directory segment of a catalog relative path
 * (`AlbumIndexService`). Photo payloads only expose that segment inside media URLs
 * (e.g. `…/gallery/travel/beach%20day.jpg`), not as a dedicated field.
 */
export function photoBelongsToAlbum(photo: Photo, albumId: string): boolean {
  const target = albumId.trim();

  if (target === '') {
    return false;
  }

  try {
    const pathname = new URL(photo.url, 'https://example.invalid').pathname;
    const segments = pathname
      .split('/')
      .filter(Boolean)
      .map(decodePathSegment);

    // Directory segment before the filename (and any intermediate folders).
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index] === target) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function filterPhotosByAlbum(photos: Photo[], albumId: string): Photo[] {
  return photos.filter((photo) => photoBelongsToAlbum(photo, albumId));
}
