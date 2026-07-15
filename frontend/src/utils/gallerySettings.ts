export type GalleryColumnPreference = 'auto' | number;
export type GallerySortPreference = 'newest' | 'oldest' | 'filename-asc' | 'filename-desc' | 'random';

export type GallerySettings = {
  columnPreference: GalleryColumnPreference;
  sortPreference: GallerySortPreference;
};

export const MIN_GALLERY_COLUMN_COUNT = 1;
export const MAX_GALLERY_COLUMN_COUNT = 8;
export const DEFAULT_FIXED_GALLERY_COLUMN_COUNT = 4;

export const GALLERY_SETTINGS_STORAGE_KEY = 'gallery-settings';

const SORT_PREFERENCES: GallerySortPreference[] = ['newest', 'oldest', 'filename-asc', 'filename-desc', 'random'];

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  columnPreference: 'auto',
  sortPreference: 'newest',
};

export function clampGalleryColumnCount(columnCount: number) {
  return Math.min(MAX_GALLERY_COLUMN_COUNT, Math.max(MIN_GALLERY_COLUMN_COUNT, columnCount));
}

export function getFixedGalleryColumnCount(columnPreference: GalleryColumnPreference) {
  return columnPreference === 'auto'
    ? DEFAULT_FIXED_GALLERY_COLUMN_COUNT
    : clampGalleryColumnCount(columnPreference);
}

export function normalizeGalleryColumnPreference(value: unknown): GalleryColumnPreference {
  if (!isGalleryColumnPreference(value)) {
    return getDefaultGallerySettings().columnPreference;
  }

  return value === 'auto' ? value : clampGalleryColumnCount(value);
}

export function getDefaultGallerySettings(): GallerySettings {
  return { ...DEFAULT_GALLERY_SETTINGS };
}

export function readGallerySettings(): GallerySettings {
  const defaultSettings = getDefaultGallerySettings();

  if (typeof window === 'undefined') {
    return defaultSettings;
  }

  const storedValue = window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY);

  if (storedValue === null) {
    return defaultSettings;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as Partial<GallerySettings> & Record<string, unknown>;

    // Legacy mediaSourcePreference (if present) is intentionally ignored.
    return {
      columnPreference: normalizeGalleryColumnPreference(parsedValue.columnPreference),
      sortPreference: isGallerySortPreference(parsedValue.sortPreference)
        ? parsedValue.sortPreference
        : defaultSettings.sortPreference,
    };
  } catch {
    return defaultSettings;
  }
}

export function writeGallerySettings(settings: GallerySettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    GALLERY_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      columnPreference: settings.columnPreference,
      sortPreference: settings.sortPreference,
    }),
  );
}

function isGalleryColumnPreference(value: unknown): value is GalleryColumnPreference {
  return value === 'auto' || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= MIN_GALLERY_COLUMN_COUNT);
}

function isGallerySortPreference(value: unknown): value is GallerySortPreference {
  return SORT_PREFERENCES.includes(value as GallerySortPreference);
}
