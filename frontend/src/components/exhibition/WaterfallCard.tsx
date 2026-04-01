import { useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../../types/photo';

type WaterfallCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
};

export function WaterfallCard({ photo, onOpen }: WaterfallCardProps) {
  const [loadedThumbnailUrl, setLoadedThumbnailUrl] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shouldRenderImage, setShouldRenderImage] = useState(false);
  const isLoaded = loadedThumbnailUrl === photo.thumbnailUrl;

  useEffect(() => {
    if (cardRef.current === null) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldRenderImage(true);
        }
      },
      { rootMargin: '1200px 0px' },
    );

    observer.observe(cardRef.current);

    return () => observer.disconnect();
  }, []);

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
            src={photo.thumbnailUrl}
            alt={photo.filename}
            loading="lazy"
            onLoad={() => setLoadedThumbnailUrl(photo.thumbnailUrl)}
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
