import { useCallback, useEffect, useState } from 'react';
import { ExhibitionStatusPanel } from '../components/exhibition/ExhibitionStatusPanel';
import { fetchAlbums } from '../services/albums';
import type { Album } from '../types/album';
import { buildAlbumPath } from '../utils/albumRoute';

function formatPhotoCount(count: number): string {
  return count === 1 ? '1 photo' : `${count} photos`;
}

export function AlbumsPage() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    setStatus('loading');

    fetchAlbums()
      .then((items) => {
        if (controller.signal.aborted) {
          return;
        }

        setAlbums(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }

        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  const retryLoad = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  return (
    <main className="min-h-screen bg-surface text-on-surface">
      <section className="mx-auto max-w-6xl px-4 pt-10 pb-6 md:px-8 md:pt-14">
        <a className="text-sm font-medium text-primary hover:underline" href="/">
          Back to gallery
        </a>

        <div className="mt-8">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Albums</p>
          <h1 className="mt-3 font-headline text-4xl font-bold tracking-[-0.04em] text-on-surface md:text-5xl">
            Browse by album
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-on-surface-variant">
            Open a collection to view its waterfall of works. Deep links use{' '}
            <code className="rounded bg-surface-container-low px-1.5 py-0.5 text-sm">/albums</code> and{' '}
            <code className="rounded bg-surface-container-low px-1.5 py-0.5 text-sm">/albums/&#123;id&#125;</code>.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
        {status === 'loading' && (
          <div
            aria-busy="true"
            aria-label="Loading albums"
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="albums-skeleton"
          >
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient"
              >
                <div className="gallery-shimmer aspect-[4/3] w-full bg-surface-container-low" />
                <div className="space-y-2 p-5">
                  <div className="gallery-shimmer h-4 w-1/2 rounded bg-surface-container-low" />
                  <div className="gallery-shimmer h-3 w-1/3 rounded bg-surface-container-low" />
                </div>
              </div>
            ))}
          </div>
        )}

        {status === 'error' && (
          <ExhibitionStatusPanel
            variant="error"
            title="Unable to load albums"
            description="Something went wrong while fetching album collections. Check your connection and try again."
            primaryAction={{ label: 'Retry', onClick: retryLoad }}
            secondaryHref={{ label: 'Back to gallery', href: '/' }}
          />
        )}

        {status === 'empty' && (
          <ExhibitionStatusPanel
            variant="empty"
            title="No albums yet"
            description="Albums appear when photos live under a folder path. Upload images into folders to start collections."
            primaryHref={{ label: 'Upload images', href: '/upload' }}
            secondaryHref={{ label: 'Back to gallery', href: '/' }}
          />
        )}

        {status === 'ready' && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="albums-grid">
            {albums.map((album) => (
              <li key={album.id}>
                <a
                  href={buildAlbumPath(album.id)}
                  className="group flex h-full flex-col overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-ambient transition-transform duration-300 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  data-testid={`album-card-${album.id}`}
                >
                  <div className="relative aspect-[4/3] overflow-hidden bg-surface-container-low">
                    <img
                      src={album.coverUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 p-5">
                    <h2 className="font-headline text-lg font-semibold tracking-[-0.02em] text-on-surface">
                      {album.name}
                    </h2>
                    <p className="text-sm text-on-surface-variant">{formatPhotoCount(album.photoCount)}</p>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
