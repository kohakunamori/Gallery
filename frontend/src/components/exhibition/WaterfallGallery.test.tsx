import { describe, expect, it } from 'vitest';
import { distributePhotosIntoColumns, resolveColumnCount } from './WaterfallGallery';

const photos = [
  {
    id: 'one',
    filename: 'one.jpg',
    url: '/media/one.jpg',
    thumbnailUrl: '/media/one.jpg',
    takenAt: '2026-04-01T09:00:00Z',
    sortTime: '2026-04-01T09:00:00Z',
    width: 1000,
    height: 1500,
  },
  {
    id: 'two',
    filename: 'two.jpg',
    url: '/media/two.jpg',
    thumbnailUrl: '/media/two.jpg',
    takenAt: '2026-04-01T08:00:00Z',
    sortTime: '2026-04-01T08:00:00Z',
    width: 1600,
    height: 900,
  },
  {
    id: 'three',
    filename: 'three.jpg',
    url: '/media/three.jpg',
    thumbnailUrl: '/media/three.jpg',
    takenAt: '2026-04-01T07:00:00Z',
    sortTime: '2026-04-01T07:00:00Z',
    width: 1000,
    height: 1400,
  },
  {
    id: 'four',
    filename: 'four.jpg',
    url: '/media/four.jpg',
    thumbnailUrl: '/media/four.jpg',
    takenAt: '2026-04-01T06:00:00Z',
    sortTime: '2026-04-01T06:00:00Z',
    width: 1400,
    height: 1000,
  },
];

describe('WaterfallGallery helpers', () => {
  it('resolves auto column count from viewport width', () => {
    expect(resolveColumnCount(375, 'auto')).toBe(1);
    expect(resolveColumnCount(768, 'auto')).toBe(2);
    expect(resolveColumnCount(1200, 'auto')).toBe(3);
    expect(resolveColumnCount(1600, 'auto')).toBe(4);
    expect(resolveColumnCount(1200, 2)).toBe(2);
  });

  it('distributes photos into deterministic columns', () => {
    const columns = distributePhotosIntoColumns(photos, 2);

    expect(columns.map((column) => column.map((photo) => photo.id))).toEqual([
      ['one', 'four'],
      ['two', 'three'],
    ]);
  });

  it('keeps earlier placement stable when a later batch is appended', () => {
    const initialColumns = distributePhotosIntoColumns(photos.slice(0, 3), 2);
    const appendedColumns = distributePhotosIntoColumns(photos, 2);

    expect(initialColumns.map((column) => column.map((photo) => photo.id))).toEqual([
      ['one'],
      ['two', 'three'],
    ]);
    expect(appendedColumns.map((column) => column.map((photo) => photo.id))).toEqual([
      ['one', 'four'],
      ['two', 'three'],
    ]);
  });
});
