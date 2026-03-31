import type { Photo } from '../../types/photo';
import { PhotoCard, type PhotoCardVariant } from './PhotoCard';

type TimelineSectionProps = {
  title: string;
  photos: Photo[];
  onOpen: (photoId: string) => void;
};

const cardVariants: PhotoCardVariant[] = ['portrait', 'wide', 'square'];

export function TimelineSection({ title, photos, onOpen }: TimelineSectionProps) {
  return (
    <section className="rounded-[2rem] border border-black/5 bg-surface/80 p-5 shadow-sm backdrop-blur-sm md:p-7">
      <div className="mb-6 flex items-baseline justify-between border-b border-outline/20 pb-6">
        <h2 className="font-headline text-[3.5rem] font-extrabold leading-none tracking-tighter text-on-surface">{title}</h2>
        <span className="rounded-full bg-primary-fixed px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">
          New Moments
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo, index) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            variant={cardVariants[index % cardVariants.length]}
            onOpen={onOpen}
          />
        ))}
      </div>
    </section>
  );
}
