import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type {
  GalleryColumnPreference,
  GalleryMediaSourcePreference,
  GallerySortPreference,
} from '../../utils/gallerySettings';
import {
  MAX_GALLERY_COLUMN_COUNT,
  MIN_GALLERY_COLUMN_COUNT,
  getFixedGalleryColumnCount,
  getVisibleGalleryMediaSourcePreferences,
  isGalleryMediaSourceVisible,
} from '../../utils/gallerySettings';
import type { MediaSourceStatus } from '../../services/mediaSources';

type GallerySettingsModalProps = {
  columnPreference: GalleryColumnPreference;
  sortPreference: GallerySortPreference;
  mediaSourcePreference: GalleryMediaSourcePreference;
  mediaSourceStatuses: MediaSourceStatus[];
  onSelectColumnPreference: (value: GalleryColumnPreference) => void;
  onSelectSortPreference: (value: GallerySortPreference) => void;
  onSelectMediaSourcePreference: (value: GalleryMediaSourcePreference) => void;
  onClose: () => void;
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const sortOptions: Array<{ value: GallerySortPreference; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'filename-asc', label: 'Filename A–Z' },
  { value: 'filename-desc', label: 'Filename Z–A' },
  { value: 'random', label: 'Random order' },
];
const mediaSourceLabels: Record<GalleryMediaSourcePreference, string> = {
  auto: 'Auto',
  r2: 'R2',
  qiniu: 'Qiniu',
  local: 'Server local',
};
const DEFAULT_QINIU_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

function SelectedIcon() {
  return (
    <span
      className="inline-flex h-5 w-5 scale-100 items-center justify-center rounded-full bg-white/82 text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)] transition-all duration-300 md:h-4 md:w-4 md:bg-primary/16 md:shadow-none"
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
      ? 'cursor-not-allowed border-white/35 bg-white/30 text-on-surface-variant opacity-60 shadow-none hover:bg-white/30 md:border-transparent md:bg-surface-container-low'
      : isSelected
        ? 'scale-[1.01] border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.92))] text-primary shadow-[0_14px_34px_rgba(15,23,42,0.12)] ring-1 ring-white/60 md:scale-100 md:border-primary/30 md:bg-primary/14 md:ring-primary/10'
        : 'border-white/45 bg-white/50 text-on-surface shadow-[0_6px_18px_rgba(15,23,42,0.05)] hover:bg-white/70 md:border-transparent md:bg-surface-container md:shadow-none md:hover:bg-surface-container-high'
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
  return 'space-y-3 rounded-[22px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(248,250,255,0.52))] p-3 shadow-[0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl md:rounded-none md:border-none md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none';
}

function formatGigabytes(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(2);
}

function getQiniuUsageBarClasses(usagePercent: number) {
  if (usagePercent >= 100) {
    return 'bg-red-500';
  }

  if (usagePercent >= 80) {
    return 'bg-amber-500';
  }

  return 'bg-primary';
}

export function GallerySettingsModal({
  columnPreference,
  sortPreference,
  mediaSourcePreference,
  mediaSourceStatuses,
  onSelectColumnPreference,
  onSelectSortPreference,
  onSelectMediaSourcePreference,
  onClose,
}: GallerySettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const visibleMediaSourceOptions = getVisibleGalleryMediaSourcePreferences().map((value) => ({
    value,
    label: mediaSourceLabels[value],
  }));
  const isQiniuVisible = isGalleryMediaSourceVisible('qiniu');
  const qiniuStatus = isQiniuVisible ? mediaSourceStatuses.find((status) => status.source === 'qiniu') : undefined;
  const qiniuUsage = qiniuStatus?.usage;
  const qiniuQuotaBytes = qiniuUsage?.quotaBytes ?? DEFAULT_QINIU_QUOTA_BYTES;
  const qiniuUsedBytes = qiniuUsage?.usedBytes ?? 0;
  const qiniuUsagePercent = qiniuQuotaBytes === 0 ? 0 : Math.min(100, (qiniuUsedBytes / qiniuQuotaBytes) * 100);
  const qiniuUsagePercentRounded = Math.round(qiniuUsagePercent);
  const qiniuUsageBarClasses = getQiniuUsageBarClasses(qiniuUsagePercent);
  const currentFixedColumnCount = getFixedGalleryColumnCount(columnPreference);

  const decreaseColumnCount = () => {
    onSelectColumnPreference(Math.max(MIN_GALLERY_COLUMN_COUNT, currentFixedColumnCount - 1));
  };

  const increaseColumnCount = () => {
    onSelectColumnPreference(Math.min(MAX_GALLERY_COLUMN_COUNT, currentFixedColumnCount + 1));
  };

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      const focusableElements = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
            (element) => !element.hasAttribute('disabled') && element.tabIndex !== -1,
          )
        : [];

      if (focusableElements.length > 0) {
        const firstFocusableElement = focusableElements[0];
        const lastFocusableElement = focusableElements[focusableElements.length - 1];

        if (event.shiftKey && document.activeElement === firstFocusableElement) {
          event.preventDefault();
          lastFocusableElement.focus();
          return;
        }

        if (!event.shiftKey && document.activeElement === lastFocusableElement) {
          event.preventDefault();
          firstFocusableElement.focus();
          return;
        }
      }
    }

    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex animate-[fade-in_220ms_ease-out] items-end justify-center overflow-y-auto overscroll-contain bg-black/28 px-0 pt-[max(0.75rem,env(safe-area-inset-top))] text-on-surface backdrop-blur-xl sm:pt-[max(1rem,env(safe-area-inset-top))] md:items-center md:bg-black/35 md:px-8 md:py-6 md:backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Gallery settings"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="gallery-settings-backdrop"
    >
      <div
        className="flex max-h-[calc(100vh-max(0.75rem,env(safe-area-inset-top))-0.5rem)] max-h-[calc(100dvh-max(0.75rem,env(safe-area-inset-top))-0.5rem)] w-full animate-[sheet-up_260ms_cubic-bezier(0.22,1,0.36,1)] flex-col overflow-hidden rounded-t-[28px] border border-white/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,255,0.78))] shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-3xl sm:max-h-[calc(100vh-max(1rem,env(safe-area-inset-top))-0.75rem)] sm:max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top))-0.75rem)] sm:rounded-t-[30px] md:max-h-[calc(100dvh-3rem)] md:max-w-md md:animate-none md:rounded-[28px] md:border-transparent md:bg-surface/95 md:backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex justify-center px-4 pb-1.5 pt-2.5 sm:pb-2 sm:pt-3 md:hidden">
          <div className="h-1.5 w-11 rounded-full bg-black/12 shadow-[inset_0_1px_1px_rgba(255,255,255,0.55)]" aria-hidden="true" />
        </div>

        <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-1 sm:gap-4 sm:pb-4 md:mb-6 md:p-6 md:pb-0">
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Display</p>
            <h2 className="font-headline text-xl text-on-surface md:text-2xl">Gallery settings</h2>
            <p className="text-xs leading-5 text-on-surface-variant sm:text-sm sm:leading-6">
              Choose how many columns the waterfall uses while keeping the presentation stable.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close gallery settings"
            onClick={onClose}
            className="hidden min-h-11 shrink-0 items-center rounded-full bg-surface-container px-4 text-sm font-medium text-on-surface transition-colors duration-200 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:inline-flex"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3 pt-1 sm:space-y-5 sm:px-4 sm:pb-4 md:space-y-6 md:px-6 md:pb-6">
          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Sort order</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {sortOptions.map((option) => {
                const isSelected = option.value === sortPreference;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectSortPreference(option.value)}
                    className={getOptionButtonClasses(isSelected)}
                  >
                    {renderOptionContent(option.label, isSelected)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Media source</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {visibleMediaSourceOptions.map((option) => {
                const isSelected = option.value === mediaSourcePreference;
                const status = option.value === 'auto' ? undefined : mediaSourceStatuses.find((item) => item.source === option.value);
                const isDisabled = status?.isDisabled ?? false;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={isDisabled}
                    onClick={() => onSelectMediaSourcePreference(option.value)}
                    className={getOptionButtonClasses(isSelected, isDisabled)}
                  >
                    {renderOptionContent(option.label, isSelected)}
                  </button>
                );
              })}
            </div>
            {qiniuStatus !== undefined && (
              <div className="rounded-2xl border border-white/45 bg-white/45 px-4 py-3 text-sm text-on-surface-variant">
                <p className="text-xs text-on-surface-variant">Auto uses the default remote fallback order. Server local stays manual only.</p>
                <div className="mt-3 flex items-center justify-between gap-4 text-on-surface">
                  <span className="font-medium">Qiniu monthly traffic</span>
                  <span>
                    {formatGigabytes(qiniuUsedBytes)} / {formatGigabytes(qiniuQuotaBytes)} GB
                  </span>
                </div>
                <div
                  className="mt-3 h-2 overflow-hidden rounded-full bg-black/8"
                  role="progressbar"
                  aria-label="Qiniu monthly traffic usage"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={qiniuUsagePercentRounded}
                  aria-valuetext={`${formatGigabytes(qiniuUsedBytes)} of ${formatGigabytes(qiniuQuotaBytes)} GB used`}
                >
                  <div
                    className={`h-full rounded-full ${qiniuUsageBarClasses}`}
                    style={{ width: `${qiniuUsagePercent}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-on-surface-variant">
                  {qiniuStatus.message ?? (qiniuStatus.isDisabled ? 'Qiniu is unavailable.' : 'Qiniu is available.')}
                </p>
              </div>
            )}
          </div>

          <div className={getSectionCardClasses()}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Waterfall columns</p>
            <div className="space-y-3">
              <button
                type="button"
                aria-pressed={columnPreference === 'auto'}
                onClick={() => onSelectColumnPreference('auto')}
                className={`w-full ${getOptionButtonClasses(columnPreference === 'auto')}`}
              >
                {renderOptionContent('Auto', columnPreference === 'auto')}
              </button>
              <div className="rounded-[20px] border border-white/45 bg-white/50 p-3 shadow-[0_6px_18px_rgba(15,23,42,0.05)] md:rounded-2xl md:border-transparent md:bg-surface-container md:shadow-none">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-on-surface">Fixed columns</p>
                    <p className="text-xs text-on-surface-variant">
                      Choose a fixed count from {MIN_GALLERY_COLUMN_COUNT} to {MAX_GALLERY_COLUMN_COUNT}.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <button
                      type="button"
                      aria-label="Decrease waterfall columns"
                      disabled={currentFixedColumnCount <= MIN_GALLERY_COLUMN_COUNT}
                      onClick={decreaseColumnCount}
                      className={getOptionButtonClasses(false, currentFixedColumnCount <= MIN_GALLERY_COLUMN_COUNT)}
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <output
                      aria-live="polite"
                      aria-label="Selected waterfall column count"
                      className="inline-flex min-h-14 min-w-16 items-center justify-center rounded-[20px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(244,248,255,0.92))] px-4 text-base font-semibold text-primary shadow-[0_14px_34px_rgba(15,23,42,0.12)] md:min-h-12 md:min-w-14 md:rounded-2xl md:border-primary/30 md:bg-primary/14 md:text-sm md:shadow-none"
                    >
                      {currentFixedColumnCount}
                    </output>
                    <button
                      type="button"
                      aria-label="Increase waterfall columns"
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
                    Auto still follows the current responsive breakpoints. Use the stepper to switch to a fixed layout.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.62),rgba(247,249,255,0.88))] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-16px_36px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:px-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))] sm:pt-3 md:hidden">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-14 w-full items-center justify-center rounded-[18px] bg-white/78 px-4 text-base font-semibold text-on-surface shadow-[0_10px_22px_rgba(15,23,42,0.08)] transition-colors duration-200 hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Close settings
          </button>
        </div>
      </div>
    </div>
  );
}
