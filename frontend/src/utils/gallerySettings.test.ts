import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GALLERY_SETTINGS,
  GALLERY_SETTINGS_STORAGE_KEY,
  MAX_GALLERY_COLUMN_COUNT,
  clampGalleryColumnCount,
  getFixedGalleryColumnCount,
  normalizeGalleryColumnPreference,
  readGallerySettings,
  writeGallerySettings,
} from './gallerySettings';

describe('gallerySettings', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns defaults when storage is empty', () => {
    expect(readGallerySettings()).toEqual(DEFAULT_GALLERY_SETTINGS);
  });

  it('returns defaults when storage contains invalid json', () => {
    window.localStorage.setItem(GALLERY_SETTINGS_STORAGE_KEY, '{');

    expect(readGallerySettings()).toEqual(DEFAULT_GALLERY_SETTINGS);
  });

  it('merges partial valid settings with defaults', () => {
    window.localStorage.setItem(GALLERY_SETTINGS_STORAGE_KEY, JSON.stringify({ sortPreference: 'random' }));

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      sortPreference: 'random',
    });
  });

  it('ignores legacy mediaSourcePreference without throwing or wiping column/sort', () => {
    for (const mediaSourcePreference of ['qiniu', 'local', 'auto', 'r2', 'cdn'] as const) {
      window.localStorage.setItem(
        GALLERY_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          columnPreference: 5,
          sortPreference: 'oldest',
          mediaSourcePreference,
        }),
      );

      expect(readGallerySettings()).toEqual({
        columnPreference: 5,
        sortPreference: 'oldest',
      });
      expect(readGallerySettings()).not.toHaveProperty('mediaSourcePreference');
    }
  });

  it('accepts custom stored fixed column counts', () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 5,
      }),
    );

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      columnPreference: 5,
    });
  });

  it('clamps stored fixed column counts above the max', () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 99,
      }),
    );

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      columnPreference: MAX_GALLERY_COLUMN_COUNT,
    });
  });

  it('falls back to defaults for invalid values', () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 0,
        sortPreference: 'invalid',
        mediaSourcePreference: 'remote',
      }),
    );

    expect(readGallerySettings()).toEqual(DEFAULT_GALLERY_SETTINGS);
  });

  it('normalizes fixed column preferences', () => {
    expect(normalizeGalleryColumnPreference('auto')).toBe('auto');
    expect(normalizeGalleryColumnPreference(3)).toBe(3);
    expect(normalizeGalleryColumnPreference(999)).toBe(MAX_GALLERY_COLUMN_COUNT);
    expect(normalizeGalleryColumnPreference(0)).toBe('auto');
  });

  it('derives a fixed column count for the stepper display', () => {
    expect(getFixedGalleryColumnCount('auto')).toBe(4);
    expect(getFixedGalleryColumnCount(6)).toBe(6);
    expect(getFixedGalleryColumnCount(999)).toBe(MAX_GALLERY_COLUMN_COUNT);
  });

  it('clamps fixed column counts into the supported range', () => {
    expect(clampGalleryColumnCount(0)).toBe(1);
    expect(clampGalleryColumnCount(4)).toBe(4);
    expect(clampGalleryColumnCount(99)).toBe(MAX_GALLERY_COLUMN_COUNT);
  });

  it('writes only column and sort preferences to storage', () => {
    writeGallerySettings({
      columnPreference: 6,
      sortPreference: 'oldest',
    });

    const stored = JSON.parse(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY) ?? '{}');

    expect(stored).toEqual({
      columnPreference: 6,
      sortPreference: 'oldest',
    });
    expect(stored).not.toHaveProperty('mediaSourcePreference');
  });
});
