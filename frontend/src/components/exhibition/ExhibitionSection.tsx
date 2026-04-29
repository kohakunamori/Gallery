import { memo } from 'react';
import type { Photo } from '../../types/photo';
import type { GalleryColumnPreference } from '../../utils/gallerySettings';
import { WaterfallGallery } from './WaterfallGallery';

type ExhibitionSectionProps = {
  title: string;
  photos: Photo[];
  columnPreference: GalleryColumnPreference;
  onOpen: (photoId: string) => void;
};

export const ExhibitionSection = memo(function ExhibitionSection({ title, photos, columnPreference, onOpen }: ExhibitionSectionProps) {
  return (
    <section className="mb-16">
      <div className="mb-6 flex items-center gap-4">
        <h2 className="font-headline text-[11px] font-semibold uppercase tracking-[0.2em] text-outline">{title}</h2>
        <div className="h-px flex-1 bg-surface-container-high" aria-hidden="true" />
      </div>
      <WaterfallGallery photos={photos} columnPreference={columnPreference} onOpen={onOpen} />
    </section>
  );
});
