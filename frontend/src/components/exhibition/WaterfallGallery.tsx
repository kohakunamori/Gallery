import type { Photo } from '../../types/photo';
import { WaterfallCard } from './WaterfallCard';

type WaterfallGalleryProps = {
  photos: Photo[];
  onOpen: (photoId: string) => void;
};

export function WaterfallGallery({ photos, onOpen }: WaterfallGalleryProps) {
  return (
    <div className="columns-1 gap-2 sm:columns-2 lg:columns-3 2xl:columns-4">
      {photos.map((photo) => (
        <WaterfallCard key={photo.id} photo={photo} onOpen={onOpen} />
      ))}
    </div>
  );
}
