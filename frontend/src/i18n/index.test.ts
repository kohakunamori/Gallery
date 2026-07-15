import { afterEach, describe, expect, it } from 'vitest';
import { getMessage, t, useT } from './index';
import { enMessages, type MessageKey } from './messages/en';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  readLocale,
  writeLocale,
} from './locale';

const REQUIRED_KEYS: MessageKey[] = [
  'header.wordmark',
  'header.upload',
  'header.settings',
  'exhibition.error.title',
  'exhibition.error.description',
  'exhibition.error.retry',
  'exhibition.empty.title',
  'exhibition.empty.description',
  'exhibition.empty.upload',
  'settings.title',
  'settings.close',
  'settings.closeAria',
  'settings.display',
  'settings.sortOrder',
  'settings.waterfallColumns',
  'upload.backToGallery',
  'upload.heading',
  'upload.viewGallery',
  'upload.rememberToken',
  'upload.submit',
];

describe('i18n getMessage / t', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('returns English strings for known keys', () => {
    expect(getMessage('settings.title')).toBe('Gallery settings');
    expect(t('exhibition.error.title')).toBe('Unable to load the exhibition');
    expect(t('upload.viewGallery')).toBe('View gallery');
  });

  it('returns the key itself when missing from every catalog', () => {
    expect(getMessage('does.not.exist')).toBe('does.not.exist');
  });

  it('interpolates {vars} placeholders', () => {
    expect(t('settings.columns.fixedHint', { min: 1, max: 8 })).toBe(
      'Choose a fixed count from 1 to 8.',
    );
  });

  it('leaves unknown placeholders intact', () => {
    expect(t('settings.columns.fixedHint', { min: 2 })).toBe(
      'Choose a fixed count from 2 to {max}.',
    );
  });

  it('catalog contains required high-traffic keys with non-empty English values', () => {
    for (const key of REQUIRED_KEYS) {
      expect(enMessages[key], `missing key ${key}`).toBeTypeOf('string');
      expect(enMessages[key].length, `empty value for ${key}`).toBeGreaterThan(0);
      expect(getMessage(key)).toBe(enMessages[key]);
    }
  });
});

describe('i18n locale storage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('defaults to English', () => {
    expect(readLocale()).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale('xx')).toBe('en');
  });

  it('persists and reads gallery.locale', () => {
    writeLocale('en');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(readLocale()).toBe('en');
  });
});

describe('useT', () => {
  it('returns a translator bound to the current locale', () => {
    const translate = useT();
    expect(translate('header.upload')).toBe('Upload');
    expect(translate('upload.rememberToken')).toBe('Remember token on this device');
  });
});
