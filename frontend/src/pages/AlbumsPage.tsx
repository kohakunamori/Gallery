import { useEffect, useState } from 'react';
import { AlbumCard } from '../components/albums/AlbumCard';
import { fetchAlbums } from '../services/albums';
import type { Album } from '../types/album';

export function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;

    fetchAlbums()
      .then((items) => {
        if (cancelled) {
          return;
        }

        setAlbums(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mx-auto max-w-7xl px-6 py-12 md:px-12">
      <div className="mb-10 flex items-baseline justify-between">
        <h1 className="font-headline text-5xl font-extrabold tracking-tight text-on-surface">Albums</h1>
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Folder Collections</span>
      </div>

      {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading albums…</p>}
      {status === 'error' && <p className="text-sm text-red-700">Unable to load albums right now.</p>}
      {status === 'empty' && <p className="text-sm text-on-surface-variant">No album folders found yet.</p>}
      {status === 'ready' && (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      )}
    </section>
  );
}
