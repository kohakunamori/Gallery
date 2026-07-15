export type GalleryAccentPreference = 'azure' | 'scarlet' | 'sapphire' | 'emerald' | 'gold' | 'sakura';

export const GALLERY_ACCENT_STORAGE_KEY = 'gallery.accent';
export const DEFAULT_GALLERY_ACCENT_PREFERENCE: GalleryAccentPreference = 'azure';

// Swatch colors match the light-theme --color-primary defined per accent in index.css.
export const ACCENT_OPTIONS: Array<{ value: GalleryAccentPreference; swatchColor: string }> = [
  { value: 'azure', swatchColor: '#005bb3' },
  { value: 'scarlet', swatchColor: '#c41e3a' },
  { value: 'sapphire', swatchColor: '#2140c3' },
  { value: 'emerald', swatchColor: '#0b8058' },
  { value: 'gold', swatchColor: '#9e6c00' },
  { value: 'sakura', swatchColor: '#c5307a' },
];

const ACCENT_PREFERENCES: GalleryAccentPreference[] = ACCENT_OPTIONS.map((option) => option.value);

export function isGalleryAccentPreference(value: unknown): value is GalleryAccentPreference {
  return ACCENT_PREFERENCES.includes(value as GalleryAccentPreference);
}

export function normalizeGalleryAccentPreference(value: unknown): GalleryAccentPreference {
  return isGalleryAccentPreference(value) ? value : DEFAULT_GALLERY_ACCENT_PREFERENCE;
}

export function readGalleryAccentPreference(): GalleryAccentPreference {
  if (typeof window === 'undefined') {
    return DEFAULT_GALLERY_ACCENT_PREFERENCE;
  }

  return normalizeGalleryAccentPreference(window.localStorage.getItem(GALLERY_ACCENT_STORAGE_KEY));
}

export function writeGalleryAccentPreference(preference: GalleryAccentPreference): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(GALLERY_ACCENT_STORAGE_KEY, preference);
}

export function applyGalleryAccent(
  preference: GalleryAccentPreference,
  root?: HTMLElement,
): void {
  if (typeof document === 'undefined' && !root) {
    return;
  }

  (root ?? document.documentElement).setAttribute('data-accent', preference);
}
