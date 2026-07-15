export type GalleryColumnPreference = 'auto' | number;
export type GallerySortPreference = 'newest' | 'oldest' | 'filename-asc' | 'filename-desc' | 'random';
export type GalleryConcreteMediaSource = 'r2' | 'qiniu' | 'local';
export type GalleryMediaSourcePreference = 'auto' | GalleryConcreteMediaSource;

export type GallerySettings = {
  columnPreference: GalleryColumnPreference;
  sortPreference: GallerySortPreference;
  mediaSourcePreference: GalleryMediaSourcePreference;
};

export const MIN_GALLERY_COLUMN_COUNT = 1;
export const MAX_GALLERY_COLUMN_COUNT = 8;
export const DEFAULT_FIXED_GALLERY_COLUMN_COUNT = 4;
export const GALLERY_MEDIA_SOURCE_VISIBILITY: Record<GalleryConcreteMediaSource, boolean> = {
  r2: true,
  qiniu: false,
  local: false,
};

export const GALLERY_SETTINGS_STORAGE_KEY = 'gallery-settings';

const SORT_PREFERENCES: GallerySortPreference[] = ['newest', 'oldest', 'filename-asc', 'filename-desc', 'random'];
const CONCRETE_MEDIA_SOURCES: GalleryConcreteMediaSource[] = ['r2', 'qiniu', 'local'];
const AUTO_MEDIA_SOURCE_CANDIDATES: GalleryConcreteMediaSource[] = ['r2', 'qiniu'];
const MEDIA_SOURCE_PREFERENCES: GalleryMediaSourcePreference[] = ['auto', ...CONCRETE_MEDIA_SOURCES];

export const DEFAULT_GALLERY_SETTINGS: GallerySettings = {
  columnPreference: 'auto',
  sortPreference: 'newest',
  mediaSourcePreference: getDefaultGalleryMediaSourcePreference(),
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

export function getVisibleGalleryMediaSources(): GalleryConcreteMediaSource[] {
  return CONCRETE_MEDIA_SOURCES.filter((source) => GALLERY_MEDIA_SOURCE_VISIBILITY[source]);
}

export function isGalleryMediaSourceVisible(source: GalleryConcreteMediaSource): boolean {
  return getVisibleGalleryMediaSources().includes(source);
}

export function isAutoMediaSourcePreferenceVisible(): boolean {
  return AUTO_MEDIA_SOURCE_CANDIDATES.every((source) => isGalleryMediaSourceVisible(source));
}

export function getVisibleGalleryMediaSourcePreferences(): GalleryMediaSourcePreference[] {
  return [
    ...(isAutoMediaSourcePreferenceVisible() ? (['auto'] as const) : []),
    ...getVisibleGalleryMediaSources(),
  ];
}

export function getDefaultGalleryMediaSourcePreference(): GalleryMediaSourcePreference {
  return getVisibleGalleryMediaSources()[0] ?? 'r2';
}

export function getDefaultGallerySettings(): GallerySettings {
  return {
    ...DEFAULT_GALLERY_SETTINGS,
    mediaSourcePreference: getDefaultGalleryMediaSourcePreference(),
  };
}

export function normalizeGalleryMediaSourcePreference(value: unknown): GalleryMediaSourcePreference {
  if (!isGalleryMediaSourcePreference(value)) {
    return getDefaultGalleryMediaSourcePreference();
  }

  if (value === 'auto') {
    return isAutoMediaSourcePreferenceVisible() ? value : getDefaultGalleryMediaSourcePreference();
  }

  return isGalleryMediaSourceVisible(value) ? value : getDefaultGalleryMediaSourcePreference();
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
    const parsedValue = JSON.parse(storedValue) as Partial<GallerySettings>;

    return {
      columnPreference: normalizeGalleryColumnPreference(parsedValue.columnPreference),
      sortPreference: isGallerySortPreference(parsedValue.sortPreference)
        ? parsedValue.sortPreference
        : defaultSettings.sortPreference,
      mediaSourcePreference: normalizeGalleryMediaSourcePreference(parsedValue.mediaSourcePreference),
    };
  } catch {
    return defaultSettings;
  }
}

export function writeGallerySettings(settings: GallerySettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(GALLERY_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function isGalleryColumnPreference(value: unknown): value is GalleryColumnPreference {
  return value === 'auto' || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= MIN_GALLERY_COLUMN_COUNT);
}

function isGallerySortPreference(value: unknown): value is GallerySortPreference {
  return SORT_PREFERENCES.includes(value as GallerySortPreference);
}

function isGalleryMediaSourcePreference(value: unknown): value is GalleryMediaSourcePreference {
  return MEDIA_SOURCE_PREFERENCES.includes(value as GalleryMediaSourcePreference);
}
