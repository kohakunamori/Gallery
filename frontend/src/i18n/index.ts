import { enMessages, type MessageKey } from './messages/en';
import { DEFAULT_LOCALE, readLocale, type Locale } from './locale';

export type { MessageKey, MessageCatalog } from './messages/en';
export type { Locale } from './locale';
export {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  normalizeLocale,
  readLocale,
  writeLocale,
} from './locale';

type MessageVars = Record<string, string | number>;

/** Registry of locale → catalog. Add new locales here after creating messages/<locale>.ts. */
const catalogs: Record<Locale, Record<string, string>> = {
  en: enMessages,
};

function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return String(vars[name]);
    }

    return match;
  });
}

/**
 * Resolve a message key for the active (or explicit) locale.
 * Falls back to English, then to the key itself when missing.
 */
export function getMessage(key: string, vars?: MessageVars, locale?: Locale): string {
  const resolvedLocale = locale ?? readLocale();
  const catalog = catalogs[resolvedLocale] ?? catalogs[DEFAULT_LOCALE];
  const fallbackCatalog = catalogs[DEFAULT_LOCALE];
  const template = catalog[key] ?? fallbackCatalog[key] ?? key;

  return interpolate(template, vars);
}

/** Alias for getMessage — preferred short form in components. */
export function t(key: string, vars?: MessageVars, locale?: Locale): string {
  return getMessage(key, vars, locale);
}

/** Type-safe helper when the key is known at compile time. */
export function tKey(key: MessageKey, vars?: MessageVars, locale?: Locale): string {
  return getMessage(key, vars, locale);
}

/**
 * Lightweight hook wrapper. Locale switching UI is not wired yet, so this
 * returns a stable t() bound to the currently stored locale.
 */
export function useT(locale?: Locale): (key: string, vars?: MessageVars) => string {
  const resolved = locale ?? readLocale();

  return (key: string, vars?: MessageVars) => getMessage(key, vars, resolved);
}
