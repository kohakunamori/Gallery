import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';

export type GalleryColumnPreference = 'auto' | 1 | 2 | 3 | 4;
export type GallerySortPreference = 'newest' | 'oldest' | 'filename-asc' | 'filename-desc';
export type GalleryMediaSourcePreference = 'r2' | 'local';

type GallerySettingsModalProps = {
  columnPreference: GalleryColumnPreference;
  sortPreference: GallerySortPreference;
  mediaSourcePreference: GalleryMediaSourcePreference;
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

const columnOptions: GalleryColumnPreference[] = ['auto', 1, 2, 3, 4];
const sortOptions: Array<{ value: GallerySortPreference; label: string }> = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'filename-asc', label: 'Filename A–Z' },
  { value: 'filename-desc', label: 'Filename Z–A' },
];
const mediaSourceOptions: Array<{ value: GalleryMediaSourcePreference; label: string }> = [
  { value: 'r2', label: 'R2' },
  { value: 'local', label: 'Server local' },
];

export function GallerySettingsModal({
  columnPreference,
  sortPreference,
  mediaSourcePreference,
  onSelectColumnPreference,
  onSelectSortPreference,
  onSelectMediaSourcePreference,
  onClose,
}: GallerySettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 py-6 text-on-surface backdrop-blur-md md:px-8"
      role="dialog"
      aria-modal="true"
      aria-label="Gallery settings"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="gallery-settings-backdrop"
    >
      <div
        className="w-full max-w-md rounded-[28px] bg-surface/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.18)] backdrop-blur-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Display</p>
            <h2 className="font-headline text-2xl text-on-surface">Gallery settings</h2>
            <p className="text-sm leading-6 text-on-surface-variant">
              Choose how many columns the waterfall uses while keeping the presentation stable.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close gallery settings"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-full bg-surface-container px-4 text-sm font-medium text-on-surface transition-colors duration-200 hover:bg-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Close
          </button>
        </div>

        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Sort order</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {sortOptions.map((option) => {
                const isSelected = option.value === sortPreference;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectSortPreference(option.value)}
                    className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      isSelected
                        ? 'border-primary/30 bg-primary/12 text-primary shadow-[0_10px_30px_rgba(37,99,235,0.14)]'
                        : 'border-transparent bg-surface-container text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Media source</p>
            <div className="grid grid-cols-2 gap-2">
              {mediaSourceOptions.map((option) => {
                const isSelected = option.value === mediaSourcePreference;

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectMediaSourcePreference(option.value)}
                    className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-4 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      isSelected
                        ? 'border-primary/30 bg-primary/12 text-primary shadow-[0_10px_30px_rgba(37,99,235,0.14)]'
                        : 'border-transparent bg-surface-container text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-on-surface-variant">Waterfall columns</p>
            <div className="grid grid-cols-5 gap-2">
              {columnOptions.map((option) => {
                const isSelected = option === columnPreference;
                const label = option === 'auto' ? 'Auto' : String(option);

                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectColumnPreference(option)}
                    className={`inline-flex min-h-12 items-center justify-center rounded-2xl border px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                      isSelected
                        ? 'border-primary/30 bg-primary/12 text-primary shadow-[0_10px_30px_rgba(37,99,235,0.14)]'
                        : 'border-transparent bg-surface-container text-on-surface hover:bg-surface-container-high'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
