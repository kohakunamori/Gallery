export type GalleryThemePreference = 'system' | 'light' | 'dark';
export type GalleryResolvedTheme = 'light' | 'dark';

export const GALLERY_THEME_STORAGE_KEY = 'gallery.theme';
export const DEFAULT_GALLERY_THEME_PREFERENCE: GalleryThemePreference = 'system';

const THEME_PREFERENCES: GalleryThemePreference[] = ['system', 'light', 'dark'];

export function isGalleryThemePreference(value: unknown): value is GalleryThemePreference {
  return THEME_PREFERENCES.includes(value as GalleryThemePreference);
}

export function normalizeGalleryThemePreference(value: unknown): GalleryThemePreference {
  return isGalleryThemePreference(value) ? value : DEFAULT_GALLERY_THEME_PREFERENCE;
}

export function readGalleryThemePreference(): GalleryThemePreference {
  if (typeof window === 'undefined') {
    return DEFAULT_GALLERY_THEME_PREFERENCE;
  }

  return normalizeGalleryThemePreference(window.localStorage.getItem(GALLERY_THEME_STORAGE_KEY));
}

export function writeGalleryThemePreference(preference: GalleryThemePreference): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(GALLERY_THEME_STORAGE_KEY, preference);
}

export function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(prefers-color-scheme: dark)')?.matches === true;
}

export function resolveGalleryTheme(
  preference: GalleryThemePreference,
  systemPrefersDark = getSystemPrefersDark(),
): GalleryResolvedTheme {
  if (preference === 'light') {
    return 'light';
  }

  if (preference === 'dark') {
    return 'dark';
  }

  return systemPrefersDark ? 'dark' : 'light';
}

export function applyGalleryTheme(
  theme: GalleryResolvedTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute('data-theme', theme);
}

export function applyGalleryThemePreference(
  preference: GalleryThemePreference,
  options?: {
    systemPrefersDark?: boolean;
    root?: HTMLElement;
  },
): GalleryResolvedTheme {
  const resolvedTheme = resolveGalleryTheme(
    preference,
    options?.systemPrefersDark ?? getSystemPrefersDark(),
  );

  if (typeof document !== 'undefined') {
    applyGalleryTheme(resolvedTheme, options?.root ?? document.documentElement);
  }

  return resolvedTheme;
}
