import { afterEach, describe, expect, it, vi } from 'vitest';
import { sortPhotos } from './sortPhotos';

const photos = [
  {
    id: 'b',
    filename: 'b.jpg',
    url: '/media/b.jpg',
    thumbnailUrl: '/media/b.jpg',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1200,
    height: 800,
  },
  {
    id: 'a',
    filename: 'a.jpg',
    url: '/media/a.jpg',
    thumbnailUrl: '/media/a.jpg',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1200,
    height: 800,
  },
  {
    id: 'c',
    filename: 'c.jpg',
    url: '/media/c.jpg',
    thumbnailUrl: '/media/c.jpg',
    takenAt: '2026-02-28T09:00:00Z',
    sortTime: '2026-02-28T09:00:00Z',
    width: 1200,
    height: 800,
  },
];

describe('sortPhotos', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts newest first by default mode', () => {
    expect(sortPhotos(photos, 'newest').map((photo) => photo.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts oldest first', () => {
    expect(sortPhotos(photos, 'oldest').map((photo) => photo.id)).toEqual(['c', 'a', 'b']);
  });

  it('sorts filename ascending', () => {
    expect(sortPhotos(photos, 'filename-asc').map((photo) => photo.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts filename descending', () => {
    expect(sortPhotos(photos, 'filename-desc').map((photo) => photo.id)).toEqual(['c', 'b', 'a']);
  });

  it('keeps month groups newest first while shuffling photos within each month', () => {
    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9);

    expect(sortPhotos(photos, 'random').map((photo) => photo.id)).toEqual(['b', 'a', 'c']);
  });
});
