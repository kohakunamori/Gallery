import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Photo } from '../../types/photo';
import { getCachedPhotoImageUrl, markPhotoImageAsLoaded, preloadPhotoImage } from '../exhibition/WaterfallCard';

type PhotoViewerModalProps = {
  photos: Photo[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
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

export function PhotoViewerModal({ photos, selectedIndex, onSelectIndex, onClose }: PhotoViewerModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const photo = photos[selectedIndex];
  const [displayedImageUrl, setDisplayedImageUrl] = useState(() => (photo ? getCachedPhotoImageUrl(photo.id) ?? photo.url : ''));

  useEffect(() => {
    if (photo === undefined) {
      return;
    }

    setDisplayedImageUrl(getCachedPhotoImageUrl(photo.id) ?? photo.url);
  }, [photo?.id, photo?.url]);

  useEffect(() => {
    if (photo === undefined) {
      return;
    }

    const previousPhoto = photos[selectedIndex - 1];
    const nextPhoto = photos[selectedIndex + 1];

    if (previousPhoto !== undefined) {
      preloadPhotoImage(previousPhoto.id, previousPhoto.url);
    }

    if (nextPhoto !== undefined) {
      preloadPhotoImage(nextPhoto.id, nextPhoto.url);
    }
  }, [photo, photos, selectedIndex]);

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  if (selectedIndex < 0 || selectedIndex >= photos.length || photo === undefined) {
    return null;
  }

  const isFirstPhoto = selectedIndex === 0;
  const isLastPhoto = selectedIndex === photos.length - 1;

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
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (!isFirstPhoto) {
        event.preventDefault();
        onSelectIndex(selectedIndex - 1);
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      if (!isLastPhoto) {
        event.preventDefault();
        onSelectIndex(selectedIndex + 1);
      }
    }
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 text-white backdrop-blur-md md:px-8"
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
      tabIndex={-1}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      data-testid="lightbox-backdrop"
    >
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="Close image"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-black/40 px-4 py-2 text-sm font-medium text-white backdrop-blur md:right-8 md:top-8"
      >
        Close
      </button>

      <button
        type="button"
        aria-label="Previous image"
        disabled={isFirstPhoto}
        onClick={() => onSelectIndex(selectedIndex - 1)}
        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-4 py-4 text-sm font-medium text-white backdrop-blur disabled:cursor-not-allowed disabled:opacity-30 md:left-8"
      >
        Prev
      </button>

      <div className="flex max-h-full max-w-6xl flex-col items-center gap-4" onClick={(event) => event.stopPropagation()}>
        <img
          src={displayedImageUrl}
          alt={photo.filename}
          className="max-h-[80vh] max-w-full object-contain"
          onLoad={() => {
            markPhotoImageAsLoaded(photo.id, displayedImageUrl);
          }}
          onError={() => {
            if (displayedImageUrl !== photo.url) {
              setDisplayedImageUrl(photo.url);
            }
          }}
        />
        <p className="text-sm text-white/70">
          {selectedIndex + 1} / {photos.length}
        </p>
      </div>

      <button
        type="button"
        aria-label="Next image"
        disabled={isLastPhoto}
        onClick={() => onSelectIndex(selectedIndex + 1)}
        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/40 px-4 py-4 text-sm font-medium text-white backdrop-blur disabled:cursor-not-allowed disabled:opacity-30 md:right-8"
      >
        Next
      </button>
    </div>
  );
}
