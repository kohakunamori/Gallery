import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCENT_OPTIONS,
  DEFAULT_GALLERY_ACCENT_PREFERENCE,
  GALLERY_ACCENT_STORAGE_KEY,
  applyGalleryAccent,
  normalizeGalleryAccentPreference,
  readGalleryAccentPreference,
  writeGalleryAccentPreference,
} from './galleryAccent';

describe('galleryAccent', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-accent');
  });

  it('falls back to the default accent when nothing is stored', () => {
    expect(readGalleryAccentPreference()).toBe(DEFAULT_GALLERY_ACCENT_PREFERENCE);
    expect(readGalleryAccentPreference()).toBe('azure');
  });

  it('falls back to the default accent for garbage stored values', () => {
    window.localStorage.setItem(GALLERY_ACCENT_STORAGE_KEY, 'not-a-color');
    expect(readGalleryAccentPreference()).toBe('azure');
  });

  it('round-trips a stored accent preference', () => {
    writeGalleryAccentPreference('scarlet');
    expect(readGalleryAccentPreference()).toBe('scarlet');
  });

  it('normalizes every documented option to itself', () => {
    for (const option of ACCENT_OPTIONS) {
      expect(normalizeGalleryAccentPreference(option.value)).toBe(option.value);
    }
    expect(normalizeGalleryAccentPreference(undefined)).toBe('azure');
  });

  it('applies the accent as a data attribute on the root element', () => {
    applyGalleryAccent('emerald');
    expect(document.documentElement.getAttribute('data-accent')).toBe('emerald');

    const custom = document.createElement('div');
    applyGalleryAccent('gold', custom);
    expect(custom.getAttribute('data-accent')).toBe('gold');
    expect(document.documentElement.getAttribute('data-accent')).toBe('emerald');
  });
});
