import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GALLERY_THEME_PREFERENCE,
  GALLERY_THEME_STORAGE_KEY,
  applyGalleryTheme,
  applyGalleryThemePreference,
  getSystemPrefersDark,
  normalizeGalleryThemePreference,
  readGalleryThemePreference,
  resolveGalleryTheme,
  writeGalleryThemePreference,
} from './galleryTheme';

describe('galleryTheme', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    vi.unstubAllGlobals();
  });

  it('returns system as the default preference when storage is empty', () => {
    expect(readGalleryThemePreference()).toBe(DEFAULT_GALLERY_THEME_PREFERENCE);
    expect(readGalleryThemePreference()).toBe('system');
  });

  it('normalizes invalid stored preferences to system', () => {
    expect(normalizeGalleryThemePreference('sepia')).toBe('system');
    expect(normalizeGalleryThemePreference(null)).toBe('system');
    expect(normalizeGalleryThemePreference('dark')).toBe('dark');
  });

  it('reads and writes theme preference from gallery.theme', () => {
    writeGalleryThemePreference('dark');

    expect(window.localStorage.getItem(GALLERY_THEME_STORAGE_KEY)).toBe('dark');
    expect(readGalleryThemePreference()).toBe('dark');
  });

  it('resolves system preference from prefers-color-scheme', () => {
    expect(resolveGalleryTheme('system', true)).toBe('dark');
    expect(resolveGalleryTheme('system', false)).toBe('light');
    expect(resolveGalleryTheme('light', true)).toBe('light');
    expect(resolveGalleryTheme('dark', false)).toBe('dark');
  });

  it('applies data-theme on the document element', () => {
    applyGalleryTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    applyGalleryTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('applies a preference by resolving and setting data-theme', () => {
    const resolved = applyGalleryThemePreference('system', { systemPrefersDark: true });

    expect(resolved).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads system dark preference from matchMedia', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-color-scheme: dark'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    expect(getSystemPrefersDark()).toBe(true);
  });
});
