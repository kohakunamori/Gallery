import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExhibitionStatusPanel } from '../components/exhibition/ExhibitionStatusPanel';
import { LoadTrigger } from '../components/exhibition/LoadTrigger';
import {
  getInitialVisibleCount,
  getLoadMoreCount,
  getLoadTriggerRootMargin,
  resolveColumnCount,
  WaterfallGallery,
} from '../components/exhibition/WaterfallGallery';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchAlbums } from '../services/albums';
import { fetchPhotos } from '../services/photos';
import type { Album } from '../types/album';
import type { Photo } from '../types/photo';
import { filterPhotosByAlbum } from '../utils/albumRoute';
import {
  normalizeGalleryMediaSourcePreference,
  readGallerySettings,
  type GalleryColumnPreference,
  type GalleryConcreteMediaSource,
} from '../utils/gallerySettings';
import { sortPhotos } from '../utils/sortPhotos';

const DEFAULT_VIEWPORT_WIDTH = 1280;

type AlbumDetailPageProps = {
  albumId: string;
};

function resolveConcreteMediaSource(): GalleryConcreteMediaSource {
  const preference = normalizeGalleryMediaSourcePreference(readGallerySettings().mediaSourcePreference);

  return preference === 'auto' ? 'r2' : preference;
}

function getViewportWidth() {
  return typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth;
}

function getResolvedColumnCount(columnPreference: GalleryColumnPreference) {
  return resolveColumnCount(getViewportWidth(), columnPreference);
}

export function AlbumDetailPage({ albumId }: AlbumDetailPageProps) {
  const [persistedSettings] = useState(readGallerySettings);
  const columnPreference = persistedSettings.columnPreference;
  const sortPreference = persistedSettings.sortPreference;

  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [visibleCount, setVisibleCount] = useState(() =>
    getInitialVisibleCount(getResolvedColumnCount(columnPreference)),
  );
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const mediaSource = resolveConcreteMediaSource();

    setStatus('loading');
    setVisibleCount(getInitialVisibleCount(getResolvedColumnCount(columnPreference)));
    setSelectedPhotoId(null);

    const load = async () => {
      try {
        const [albumItems, photoItems] = await Promise.all([
          fetchAlbums(mediaSource).catch(() => [] as Album[]),
          fetchPhotos(mediaSource, controller.signal),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const matchedAlbum = albumItems.find((item) => item.id === albumId) ?? null;
        const albumPhotos = filterPhotosByAlbum(photoItems, albumId);

        setAlbum(matchedAlbum);
        setPhotos(albumPhotos);
        setStatus(albumPhotos.length === 0 ? 'empty' : 'ready');
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setStatus('error');
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [albumId, columnPreference, reloadKey]);

  const sortedPhotos = useMemo(() => sortPhotos(photos, sortPreference), [photos, sortPreference]);
  const visiblePhotos = useMemo(
    () => sortedPhotos.slice(0, visibleCount),
    [sortedPhotos, visibleCount],
  );
  const resolvedColumnCount = useMemo(
    () => getResolvedColumnCount(columnPreference),
    [columnPreference],
  );
  const loadMoreCount = getLoadMoreCount(resolvedColumnCount);
  const loadTriggerRootMargin = getLoadTriggerRootMargin(resolvedColumnCount);
  const hasMorePhotos = visibleCount < sortedPhotos.length;
  const selectedIndex = useMemo(
    () => sortedPhotos.findIndex((photo) => photo.id === selectedPhotoId),
    [selectedPhotoId, sortedPhotos],
  );

  const loadMore = useCallback(() => {
    if (!hasMorePhotos) {
      return;
    }

    setVisibleCount((current) => Math.min(current + loadMoreCount, sortedPhotos.length));
  }, [hasMorePhotos, loadMoreCount, sortedPhotos.length]);

  const openPhoto = useCallback((photoId: string) => {
    setSelectedPhotoId(photoId);
  }, []);

  const closeViewer = useCallback(() => {
    setSelectedPhotoId(null);
  }, []);

  const selectPhotoAtIndex = useCallback(
    (index: number) => {
      const nextPhoto = sortedPhotos[index];

      if (!nextPhoto) {
        return;
      }

      setSelectedPhotoId(nextPhoto.id);
    },
    [sortedPhotos],
  );

  const retryLoad = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  const title = album?.name ?? albumId;
  const photoCountLabel =
    status === 'ready'
      ? sortedPhotos.length === 1
        ? '1 photo'
        : `${sortedPhotos.length} photos`
      : status === 'loading'
        ? 'Loading album…'
        : null;

  return (
    <>
      <main className="min-h-screen bg-surface text-on-surface">
        <section className="mx-auto max-w-6xl px-4 pt-10 pb-6 md:px-8 md:pt-14">
          <a className="text-sm font-medium text-primary hover:underline" href="/albums">
            Back to albums
          </a>

          <div className="mt-8">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Album</p>
            <h1 className="mt-3 font-headline text-4xl font-bold tracking-[-0.04em] text-on-surface md:text-5xl">
              {title}
            </h1>
            {photoCountLabel ? (
              <p className="mt-3 text-[11px] font-medium uppercase tracking-[0.24em] text-outline">
                {photoCountLabel}
              </p>
            ) : (
              <div className="mt-3 h-4" aria-hidden="true" />
            )}
          </div>
        </section>

        <section className="mx-auto max-w-[2400px] px-4 pb-24 md:px-6 lg:px-12">
          {status === 'loading' && (
            <div
              aria-busy="true"
              aria-label="Loading album photos"
              className="gallery-shimmer h-64 rounded-3xl bg-surface-container-low"
              data-testid="album-detail-skeleton"
            />
          )}

          {status === 'error' && (
            <ExhibitionStatusPanel
              variant="error"
              title="Unable to load this album"
              description="Something went wrong while fetching photos for this collection. Check your connection and try again."
              primaryAction={{ label: 'Retry', onClick: retryLoad }}
              secondaryHref={{ label: 'Back to albums', href: '/albums' }}
            />
          )}

          {status === 'empty' && (
            <ExhibitionStatusPanel
              variant="empty"
              title="No photos in this album"
              description="This album has no matching works for the current media source."
              primaryHref={{ label: 'Browse albums', href: '/albums' }}
              secondaryHref={{ label: 'Back to gallery', href: '/' }}
            />
          )}

          {status === 'ready' && (
            <div>
              <WaterfallGallery
                photos={visiblePhotos}
                columnPreference={columnPreference}
                onOpen={openPhoto}
              />
              <LoadTrigger
                disabled={false}
                isComplete={!hasMorePhotos}
                onLoadMore={loadMore}
                resetKey={visibleCount}
                rootMargin={loadTriggerRootMargin}
              />
            </div>
          )}
        </section>
      </main>

      {status === 'ready' && selectedIndex >= 0 && (
        <PhotoViewerModal
          photos={sortedPhotos}
          selectedIndex={selectedIndex}
          onSelectIndex={selectPhotoAtIndex}
          onClose={closeViewer}
        />
      )}
    </>
  );
}
