import type { Photo } from '../../types/photo';

type WaterfallCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
};

export function WaterfallCard({ photo, onOpen }: WaterfallCardProps) {
  return (
    <button
      type="button"
      aria-label={`Open ${photo.filename}`}
      onClick={() => onOpen(photo.id)}
      className="group mb-2 block w-full overflow-hidden rounded-xl bg-surface-container-low text-left [break-inside:avoid]"
    >
      <div className="relative overflow-hidden">
        <img
          src={photo.thumbnailUrl}
          alt={photo.filename}
          loading="lazy"
          className="block h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 flex items-end bg-black/10 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white">View details</span>
        </div>
      </div>
    </button>
  );
}
