import { describe, expect, it } from 'vitest';
import {
  distributePhotosIntoColumns,
  getImageRootMargin,
  getLoadMoreCount,
  getLoadTriggerRootMargin,
  getPreloadPhotoIds,
  getPreloadWindowSize,
  resolveColumnCount,
  shouldReleaseOffscreenImages,
} from './WaterfallGallery';

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
    expect(resolveColumnCount(1200, 6)).toBe(6);
  });

  it('clamps fixed column counts into the supported range', () => {
    expect(resolveColumnCount(1200, 0)).toBe(1);
    expect(resolveColumnCount(1200, 99)).toBe(8);
    expect(distributePhotosIntoColumns(photos, 99)).toHaveLength(8);
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

  it('uses a larger preload window sized by column count', () => {
    expect(getPreloadWindowSize(1)).toBe(4);
    expect(getPreloadWindowSize(2)).toBe(4);
    expect(getPreloadWindowSize(3)).toBe(6);
    expect(getPreloadWindowSize(4)).toBe(6);
    expect(getPreloadWindowSize(5)).toBe(4);
    expect(getPreloadWindowSize(8)).toBe(2);
  });

  it('reduces lookahead and batch sizes for dense column layouts', () => {
    expect(getImageRootMargin(4)).toBe('1200px 0px');
    expect(getImageRootMargin(6)).toBe('600px 0px');
    expect(getImageRootMargin(8)).toBe('300px 0px');

    expect(getLoadTriggerRootMargin(4)).toBe('1200px 0px');
    expect(getLoadTriggerRootMargin(6)).toBe('800px 0px');
    expect(getLoadTriggerRootMargin(8)).toBe('400px 0px');

    expect(getLoadMoreCount(4)).toBe(24);
    expect(getLoadMoreCount(6)).toBe(16);
    expect(getLoadMoreCount(8)).toBe(12);

    expect(shouldReleaseOffscreenImages(4)).toBe(false);
    expect(shouldReleaseOffscreenImages(8)).toBe(true);
  });

  it('preloads the next two unseen photos from each column after visible cards are seen', () => {
    const columns = distributePhotosIntoColumns(photos, 2);

    expect(getPreloadPhotoIds(columns, new Set(['one', 'two']), 4)).toEqual(['four', 'three']);
  });

  it('does not preload from untouched columns or beyond the cap', () => {
    const columns = distributePhotosIntoColumns(photos, 2);

    expect(getPreloadPhotoIds(columns, new Set(['one']), 4)).toEqual(['four']);
    expect(getPreloadPhotoIds(columns, new Set(['one', 'two']), 1)).toEqual(['four']);
  });
});
