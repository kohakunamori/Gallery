import { describe, expect, it } from 'vitest';
import type { Photo } from '../types/photo';
import {
  buildAlbumPath,
  filterPhotosByAlbum,
  photoBelongsToAlbum,
  resolveAppRoute,
} from './albumRoute';

const samplePhoto = (url: string, id = 'p1'): Photo => ({
  id,
  filename: 'shot.jpg',
  url,
  thumbnailUrl: url,
  takenAt: null,
  sortTime: '2026-03-31T09:00:00Z',
  width: 1200,
  height: 800,
});

describe('resolveAppRoute', () => {
  it('routes exhibition, upload, and albums list', () => {
    expect(resolveAppRoute('/')).toEqual({ name: 'exhibition' });
    expect(resolveAppRoute('/upload')).toEqual({ name: 'upload' });
    expect(resolveAppRoute('/albums')).toEqual({ name: 'albums' });
    expect(resolveAppRoute('/albums/')).toEqual({ name: 'albums' });
  });

  it('routes album detail from path id (decoded)', () => {
    expect(resolveAppRoute('/albums/travel')).toEqual({ name: 'album-detail', albumId: 'travel' });
    expect(resolveAppRoute('/albums/summer%20trip')).toEqual({
      name: 'album-detail',
      albumId: 'summer trip',
    });
  });

  it('prefers ?album= query as soft fallback on /albums', () => {
    expect(resolveAppRoute('/albums', '?album=travel')).toEqual({
      name: 'album-detail',
      albumId: 'travel',
    });
  });
});

describe('buildAlbumPath', () => {
  it('encodes the album id for path deep links', () => {
    expect(buildAlbumPath('travel')).toBe('/albums/travel');
    expect(buildAlbumPath('summer trip')).toBe('/albums/summer%20trip');
  });
});

describe('photoBelongsToAlbum', () => {
  it('matches album id as a directory segment in the media URL', () => {
    const travel = samplePhoto('https://r2.example.com/gallery/travel/beach%20day.jpg?v=1', 'a');
    const other = samplePhoto('https://r2.example.com/gallery/home/desk.jpg?v=2', 'b');
    const root = samplePhoto('https://r2.example.com/gallery/solo.jpg?v=3', 'c');

    expect(photoBelongsToAlbum(travel, 'travel')).toBe(true);
    expect(photoBelongsToAlbum(other, 'travel')).toBe(false);
    expect(photoBelongsToAlbum(root, 'travel')).toBe(false);
  });

  it('filters a photo list by album id', () => {
    const photos = [
      samplePhoto('https://r2.example.com/gallery/travel/a.jpg?v=1', 'a'),
      samplePhoto('https://r2.example.com/gallery/home/b.jpg?v=2', 'b'),
      samplePhoto('https://r2.example.com/gallery/travel/c.jpg?v=3', 'c'),
    ];

    expect(filterPhotosByAlbum(photos, 'travel').map((photo) => photo.id)).toEqual(['a', 'c']);
  });
});
