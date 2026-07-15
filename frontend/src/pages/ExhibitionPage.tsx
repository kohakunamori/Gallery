import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackToTopButton } from '../components/exhibition/BackToTopButton';
import { ExhibitionHeader } from '../components/exhibition/ExhibitionHeader';
import { ExhibitionHero } from '../components/exhibition/ExhibitionHero';
import { ExhibitionSection } from '../components/exhibition/ExhibitionSection';
import { ExhibitionSkeleton } from '../components/exhibition/ExhibitionSkeleton';
import { ExhibitionStatusPanel } from '../components/exhibition/ExhibitionStatusPanel';
import {
  getInitialVisibleCount,
  getLoadMoreCount,
  getLoadTriggerRootMargin,
  resolveColumnCount,
} from '../components/exhibition/WaterfallGallery';
import { GallerySettingsModal } from '../components/exhibition/GallerySettingsModal';
import {
  readGallerySettings,
  writeGallerySettings,
} from '../utils/gallerySettings';
import type {
  GalleryColumnPreference,
  GallerySortPreference,
} from '../utils/gallerySettings';
import {
  applyGalleryThemePreference,
  readGalleryThemePreference,
  writeGalleryThemePreference,
} from '../utils/galleryTheme';
import type { GalleryThemePreference } from '../utils/galleryTheme';
import { LoadTrigger } from '../components/exhibition/LoadTrigger';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos, resetPhotoRequestCache } from '../services/photos';
import { getScrollBehavior } from '../utils/motion';
import type { Photo } from '../types/photo';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';
import { groupPhotosByMonth } from '../utils/groupPhotosByMonth';
import { sortPhotos } from '../utils/sortPhotos';
import {
  EXHIBITION_STATUS_COPY,
  toUserFacingError,
} from '../utils/userFacingError';
import { t } from '../i18n';

const DEFAULT_VIEWPORT_WIDTH = 1280;
const TOP_VISIBILITY_THRESHOLD = 24;
const DOWNWARD_HIDE_THRESHOLD = 64;
const UPWARD_REVEAL_THRESHOLD = 96;

function getViewportWidth() {
  return typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth;
}

function getResolvedColumnCountForPreference(columnPreference: GalleryColumnPreference) {
  return resolveColumnCount(getViewportWidth(), columnPreference);
}

function getInitialVisiblePhotoCount(columnPreference: GalleryColumnPreference) {
  return getInitialVisibleCount(getResolvedColumnCountForPreference(columnPreference));
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function ExhibitionPage() {
  const [persistedSettings] = useState(readGallerySettings);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [errorCopy, setErrorCopy] = useState<{ title: string; description: string }>(EXHIBITION_STATUS_COPY.error);
  const [visibleCount, setVisibleCount] = useState(() => getInitialVisiblePhotoCount(persistedSettings.columnPreference));
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());
  const [isAtTop, setIsAtTop] = useState(true);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [columnPreference, setColumnPreference] = useState<GalleryColumnPreference>(persistedSettings.columnPreference);
  const [sortPreference, setSortPreference] = useState<GallerySortPreference>(persistedSettings.sortPreference);
  const [themePreference, setThemePreference] = useState<GalleryThemePreference>(readGalleryThemePreference);
  const [reloadKey, setReloadKey] = useState(0);
  const previousScrollYRef = useRef(0);
  const upwardRevealDistanceRef = useRef(0);
  const downwardHideDistanceRef = useRef(0);

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

    // Full load cycle: drop session cache so post-upload nav cannot pin a stale /api/photos snapshot.
    resetPhotoRequestCache();
    setStatus('loading');
    setErrorCopy(EXHIBITION_STATUS_COPY.error);
    setVisibleCount(getInitialVisiblePhotoCount(columnPreference));

    const loadPhotos = async () => {
      try {
        const items = await fetchPhotos(controller.signal);

        if (controller.signal.aborted) {
          return;
        }

        setPhotos(items);
        setStatus(items.length === 0 ? 'empty' : 'ready');
      } catch (error: unknown) {
        if (isAbortError(error)) {
          return;
        }

        setErrorCopy({
          title: EXHIBITION_STATUS_COPY.error.title,
          description: toUserFacingError(error, 'exhibition'),
        });
        setStatus('error');
      }
    };

    void loadPhotos();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  useEffect(() => {
    if (isSettingsOpen) {
      setIsHeaderVisible(true);
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    writeGallerySettings({
      columnPreference,
      sortPreference,
    });
  }, [columnPreference, sortPreference]);

  useEffect(() => {
    writeGalleryThemePreference(themePreference);
    applyGalleryThemePreference(themePreference);

    if (themePreference !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mediaQuery || typeof mediaQuery.addEventListener !== 'function') {
      return;
    }

    const syncSystemTheme = () => {
      applyGalleryThemePreference('system');
    };

    mediaQuery.addEventListener('change', syncSystemTheme);

    return () => {
      mediaQuery.removeEventListener('change', syncSystemTheme);
    };
  }, [themePreference]);

  const sortedPhotos = useMemo(() => sortPhotos(photos, sortPreference), [photos, sortPreference]);
  const allGroups = useMemo(() => groupPhotosByMonth(sortedPhotos), [sortedPhotos]);
  const groups = useMemo(() => {
    let remainingVisibleCount = visibleCount;

    return allGroups.flatMap((group) => {
      if (remainingVisibleCount <= 0) {
        return [];
      }

      if (group.photos.length <= remainingVisibleCount) {
        remainingVisibleCount -= group.photos.length;
        return [group];
      }

      const visiblePhotos = group.photos.slice(0, remainingVisibleCount);
      remainingVisibleCount = 0;

      return visiblePhotos.length === 0 ? [] : [{ ...group, photos: visiblePhotos }];
    });
  }, [allGroups, visibleCount]);
  const selectedIndex = useMemo(
    () => sortedPhotos.findIndex((photo) => photo.id === selectedPhotoId),
    [selectedPhotoId, sortedPhotos],
  );
  const resolvedColumnCount = useMemo(
    () => getResolvedColumnCountForPreference(columnPreference),
    [columnPreference],
  );
  const loadMoreCount = getLoadMoreCount(resolvedColumnCount);
  const loadTriggerRootMargin = getLoadTriggerRootMargin(resolvedColumnCount);

  const hasMorePhotos = visibleCount < sortedPhotos.length;

  useEffect(() => {
    if (status !== 'ready' || selectedPhotoId == null) {
      return;
    }

    const exists = sortedPhotos.some((photo) => photo.id === selectedPhotoId);

    if (exists) {
      return;
    }

    setSelectedPhotoId(null);
    writeSelectedPhotoId(null, { mode: 'replace' });
  }, [selectedPhotoId, sortedPhotos, status]);

  const loadMore = useCallback(() => {
    if (!hasMorePhotos) {
      return;
    }
    setVisibleCount((current) => Math.min(current + loadMoreCount, sortedPhotos.length));
  }, [hasMorePhotos, loadMoreCount, sortedPhotos.length]);

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    const handlePopState = () => {
      const nextPhotoId = readSelectedPhotoId();

      if (nextPhotoId == null) {
        setSelectedPhotoId(null);
        return;
      }

      const exists = sortedPhotos.some((photo) => photo.id === nextPhotoId);

      if (!exists) {
        setSelectedPhotoId(null);
        writeSelectedPhotoId(null, { mode: 'replace' });
        return;
      }

      setSelectedPhotoId(nextPhotoId);
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [sortedPhotos, status]);

  const openPhoto = useCallback((photoId: string) => {
    // Push only when opening from a closed viewer so Back closes.
    // If already open (e.g. switching via the grid), replace to avoid history spam.
    const mode = selectedPhotoId == null ? 'push' : 'replace';
    setSelectedPhotoId(photoId);
    writeSelectedPhotoId(photoId, { mode });
  }, [selectedPhotoId]);

  const closeViewer = useCallback(() => {
    setSelectedPhotoId(null);
    writeSelectedPhotoId(null, { mode: 'replace' });
  }, []);

  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false);
  }, []);

  const retryLoad = useCallback(() => {
    setReloadKey((current) => current + 1);
  }, []);

  const selectPhotoAtIndex = useCallback((index: number) => {
    const nextPhoto = sortedPhotos[index];

    if (!nextPhoto) {
      return;
    }

    setSelectedPhotoId(nextPhoto.id);
    writeSelectedPhotoId(nextPhoto.id, { mode: 'replace' });
  }, [sortedPhotos]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: getScrollBehavior() });
  }, []);

  const isBackToTopVisible = !isAtTop && selectedIndex < 0;

  return (
    <>
      <ExhibitionHeader isAtTop={isAtTop} isVisible={isHeaderVisible} onOpenSettings={openSettings} />
      <main className="min-h-screen bg-surface text-on-surface">
        <ExhibitionHero
          status={status}
          photoCount={sortedPhotos.length}
          monthCount={allGroups.length}
        />

        <section className="mx-auto max-w-[2400px] px-4 pb-24 md:px-6 lg:px-12">
          {status === 'loading' && <ExhibitionSkeleton columnPreference={columnPreference} />}
          {status === 'error' && (
            <ExhibitionStatusPanel
              variant="error"
              title={errorCopy.title}
              description={errorCopy.description}
              primaryAction={{ label: t('exhibition.error.retry'), onClick: retryLoad }}
              secondaryHref={{ label: t('exhibition.error.openUpload'), href: '/upload' }}
            />
          )}
          {status === 'empty' && (
            <ExhibitionStatusPanel
              variant="empty"
              title={t('exhibition.empty.title')}
              description={t('exhibition.empty.description')}
              primaryHref={{ label: t('exhibition.empty.upload'), href: '/upload' }}
            />
          )}
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

      <BackToTopButton visible={isBackToTopVisible} onActivate={scrollToTop} />

      {isSettingsOpen && (
        <GallerySettingsModal
          columnPreference={columnPreference}
          sortPreference={sortPreference}
          themePreference={themePreference}
          onSelectColumnPreference={setColumnPreference}
          onSelectSortPreference={setSortPreference}
          onSelectThemePreference={setThemePreference}
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
