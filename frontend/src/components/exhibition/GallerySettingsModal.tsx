import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type {
  GalleryColumnPreference,
  GallerySortPreference,
} from '../../utils/gallerySettings';
import {
  MAX_GALLERY_COLUMN_COUNT,
  MIN_GALLERY_COLUMN_COUNT,
  getFixedGalleryColumnCount,
} from '../../utils/gallerySettings';
import type { GalleryThemePreference } from '../../utils/galleryTheme';
import { ACCENT_OPTIONS } from '../../utils/galleryAccent';
import type { GalleryAccentPreference } from '../../utils/galleryAccent';
import { getVisibleInitialFocusElement, trapTabKey } from '../../utils/dialogFocus';
import { t } from '../../i18n';

function getIsDesktopViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // Prefer desktop close when matchMedia is unavailable (jsdom / legacy).
    return true;
  }

  const mediaQueryList = window.matchMedia('(min-width: 768px)');
  return mediaQueryList?.matches ?? true;
}

type GallerySettingsModalProps = {
  columnPreference: GalleryColumnPreference;
  sortPreference: GallerySortPreference;
  themePreference: GalleryThemePreference;
  accentPreference: GalleryAccentPreference;
  onSelectColumnPreference: (value: GalleryColumnPreference) => void;
  onSelectSortPreference: (value: GallerySortPreference) => void;
  onSelectThemePreference: (value: GalleryThemePreference) => void;
  onSelectAccentPreference: (value: GalleryAccentPreference) => void;
  onClose: () => void;
};

// Each toggle shows the direction it is currently in; clicking a selected
// toggle flips its direction, clicking an unselected one activates it.
const sortToggles: Array<{
  key: string;
  isSelected: (preference: GallerySortPreference) => boolean;
  label: (preference: GallerySortPreference) => string;
  next: (preference: GallerySortPreference) => GallerySortPreference;
}> = [
  {
    key: 'date',
    isSelected: (preference) => preference === 'newest' || preference === 'oldest',
    label: (preference) => (preference === 'oldest' ? t('settings.sort.oldest') : t('settings.sort.newest')),
    next: (preference) => (preference === 'newest' ? 'oldest' : 'newest'),
  },
  {
    key: 'filename',
    isSelected: (preference) => preference === 'filename-asc' || preference === 'filename-desc',
    label: (preference) =>
      preference === 'filename-desc' ? t('settings.sort.filenameDesc') : t('settings.sort.filenameAsc'),
    next: (preference) => (preference === 'filename-asc' ? 'filename-desc' : 'filename-asc'),
  },
  {
    key: 'random',
    isSelected: (preference) => preference === 'random',
    label: () => t('settings.sort.random'),
    next: () => 'random',
  },
];
const themeOptions: Array<{ value: GalleryThemePreference; label: string }> = [
  { value: 'system', label: t('settings.theme.system') },
  { value: 'light', label: t('settings.theme.light') },
  { value: 'dark', label: t('settings.theme.dark') },
];

function SelectedIcon() {
  return (
    <span
      className="settings-selected-icon inline-flex h-5 w-5 scale-100 items-center justify-center rounded-full text-primary transition-all duration-300 md:h-4 md:w-4"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-[2.2] md:h-3 md:w-3">
        <path d="M3.5 8.5 6.5 11.5 12.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function getOptionButtonClasses(isSelected: boolean, isDisabled = false) {
  return `inline-flex min-h-14 items-center justify-center rounded-[20px] border px-4 text-center text-base font-medium transition-all duration-300 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:min-h-12 md:rounded-2xl md:text-sm md:active:scale-100 ${
    isDisabled
      ? 'settings-option-disabled cursor-not-allowed text-on-surface-variant opacity-60'
      : isSelected
        ? 'settings-option-selected scale-[1.01] text-primary ring-1 md:scale-100'
        : 'settings-option text-on-surface md:hover:bg-surface-container-high'
  }`;
}

function getOptionLabelClasses(isSelected: boolean) {
  return `flex w-full items-center justify-center gap-2 transition-transform duration-300 ${isSelected ? 'translate-y-[-0.5px] pr-0.5' : ''}`;
}

function renderOptionContent(label: string, isSelected: boolean) {
  return (
    <span className={getOptionLabelClasses(isSelected)}>
      <span>{label}</span>
      {isSelected && <SelectedIcon />}
    </span>
  );
}

function getSectionCardClasses() {
  return 'settings-section-card space-y-3 rounded-[22px] border p-3 backdrop-blur-xl md:rounded-none md:border-none md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none';
}

export function GallerySettingsModal({
  columnPreference,
  sortPreference,
  themePreference,
  accentPreference,
  onSelectColumnPreference,
  onSelectSortPreference,
  onSelectThemePreference,
  onSelectAccentPreference,
  onClose,
}: GallerySettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const desktopCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const [isDesktopViewport, setIsDesktopViewport] = useState(getIsDesktopViewport);
  const currentFixedColumnCount = getFixedGalleryColumnCount(columnPreference);

  const decreaseColumnCount = () => {
    onSelectColumnPreference(Math.max(MIN_GALLERY_COLUMN_COUNT, currentFixedColumnCount - 1));
  };

  const increaseColumnCount = () => {
    onSelectColumnPreference(Math.min(MAX_GALLERY_COLUMN_COUNT, currentFixedColumnCount + 1));
  };

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(min-width: 768px)');
    if (!mediaQuery || typeof mediaQuery.matches !== 'boolean') {
      return;
    }

    const syncViewport = () => {
      setIsDesktopViewport(mediaQuery.matches);
    };

    syncViewport();
    mediaQuery.addEventListener?.('change', syncViewport);

    return () => {
      mediaQuery.removeEventListener?.('change', syncViewport);
    };
  }, []);

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const preferredCloseButton = isDesktopViewport
      ? desktopCloseButtonRef.current
      : mobileCloseButtonRef.current;
    const fallbackCloseButton = isDesktopViewport
      ? mobileCloseButtonRef.current
      : desktopCloseButtonRef.current;
    const initialFocusElement = getVisibleInitialFocusElement([preferredCloseButton, fallbackCloseButton]);

    initialFocusElement?.focus();

    return () => {
      const previous = previouslyFocusedElementRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab' && dialogRef.current) {
      trapTabKey(event, dialogRef.current);
      return;
    }

    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="dialog-backdrop-enter fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/28 px-0 pt-[max(0.75rem,env(safe-area-inset-top))] text-on-surface backdrop-blur-xl sm:pt-[max(1rem,env(safe-area-inset-top))] md:items-center md:bg-black/35 md:px-8 md:py-6 md:backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="gallery-settings-backdrop"
      data-motion="dialog-backdrop"
    >
      <div
        className="settings-sheet dialog-sheet-enter flex max-h-[calc(100vh-max(0.75rem,env(safe-area-inset-top))-0.5rem)] max-h-[calc(100dvh-max(0.75rem,env(safe-area-inset-top))-0.5rem)] w-full flex-col overflow-hidden rounded-t-[28px] border backdrop-blur-3xl sm:max-h-[calc(100vh-max(1rem,env(safe-area-inset-top))-0.75rem)] sm:max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-0.75rem)] sm:rounded-t-[30px] md:max-h-[calc(100dvh-3rem)] md:max-w-md md:rounded-[28px] md:backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
        data-motion="dialog-sheet"
      >
        <div className="flex justify-center px-4 pb-1.5 pt-2.5 sm:pb-2 sm:pt-3 md:hidden">
          <div className="settings-handle h-1.5 w-11 rounded-full shadow-[inset_0_1px_1px_rgba(255,255,255,0.55)]" aria-hidden="true" />
        </div>

        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-1 sm:gap-4 sm:pb-4 md:mb-6 md:p-6 md:pb-0">
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">{t('settings.display')}</p>
            <h2 className="font-headline text-xl text-on-surface md:text-2xl">{t('settings.title')}</h2>
            <p className="text-xs leading-5 text-on-surface-variant sm:text-sm sm:leading-6">
              {t('settings.description')}
            </p>
          </div>
          <button
            ref={desktopCloseButtonRef}
            type="button"
            aria-label={t('settings.closeAria')}
            onClick={onClose}
            data-settings-close="desktop"
            tabIndex={isDesktopViewport ? undefined : -1}
            className="hidden min-h-11 shrink-0 items-center rounded-full bg-surface-container px-4 text-sm font-medium text-on-surface transition-colors duration-200 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:inline-flex"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3 pt-1 sm:space-y-5 sm:px-4 sm:pb-4 md:space-y-6 md:px-6 md:pb-6">
          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">{t('settings.theme')}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {themeOptions.map((option) => {
                const isSelected = option.value === themePreference;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectThemePreference(option.value)}
                    className={getOptionButtonClasses(isSelected)}
                    data-testid={`theme-option-${option.value}`}
                  >
                    {renderOptionContent(option.label, isSelected)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">{t('settings.accent')}</p>
            <div className="flex flex-wrap items-center gap-3">
              {ACCENT_OPTIONS.map((option) => {
                const isSelected = option.value === accentPreference;
                const label = t(`settings.accent.${option.value}`);

                return (
                  <button
                    key={option.value}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={isSelected}
                    onClick={() => onSelectAccentPreference(option.value)}
                    data-testid={`accent-option-${option.value}`}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-full border transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:h-9 md:w-9 ${
                      isSelected
                        ? 'settings-option-selected scale-105 ring-2 ring-primary/40'
                        : 'settings-option md:hover:scale-105'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-7 w-7 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.4)] md:h-6 md:w-6"
                      style={{ backgroundColor: option.swatchColor }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">{t('settings.sortOrder')}</p>
            <div className="grid grid-cols-3 gap-3">
              {sortToggles.map((toggle) => {
                const isSelected = toggle.isSelected(sortPreference);

                return (
                  <button
                    key={toggle.key}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectSortPreference(toggle.next(sortPreference))}
                    className={getOptionButtonClasses(isSelected)}
                    data-testid={`sort-option-${toggle.key}`}
                  >
                    {renderOptionContent(toggle.label(sortPreference), isSelected)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">{t('settings.waterfallColumns')}</p>
            <div className="space-y-3">
              <button
                type="button"
                aria-pressed={columnPreference === 'auto'}
                onClick={() => onSelectColumnPreference('auto')}
                className={`w-full ${getOptionButtonClasses(columnPreference === 'auto')}`}
              >
                {renderOptionContent(t('settings.columns.auto'), columnPreference === 'auto')}
              </button>
              <div className="settings-soft-panel rounded-[20px] border p-3 md:rounded-2xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface">{t('settings.columns.fixed')}</p>
                    <p className="text-xs text-on-surface-variant">
                      {t('settings.columns.fixedHint', { min: MIN_GALLERY_COLUMN_COUNT, max: MAX_GALLERY_COLUMN_COUNT })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      aria-label={t('settings.columns.decrease')}
                      disabled={currentFixedColumnCount <= MIN_GALLERY_COLUMN_COUNT}
                      onClick={decreaseColumnCount}
                      className={getOptionButtonClasses(false, currentFixedColumnCount <= MIN_GALLERY_COLUMN_COUNT)}
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <output
                      aria-live="polite"
                      aria-label={t('settings.columns.selectedCount')}
                      className="settings-option-selected inline-flex min-h-14 min-w-16 items-center justify-center rounded-[20px] border px-4 text-base font-semibold text-primary ring-1 md:min-h-12 md:min-w-14 md:rounded-2xl md:text-sm"
                    >
                      {currentFixedColumnCount}
                    </output>
                    <button
                      type="button"
                      aria-label={t('settings.columns.increase')}
                      disabled={currentFixedColumnCount >= MAX_GALLERY_COLUMN_COUNT}
                      onClick={increaseColumnCount}
                      className={getOptionButtonClasses(false, currentFixedColumnCount >= MAX_GALLERY_COLUMN_COUNT)}
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                </div>
                {columnPreference === 'auto' && (
                  <p className="mt-3 text-xs text-on-surface-variant">
                    {t('settings.columns.autoHint')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="settings-footer border-t px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-2xl sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pt-3 md:hidden">
          <button
            ref={mobileCloseButtonRef}
            type="button"
            onClick={onClose}
            data-settings-close="mobile"
            tabIndex={isDesktopViewport ? -1 : undefined}
            className="settings-footer-button inline-flex min-h-14 w-full items-center justify-center rounded-[18px] px-4 text-base font-semibold text-on-surface transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {t('settings.closeMobile')}
          </button>
        </div>
      </div>
    </div>
  );
}
