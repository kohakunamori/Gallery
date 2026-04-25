import { describe, expect, it } from 'vitest';
import { groupPhotosByMonth } from './groupPhotosByMonth';

const photos = [
  {
    id: 'march-b',
    filename: 'march-b.jpg',
    url: '/media/march-b.jpg',
    thumbnailUrl: '/media/march-b.jpg',
    takenAt: '2026-03-20T10:00:00Z',
    sortTime: '2026-03-20T10:00:00Z',
    width: 900,
    height: 1200,
  },
  {
    id: 'march-a',
    filename: 'march-a.jpg',
    url: '/media/march-a.jpg',
    thumbnailUrl: '/media/march-a.jpg',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1400,
    height: 900,
  },
  {
    id: 'february',
    filename: 'february.jpg',
    url: '/media/february.jpg',
    thumbnailUrl: '/media/february.jpg',
    takenAt: '2026-02-01T09:00:00Z',
    sortTime: '2026-02-01T09:00:00Z',
    width: 1000,
    height: 1000,
  },
];

describe('groupPhotosByMonth', () => {
  it('groups photos by month-year while preserving input order inside each group', () => {
    expect(groupPhotosByMonth(photos)).toEqual([
      {
        title: 'March 2026',
        photos: [photos[0], photos[1]],
      },
      {
        title: 'February 2026',
        photos: [photos[2]],
      },
    ]);
  });

  it('keeps month groups ordered newest first even when input order crosses months', () => {
    expect(groupPhotosByMonth([photos[2], photos[0], photos[1]])).toEqual([
      {
        title: 'March 2026',
        photos: [photos[0], photos[1]],
      },
      {
        title: 'February 2026',
        photos: [photos[2]],
      },
    ]);
  });

  it('returns an empty array when no photos are provided', () => {
    expect(groupPhotosByMonth([])).toEqual([]);
  });
});
