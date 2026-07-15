import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from 'react';
import type { Photo } from '../../types/photo';
import { trapTabKey } from '../../utils/dialogFocus';
import { getCachedPhotoImageUrl, markPhotoImageAsLoaded, preloadPhotoImage } from '../exhibition/WaterfallCard';

type PhotoViewerModalProps = {
  photos: Photo[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
};

type ImageStatus = 'loading' | 'loaded' | 'error';

type HeldImage = {
  photoId: string;
  url: string;
};

const SWIPE_THRESHOLD_PX = 48;

const GLASS_ICON_BUTTON_CLASS =
  'absolute flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40 disabled:cursor-not-allowed disabled:opacity-30';

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.5 6.5L9 12l5.5 5.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 6.5L15 12l-5.5 5.5" />
    </svg>
  );
}

function resolvePhotoImageUrl(photo: Photo) {
  return getCachedPhotoImageUrl(photo.id) ?? photo.url;
}

export function PhotoViewerModal({ photos, selectedIndex, onSelectIndex, onClose }: PhotoViewerModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePhotoIdRef = useRef<string | null>(null);
  const photo = photos[selectedIndex];
  const [displayedImageUrl, setDisplayedImageUrl] = useState(() => (photo ? resolvePhotoImageUrl(photo) : ''));
  const [imageStatus, setImageStatus] = useState<ImageStatus>('loading');
  const [loadedPhotoId, setLoadedPhotoId] = useState<string | null>(null);
  const [heldImage, setHeldImage] = useState<HeldImage | null>(null);
  const [loadGeneration, setLoadGeneration] = useState(0);

  useEffect(() => {
    if (photo === undefined) {
      return;
    }

    activePhotoIdRef.current = photo.id;
    setDisplayedImageUrl(resolvePhotoImageUrl(photo));
    setImageStatus('loading');
    setLoadedPhotoId(null);
  }, [photo?.id, photo?.url]);

  useEffect(() => {
    if (photo === undefined || loadedPhotoId !== photo.id) {
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
  }, [loadedPhotoId, photo, photos, selectedIndex]);

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      const previous = previouslyFocusedElementRef.current;
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, []);

  if (selectedIndex < 0 || selectedIndex >= photos.length || photo === undefined) {
    return null;
  }

  const isFirstPhoto = selectedIndex === 0;
  const isLastPhoto = selectedIndex === photos.length - 1;
  const showHeldImage = heldImage !== null && heldImage.photoId !== photo.id && imageStatus === 'loading';
  const imageIsVisible = imageStatus === 'loaded';

  const selectPreviousPhoto = () => {
    if (!isFirstPhoto) {
      onSelectIndex(selectedIndex - 1);
    }
  };

  const selectNextPhoto = () => {
    if (!isLastPhoto) {
      onSelectIndex(selectedIndex + 1);
    }
  };

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
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (!isFirstPhoto) {
        event.preventDefault();
        selectPreviousPhoto();
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      if (!isLastPhoto) {
        event.preventDefault();
        selectNextPhoto();
      }
    }
  };

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];

    if (touch === undefined) {
      return;
    }

    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touchStart = touchStartRef.current;
    const touch = event.changedTouches[0];

    touchStartRef.current = null;

    if (touchStart === null || touch === undefined) {
      return;
    }

    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      selectNextPhoto();
      return;
    }

    selectPreviousPhoto();
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
  };

  const handleImageLoad = (eventPhotoId: string, url: string) => {
    if (activePhotoIdRef.current !== eventPhotoId) {
      return;
    }

    markPhotoImageAsLoaded(eventPhotoId, url);
    setLoadedPhotoId(eventPhotoId);
    setImageStatus('loaded');
    setHeldImage({ photoId: eventPhotoId, url });
  };

  const handleImageError = (eventPhotoId: string, failedUrl: string) => {
    if (activePhotoIdRef.current !== eventPhotoId) {
      return;
    }

    if (failedUrl !== photo.url) {
      setDisplayedImageUrl(photo.url);
      setImageStatus('loading');
      return;
    }

    setImageStatus('error');
    setLoadedPhotoId(null);
    setHeldImage(null);
  };

  const handleRetry = () => {
    activePhotoIdRef.current = photo.id;
    setHeldImage(null);
    setDisplayedImageUrl(resolvePhotoImageUrl(photo));
    setImageStatus('loading');
    setLoadedPhotoId(null);
    setLoadGeneration((generation) => generation + 1);
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
        className={`${GLASS_ICON_BUTTON_CLASS} right-4 top-4 md:right-8 md:top-8`}
      >
        <CloseIcon />
      </button>

      <button
        type="button"
        aria-label="Previous image"
        disabled={isFirstPhoto}
        onClick={selectPreviousPhoto}
        className={`${GLASS_ICON_BUTTON_CLASS} left-4 top-1/2 -translate-y-1/2 md:left-8`}
      >
        <ChevronLeftIcon />
      </button>

      <div
        className="flex max-h-full max-w-6xl flex-col items-center gap-4"
        onClick={(event) => event.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        data-testid="lightbox-content"
      >
        <div
          className="relative flex max-h-[80vh] max-w-full items-center justify-center"
          style={
            photo.width && photo.height
              ? { aspectRatio: `${photo.width} / ${photo.height}`, width: 'min(100%, 72rem)' }
              : undefined
          }
          data-testid="lightbox-image-frame"
        >
          {imageStatus === 'loading' && !showHeldImage && (
            <div
              className="gallery-shimmer absolute inset-0 min-h-[12rem] min-w-[12rem] rounded-lg bg-white/10"
              data-testid="lightbox-loading"
              aria-hidden="true"
            />
          )}

          {showHeldImage && heldImage !== null && (
            <img
              src={heldImage.url}
              alt=""
              aria-hidden="true"
              className="max-h-[80vh] max-w-full object-contain"
            />
          )}

          {imageStatus === 'loading' && showHeldImage && (
            <div
              className="pointer-events-none absolute bottom-3 left-1/2 z-10 h-1.5 w-16 -translate-x-1/2 overflow-hidden rounded-full bg-white/15"
              data-testid="lightbox-loading"
              aria-hidden="true"
            >
              <div className="gallery-shimmer h-full w-full rounded-full" />
            </div>
          )}

          {imageStatus !== 'error' && (
            <img
              key={`${photo.id}-${displayedImageUrl}-${loadGeneration}`}
              src={displayedImageUrl}
              alt={photo.filename}
              fetchPriority="high"
              decoding="async"
              width={photo.width ?? undefined}
              height={photo.height ?? undefined}
              className={`viewer-photo-fade max-h-[80vh] max-w-full object-contain transition-opacity duration-200 ease-out motion-reduce:transition-none ${
                imageIsVisible ? 'opacity-100' : showHeldImage ? 'absolute inset-0 m-auto opacity-0' : 'opacity-0'
              }`}
              onLoad={() => {
                handleImageLoad(photo.id, displayedImageUrl);
              }}
              onError={() => {
                handleImageError(photo.id, displayedImageUrl);
              }}
            />
          )}

          {imageStatus === 'error' && (
            <div
              className="flex min-h-[12rem] min-w-[16rem] flex-col items-center justify-center gap-3 rounded-lg bg-black/35 px-6 py-10 text-center"
              data-testid="lightbox-error"
            >
              <p className="text-sm font-medium tracking-wide text-white/85">Image unavailable</p>
              <button
                type="button"
                onClick={handleRetry}
                className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black/40"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <div className="flex w-full max-w-full flex-col items-center gap-1 px-2 text-center sm:flex-row sm:justify-between sm:gap-4 sm:text-left">
          <p className="max-w-full truncate text-sm text-white/85" title={photo.filename}>
            {photo.filename}
          </p>
          <p className="shrink-0 text-sm text-white/85">
            {selectedIndex + 1} / {photos.length}
          </p>
        </div>
      </div>

      <button
        type="button"
        aria-label="Next image"
        disabled={isLastPhoto}
        onClick={selectNextPhoto}
        className={`${GLASS_ICON_BUTTON_CLASS} right-4 top-1/2 -translate-y-1/2 md:right-8`}
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
