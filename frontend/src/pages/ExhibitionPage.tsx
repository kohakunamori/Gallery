import { useEffect, useMemo, useRef, useState } from 'react';
import { ExhibitionHeader } from '../components/exhibition/ExhibitionHeader';
import { ExhibitionHero } from '../components/exhibition/ExhibitionHero';
import { ExhibitionSection } from '../components/exhibition/ExhibitionSection';
import { GallerySettingsModal } from '../components/exhibition/GallerySettingsModal';
import type {
  GalleryColumnPreference,
  GalleryMediaSourcePreference,
  GallerySortPreference,
} from '../components/exhibition/GallerySettingsModal';
import { LoadTrigger } from '../components/exhibition/LoadTrigger';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos } from '../services/photos';
import type { Photo } from '../types/photo';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';
import { groupPhotosByMonth } from '../utils/groupPhotosByMonth';
import { sortPhotos } from '../utils/sortPhotos';

const INITIAL_VISIBLE_COUNT = 18;
const LOAD_MORE_COUNT = 12;
const TOP_VISIBILITY_THRESHOLD = 24;
const DOWNWARD_HIDE_THRESHOLD = 64;
const UPWARD_REVEAL_THRESHOLD = 96;

export function ExhibitionPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());
  const [isAtTop, setIsAtTop] = useState(true);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [columnPreference, setColumnPreference] = useState<GalleryColumnPreference>('auto');
  const [sortPreference, setSortPreference] = useState<GallerySortPreference>('newest');
  const [mediaSourcePreference, setMediaSourcePreference] = useState<GalleryMediaSourcePreference>('r2');
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
    let cancelled = false;

    setStatus('loading');
    setVisibleCount(INITIAL_VISIBLE_COUNT);

    fetchPhotos(mediaSourcePreference)
      .then((items) => {
        if (cancelled) {
          return;
        }

        setPhotos(items);
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
  }, [mediaSourcePreference]);

  useEffect(() => {
    if (isSettingsOpen) {
      setIsHeaderVisible(true);
    }
  }, [isSettingsOpen]);

  const sortedPhotos = useMemo(() => sortPhotos(photos, sortPreference), [photos, sortPreference]);
  const visiblePhotos = useMemo(() => sortedPhotos.slice(0, visibleCount), [sortedPhotos, visibleCount]);
  const groups = useMemo(() => groupPhotosByMonth(visiblePhotos), [visiblePhotos]);
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
              <LoadTrigger disabled={false} isComplete={!hasMorePhotos} onLoadMore={loadMore} />
            </div>
          )}
        </section>
      </main>

      {isSettingsOpen && (
        <GallerySettingsModal
          columnPreference={columnPreference}
          sortPreference={sortPreference}
          mediaSourcePreference={mediaSourcePreference}
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
