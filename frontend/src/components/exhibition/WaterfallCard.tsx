import { useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../../types/photo';

type WaterfallCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
  shouldPreload?: boolean;
  onEnterViewport?: (photoId: string) => void;
};

const IMAGE_ROOT_MARGIN = '1200px 0px';
const MAX_CACHED_PHOTO_IMAGE_COUNT = 400;
const preloadedImageUrls = new Set<string>();
const cachedImageUrlsByPhotoId = new Map<string, string>();

type PreloadImage = {
  decode?: () => Promise<void>;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  src: string;
};

function trimCachedPhotoImages() {
  while (cachedImageUrlsByPhotoId.size > MAX_CACHED_PHOTO_IMAGE_COUNT) {
    const oldestPhotoId = cachedImageUrlsByPhotoId.keys().next().value;

    if (oldestPhotoId === undefined) {
      return;
    }

    cachedImageUrlsByPhotoId.delete(oldestPhotoId);
  }
}

export function markPhotoImageAsLoaded(photoId: string, url: string) {
  preloadedImageUrls.add(url);

  if (cachedImageUrlsByPhotoId.get(photoId) === url) {
    return;
  }

  if (cachedImageUrlsByPhotoId.has(photoId)) {
    cachedImageUrlsByPhotoId.delete(photoId);
  }

  cachedImageUrlsByPhotoId.set(photoId, url);
  trimCachedPhotoImages();
}

export function resetPreloadedImages() {
  preloadedImageUrls.clear();
  cachedImageUrlsByPhotoId.clear();
}

export function markImageAsPreloadedForTest(url: string) {
  preloadedImageUrls.add(url);
}

export function cachePhotoImageForTest(photoId: string, url: string) {
  markPhotoImageAsLoaded(photoId, url);
}

export function isImagePreloaded(url: string) {
  return preloadedImageUrls.has(url);
}

export function getCachedPhotoImageUrl(photoId: string) {
  return cachedImageUrlsByPhotoId.get(photoId);
}

function getInitialDisplayedThumbnailUrl(photo: Photo) {
  return getCachedPhotoImageUrl(photo.id) ?? (isImagePreloaded(photo.thumbnailUrl) ? photo.thumbnailUrl : null);
}

export function preloadPhotoImage(photoId: string, url: string, onSuccess?: () => void) {
  if (typeof Image === 'undefined') {
    return;
  }

  if (isImagePreloaded(url)) {
    markPhotoImageAsLoaded(photoId, url);
    onSuccess?.();
    return;
  }

  const image = new Image() as PreloadImage;
  let hasCompleted = false;

  const handleSuccess = () => {
    if (hasCompleted) {
      return;
    }

    hasCompleted = true;
    markPhotoImageAsLoaded(photoId, url);
    onSuccess?.();
  };

  image.onload = handleSuccess;
  image.onerror = null;
  image.src = url;
  image.decode?.().then(handleSuccess).catch(() => undefined);
}

export function WaterfallCard({ photo, onOpen, shouldPreload = false, onEnterViewport }: WaterfallCardProps) {
  const [displayedThumbnailUrl, setDisplayedThumbnailUrl] = useState<string | null>(() => getInitialDisplayedThumbnailUrl(photo));
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderImage, setShouldRenderImage] = useState(false);
  const isLoaded = displayedThumbnailUrl !== null;
  const imageUrl = displayedThumbnailUrl ?? photo.thumbnailUrl;

  useEffect(() => {
    if (shouldPreload) {
      preloadPhotoImage(photo.id, photo.thumbnailUrl);
    }
  }, [photo.id, photo.thumbnailUrl, shouldPreload]);

  useEffect(() => {
    setDisplayedThumbnailUrl(getInitialDisplayedThumbnailUrl(photo));
  }, [photo]);

  useEffect(() => {
    if (!shouldRenderImage || displayedThumbnailUrl === photo.thumbnailUrl) {
      return;
    }

    preloadPhotoImage(photo.id, photo.thumbnailUrl, () => {
      setDisplayedThumbnailUrl(photo.thumbnailUrl);
    });
  }, [displayedThumbnailUrl, photo.id, photo.thumbnailUrl, shouldRenderImage]);

  useEffect(() => {
    if (cardRef.current === null) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRenderImage(true);
          onEnterViewport?.(photo.id);
        }
      },
      { rootMargin: IMAGE_ROOT_MARGIN },
    );

    observer.observe(cardRef.current);

    return () => observer.disconnect();
  }, [onEnterViewport, photo.id]);

  const aspectRatio = useMemo(() => {
    if (photo.width !== null && photo.height !== null && photo.width > 0 && photo.height > 0) {
      return `${photo.width} / ${photo.height}`;
    }

    return '4 / 3';
  }, [photo.height, photo.width]);

  return (
    <button
      type="button"
      aria-label={`Open ${photo.filename}`}
      onClick={() => onOpen(photo.id)}
      className="group block w-full overflow-hidden rounded-xl bg-surface-container-low text-left shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition-transform duration-500 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div ref={cardRef} className="relative overflow-hidden" data-testid="waterfall-card-frame" style={{ aspectRatio }}>
        <div className="absolute inset-0 bg-surface-container-low transition-opacity duration-700 ease-out group-hover:opacity-60" />
        {shouldRenderImage && (
          <img
            src={imageUrl}
            alt={photo.filename}
            loading={shouldPreload ? 'eager' : 'lazy'}
            fetchPriority={shouldPreload ? 'high' : undefined}
            onLoad={() => {
              markPhotoImageAsLoaded(photo.id, imageUrl);
              setDisplayedThumbnailUrl(imageUrl);
            }}
            onError={() => {
              if (imageUrl !== photo.thumbnailUrl) {
                setDisplayedThumbnailUrl(photo.thumbnailUrl);
              }
            }}
            className={`block h-full w-full object-cover transition-[opacity,transform,filter] duration-700 ease-out ${
              isLoaded ? 'opacity-100 saturate-100 group-hover:scale-[1.02]' : 'scale-[1.015] opacity-0 saturate-75'
            }`}
          />
        )}
        <div
          className={`absolute inset-0 bg-gradient-to-t from-black/20 via-black/0 to-transparent transition-opacity duration-500 ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
        <div className="absolute inset-0 flex items-end p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white/92">View details</span>
        </div>
      </div>
    </button>
  );
}
