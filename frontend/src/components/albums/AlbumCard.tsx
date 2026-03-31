import type { Album } from '../../types/album';

type AlbumCardProps = {
  album: Album;
};

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <article className="group overflow-hidden rounded-2xl bg-surface-container-lowest shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-ambient">
      <div className="aspect-[4/3] overflow-hidden bg-surface-container">
        <img
          src={album.coverUrl}
          alt={album.name}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]"
        />
      </div>
      <div className="space-y-1 px-5 py-4">
        <h2 className="font-headline text-lg font-bold tracking-tight text-on-surface">{album.name}</h2>
        <p className="text-sm text-on-surface-variant">{album.photoCount} photos</p>
      </div>
    </article>
  );
}
