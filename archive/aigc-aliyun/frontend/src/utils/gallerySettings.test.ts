import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GALLERY_SETTINGS,
  GALLERY_MEDIA_SOURCE_VISIBILITY,
  GALLERY_SETTINGS_STORAGE_KEY,
  MAX_GALLERY_COLUMN_COUNT,
  clampGalleryColumnCount,
  getDefaultGalleryMediaSourcePreference,
  getFixedGalleryColumnCount,
  getVisibleGalleryMediaSourcePreferences,
  getVisibleGalleryMediaSources,
  isAutoMediaSourcePreferenceVisible,
  isGalleryMediaSourceVisible,
  normalizeGalleryColumnPreference,
  normalizeGalleryMediaSourcePreference,
  readGallerySettings,
  writeGallerySettings,
} from './gallerySettings';

describe('gallerySettings', () => {
  afterEach(() => {
    window.localStorage.clear();
    GALLERY_MEDIA_SOURCE_VISIBILITY.r2 = true;
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = true;
    GALLERY_MEDIA_SOURCE_VISIBILITY.local = true;
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

  it('accepts auto as a valid stored media source', () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mediaSourcePreference: 'auto',
      }),
    );

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      mediaSourcePreference: 'auto',
    });
  });

  it('accepts qiniu as a valid stored media source', () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mediaSourcePreference: 'qiniu',
      }),
    );

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      mediaSourcePreference: 'qiniu',
    });
  });

  it('returns visible gallery media sources and preferences', () => {
    expect(getVisibleGalleryMediaSources()).toEqual(['r2', 'qiniu', 'local']);
    expect(getVisibleGalleryMediaSourcePreferences()).toEqual(['auto', 'r2', 'qiniu', 'local']);
    expect(isAutoMediaSourcePreferenceVisible()).toBe(true);
    expect(isGalleryMediaSourceVisible('qiniu')).toBe(true);
  });

  it('hides auto and falls back to r2 when qiniu is hidden', () => {
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = false;

    expect(isAutoMediaSourcePreferenceVisible()).toBe(false);
    expect(getVisibleGalleryMediaSourcePreferences()).toEqual(['r2', 'local']);
    expect(normalizeGalleryMediaSourcePreference('auto')).toBe('r2');
    expect(normalizeGalleryMediaSourcePreference('qiniu')).toBe('r2');
    expect(isGalleryMediaSourceVisible('qiniu')).toBe(false);
  });

  it('hides auto and falls back to qiniu when r2 is hidden from defaults', () => {
    GALLERY_MEDIA_SOURCE_VISIBILITY.r2 = false;

    expect(isAutoMediaSourcePreferenceVisible()).toBe(false);
    expect(getVisibleGalleryMediaSourcePreferences()).toEqual(['qiniu', 'local']);
    expect(getDefaultGalleryMediaSourcePreference()).toBe('qiniu');
  });

  it('normalizes hidden stored media source preferences', () => {
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = false;
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mediaSourcePreference: 'qiniu',
      }),
    );

    expect(readGallerySettings()).toEqual({
      ...DEFAULT_GALLERY_SETTINGS,
      mediaSourcePreference: 'r2',
    });
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

  it('writes settings to storage', () => {
    writeGallerySettings({
      columnPreference: 6,
      sortPreference: 'oldest',
      mediaSourcePreference: 'local',
    });

    expect(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY)).toBe(
      JSON.stringify({
        columnPreference: 6,
        sortPreference: 'oldest',
        mediaSourcePreference: 'local',
      }),
    );
  });
});
