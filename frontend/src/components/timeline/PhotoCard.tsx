import type { Photo } from '../../types/photo';

export type PhotoCardVariant = 'portrait' | 'square' | 'wide';

type PhotoCardProps = {
  photo: Photo;
  variant?: PhotoCardVariant;
  onOpen: (photoId: string) => void;
};

const variantClassNames: Record<PhotoCardVariant, string> = {
  portrait: 'aspect-[4/5] rounded-[2rem] sm:col-span-1',
  square: 'aspect-square rounded-[1.75rem] sm:col-span-1',
  wide: 'aspect-[16/10] rounded-[2.25rem] sm:col-span-2',
};

export function PhotoCard({ photo, variant = 'portrait', onOpen }: PhotoCardProps) {
  const timeLabel = new Date(photo.sortTime).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <button
      type="button"
      onClick={() => onOpen(photo.id)}
      aria-label={`Open ${photo.filename}`}
      className={`group relative overflow-hidden border border-black/5 bg-surface-container text-left shadow-sm transition duration-300 hover:-translate-y-1.5 hover:shadow-ambient focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${variantClassNames[variant]}`}
    >
      <img
        src={photo.thumbnailUrl}
        alt={photo.filename}
        loading="lazy"
        className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-5 py-5 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold uppercase tracking-[0.2em] text-white/72">Captured</p>
          <p className="mt-1 truncate text-lg font-semibold">{photo.filename}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs font-medium text-white/85 backdrop-blur-sm">
          {timeLabel}
        </span>
      </div>
    </button>
  );
}
