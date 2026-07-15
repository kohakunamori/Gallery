export type Locale = 'en';

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_STORAGE_KEY = 'gallery.locale';
export const SUPPORTED_LOCALES: readonly Locale[] = ['en'] as const;

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: unknown): Locale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

/** Read persisted locale from localStorage. Defaults to English. */
export function readLocale(): Locale {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }

  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Persist locale under the gallery.locale storage key. */
export function writeLocale(locale: Locale): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!isSupportedLocale(locale)) {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Ignore quota / private-mode failures; runtime still uses in-memory default.
  }
}
