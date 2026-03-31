import { useMemo, useState } from 'react';
import type { Photo } from '../../types/photo';

type WaterfallCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
};

export function WaterfallCard({ photo, onOpen }: WaterfallCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
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
      className="group mb-2 block w-full overflow-hidden rounded-xl bg-surface-container-low text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [break-inside:avoid]"
    >
      <div className="relative overflow-hidden" data-testid="waterfall-card-frame" style={{ aspectRatio }}>
        <img
          src={photo.thumbnailUrl}
          alt={photo.filename}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={`block h-full w-full object-cover transition-all duration-500 ${
            isLoaded ? 'opacity-100 group-hover:scale-[1.03]' : 'opacity-0'
          }`}
        />
        <div className="absolute inset-0 flex items-end bg-black/10 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white">View details</span>
        </div>
      </div>
    </button>
  );
}
