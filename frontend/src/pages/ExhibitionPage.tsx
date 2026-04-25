import { useEffect, useMemo, useRef, useState } from 'react';
import { ExhibitionHeader } from '../components/exhibition/ExhibitionHeader';
import { ExhibitionHero } from '../components/exhibition/ExhibitionHero';
import { ExhibitionSection } from '../components/exhibition/ExhibitionSection';
import { GallerySettingsModal } from '../components/exhibition/GallerySettingsModal';
import {
  normalizeGalleryMediaSourcePreference,
  readGallerySettings,
  writeGallerySettings,
} from '../utils/gallerySettings';
import type {
  GalleryColumnPreference,
  GalleryConcreteMediaSource,
  GalleryMediaSourcePreference,
  GallerySortPreference,
} from '../utils/gallerySettings';
import { LoadTrigger } from '../components/exhibition/LoadTrigger';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos } from '../services/photos';
import { fetchMediaSourceStatuses } from '../services/mediaSources';
import type { MediaSourceStatus } from '../services/mediaSources';
import type { Photo } from '../types/photo';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';
import { groupPhotosByMonth } from '../utils/groupPhotosByMonth';
import { sortPhotos } from '../utils/sortPhotos';

const INITIAL_VISIBLE_COUNT = 24;
const LOAD_MORE_COUNT = 24;
const TOP_VISIBILITY_THRESHOLD = 24;
const DOWNWARD_HIDE_THRESHOLD = 64;
const UPWARD_REVEAL_THRESHOLD = 96;
const AUTO_MEDIA_SOURCE_CANDIDATES: GalleryConcreteMediaSource[] = ['r2', 'qiniu'];
const IMAGE_PROBE_TIMEOUT_MS = 3000;

function getMediaSourceStatus(
  mediaSourceStatuses: MediaSourceStatus[],
  mediaSource: GalleryConcreteMediaSource,
): MediaSourceStatus | undefined {
  return mediaSourceStatuses.find((status) => status.source === mediaSource);
}

function getAutoMediaSourceStatusSignature(mediaSourceStatuses: MediaSourceStatus[]): string {
  return AUTO_MEDIA_SOURCE_CANDIDATES.map((mediaSource) => {
    const status = getMediaSourceStatus(mediaSourceStatuses, mediaSource);
    return `${mediaSource}:${status?.isAvailable ?? false}:${status?.isDisabled ?? false}:${status?.status ?? 'unknown'}`;
  }).join('|');
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isMediaSourceDisabled(mediaSourceStatuses: MediaSourceStatus[], mediaSource: GalleryConcreteMediaSource): boolean {
  return getMediaSourceStatus(mediaSourceStatuses, mediaSource)?.isDisabled ?? false;
}

function probeImage(url: string, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
      return;
    }

    const image = new Image();
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Image probe timed out for ${url}`));
    }, IMAGE_PROBE_TIMEOUT_MS);

    const handleAbort = () => {
      cleanup();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', handleAbort);
    };

    image.onload = () => {
      cleanup();
      resolve();
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Image probe failed for ${url}`));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });
    image.src = url;
  });
}

async function resolveAutoMediaSourcePhotos(
  mediaSourceStatuses: MediaSourceStatus[],
  signal?: AbortSignal,
): Promise<{ source: GalleryConcreteMediaSource; items: Photo[] }> {
  for (const mediaSource of AUTO_MEDIA_SOURCE_CANDIDATES) {
    if (isMediaSourceDisabled(mediaSourceStatuses, mediaSource)) {
      continue;
    }

    try {
      const items = await fetchPhotos(mediaSource, signal);

      if (items.length === 0) {
        return { source: mediaSource, items };
      }

      await probeImage(items[0].thumbnailUrl, signal);

      return { source: mediaSource, items };
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error;
      }
    }
  }

  throw new Error('No reachable remote media source.');
}

export function ExhibitionPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());
  const persistedSettings = readGallerySettings();
  const [isAtTop, setIsAtTop] = useState(true);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [columnPreference, setColumnPreference] = useState<GalleryColumnPreference>(persistedSettings.columnPreference);
  const [sortPreference, setSortPreference] = useState<GallerySortPreference>(persistedSettings.sortPreference);
  const [mediaSourcePreference, setMediaSourcePreference] = useState<GalleryMediaSourcePreference>(
    normalizeGalleryMediaSourcePreference(persistedSettings.mediaSourcePreference),
  );
  const [mediaSourceStatuses, setMediaSourceStatuses] = useState<MediaSourceStatus[]>([]);
  const [hasLoadedMediaSourceStatuses, setHasLoadedMediaSourceStatuses] = useState(false);
  const previousScrollYRef = useRef(0);
  const upwardRevealDistanceRef = useRef(0);
  const downwardHideDistanceRef = useRef(0);
  const autoMediaSourceStatusSignature = getAutoMediaSourceStatusSignature(mediaSourceStatuses);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = Math.max(window.scrollY, 0);
      const previousScrollY = previousScrollYRef.current;
      const delta = currentScrollY - previousScrollY;
      const isNearTop = currentScrollY <= TOP_VISIBILITY_THRESHOLD;

      setIsAtTop(isNearTop);

      if (isNearTop) {
        upwardRevealDistanceRef.current = 0;
        downwardHideDistanceRef.current = 0;
        setIsHeaderVisible(true);
        previousScrollYRef.current = currentScrollY;
        return;
      }

      if (delta > 0) {
        upwardRevealDistanceRef.current = 0;
        downwardHideDistanceRef.current += delta;

        if (downwardHideDistanceRef.current >= DOWNWARD_HIDE_THRESHOLD) {
          setIsHeaderVisible(false);
        }
      } else if (delta < 0) {
        downwardHideDistanceRef.current = 0;
        upwardRevealDistanceRef.current += Math.abs(delta);

        if (upwardRevealDistanceRef.current >= UPWARD_REVEAL_THRESHOLD) {
          setIsHeaderVisible(true);
        }
      }

      previousScrollYRef.current = currentScrollY;
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    fetchMediaSourceStatuses(controller.signal)
      .then((items) => {
        setMediaSourceStatuses(items);
        setHasLoadedMediaSourceStatuses(true);
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setHasLoadedMediaSourceStatuses(true);
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const normalizedMediaSourcePreference = normalizeGalleryMediaSourcePreference(mediaSourcePreference);

    if (normalizedMediaSourcePreference !== mediaSourcePreference) {
      setMediaSourcePreference(normalizedMediaSourcePreference);
      return;
    }

    if (!hasLoadedMediaSourceStatuses || mediaSourcePreference === 'auto') {
      return;
    }

    const selectedSourceStatus = getMediaSourceStatus(mediaSourceStatuses, mediaSourcePreference);
    const fallbackMediaSourcePreference = normalizeGalleryMediaSourcePreference('auto');

    if (selectedSourceStatus?.isDisabled && mediaSourcePreference !== fallbackMediaSourcePreference) {
      setMediaSourcePreference(fallbackMediaSourcePreference);
    }
  }, [hasLoadedMediaSourceStatuses, mediaSourcePreference, mediaSourceStatuses]);

  useEffect(() => {
    if ((mediaSourcePreference === 'auto' || mediaSourcePreference === 'qiniu') && !hasLoadedMediaSourceStatuses) {
      return;
    }

    if (mediaSourcePreference !== 'auto' && isMediaSourceDisabled(mediaSourceStatuses, mediaSourcePreference)) {
      return;
    }

    const controller = new AbortController();

    setStatus('loading');
    setVisibleCount(INITIAL_VISIBLE_COUNT);

    const loadPhotos = async () => {
      try {
        const nextItems =
          mediaSourcePreference === 'auto'
            ? await resolveAutoMediaSourcePhotos(mediaSourceStatuses, controller.signal)
            : {
                source: mediaSourcePreference,
                items: await fetchPhotos(mediaSourcePreference, controller.signal),
              };

        if (controller.signal.aborted) {
          return;
        }

        setPhotos(nextItems.items);
        setStatus(nextItems.items.length === 0 ? 'empty' : 'ready');
      } catch (error: unknown) {
        if (isAbortError(error)) {
          return;
        }

        setStatus('error');
      }
    };

    void loadPhotos();

    return () => {
      controller.abort();
    };
  }, [
    mediaSourcePreference,
    (mediaSourcePreference === 'auto' || mediaSourcePreference === 'qiniu') ? hasLoadedMediaSourceStatuses : false,
    mediaSourcePreference === 'auto' ? autoMediaSourceStatusSignature : '',
  ]);

  useEffect(() => {
    if (isSettingsOpen) {
      setIsHeaderVisible(true);
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    writeGallerySettings({
      columnPreference,
      sortPreference,
      mediaSourcePreference,
    });
  }, [columnPreference, sortPreference, mediaSourcePreference]);

  const sortedPhotos = useMemo(() => sortPhotos(photos, sortPreference), [photos, sortPreference]);
  const groups = useMemo(() => {
    const allGroups = groupPhotosByMonth(sortedPhotos);
    let remainingVisibleCount = visibleCount;

    return allGroups.flatMap((group) => {
      if (remainingVisibleCount <= 0) {
        return [];
      }

      const visiblePhotos = group.photos.slice(0, remainingVisibleCount);
      remainingVisibleCount -= visiblePhotos.length;

      return visiblePhotos.length === 0 ? [] : [{ ...group, photos: visiblePhotos }];
    });
  }, [sortedPhotos, visibleCount]);
  const selectedIndex = sortedPhotos.findIndex((photo) => photo.id === selectedPhotoId);

  const hasMorePhotos = visibleCount < sortedPhotos.length;

  const loadMore = () => {
    if (!hasMorePhotos) {
      return;
    }
    setVisibleCount((current) => Math.min(current + LOAD_MORE_COUNT, sortedPhotos.length));
  };

  const openPhoto = (photoId: string) => {
    setSelectedPhotoId(photoId);
    writeSelectedPhotoId(photoId);
  };

  const closeViewer = () => {
    setSelectedPhotoId(null);
    writeSelectedPhotoId(null);
  };

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
  };

  const selectPhotoAtIndex = (index: number) => {
    const nextPhoto = sortedPhotos[index];

    if (!nextPhoto) {
      return;
    }

    setSelectedPhotoId(nextPhoto.id);
    writeSelectedPhotoId(nextPhoto.id);
  };

  return (
    <>
      <ExhibitionHeader isAtTop={isAtTop} isVisible={isHeaderVisible} onOpenSettings={openSettings} />
      <main className="min-h-screen bg-surface text-on-surface">
        <ExhibitionHero />

        <section className="mx-auto max-w-[2400px] px-4 pb-24 md:px-6 lg:px-12">
          {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading exhibition…</p>}
          {status === 'error' && <p className="text-sm text-red-700">Unable to load the exhibition right now.</p>}
          {status === 'empty' && <p className="text-sm text-on-surface-variant">No works are available yet.</p>}
          {status === 'ready' && (
            <div>
              {groups.map((group) => (
                <ExhibitionSection
                  key={group.title}
                  title={group.title}
                  photos={group.photos}
                  columnPreference={columnPreference}
                  onOpen={openPhoto}
                />
              ))}
              <LoadTrigger disabled={false} isComplete={!hasMorePhotos} onLoadMore={loadMore} resetKey={visibleCount} />
            </div>
          )}
        </section>
      </main>

      {isSettingsOpen && (
        <GallerySettingsModal
          columnPreference={columnPreference}
          sortPreference={sortPreference}
          mediaSourcePreference={mediaSourcePreference}
          mediaSourceStatuses={mediaSourceStatuses}
          onSelectColumnPreference={setColumnPreference}
          onSelectSortPreference={setSortPreference}
          onSelectMediaSourcePreference={setMediaSourcePreference}
          onClose={closeSettings}
        />
      )}

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
