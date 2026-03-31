import { useEffect, useMemo, useState } from 'react';
import { ExhibitionHeader } from '../components/exhibition/ExhibitionHeader';
import { ExhibitionHero } from '../components/exhibition/ExhibitionHero';
import { ExhibitionSection } from '../components/exhibition/ExhibitionSection';
import { LoadTrigger } from '../components/exhibition/LoadTrigger';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos } from '../services/photos';
import type { Photo } from '../types/photo';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';
import { groupPhotosByMonth } from '../utils/groupPhotosByMonth';

const INITIAL_VISIBLE_COUNT = 18;
const LOAD_MORE_COUNT = 12;

export function ExhibitionPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());

  useEffect(() => {
    let cancelled = false;

    fetchPhotos()
      .then((items) => {
        if (cancelled) {
          return;
        }

        const orderedItems = [...items].sort(
          (left, right) => new Date(right.sortTime).getTime() - new Date(left.sortTime).getTime(),
        );

        setPhotos(orderedItems);
        setStatus(orderedItems.length === 0 ? 'empty' : 'ready');
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

  const visiblePhotos = useMemo(() => photos.slice(0, visibleCount), [photos, visibleCount]);
  const groups = useMemo(() => groupPhotosByMonth(visiblePhotos), [visiblePhotos]);
  const selectedIndex = photos.findIndex((photo) => photo.id === selectedPhotoId);

  const hasMorePhotos = visibleCount < photos.length;

  const loadMore = () => {
    if (!hasMorePhotos) {
      return;
    }
    setVisibleCount((current) => Math.min(current + LOAD_MORE_COUNT, photos.length));
  };

  const openPhoto = (photoId: string) => {
    setSelectedPhotoId(photoId);
    writeSelectedPhotoId(photoId);
  };

  const closeViewer = () => {
    setSelectedPhotoId(null);
    writeSelectedPhotoId(null);
  };

  const selectPhotoAtIndex = (index: number) => {
    const nextPhoto = photos[index];

    if (!nextPhoto) {
      return;
    }

    setSelectedPhotoId(nextPhoto.id);
    writeSelectedPhotoId(nextPhoto.id);
  };

  return (
    <>
      <ExhibitionHeader />
      <main className="min-h-screen bg-surface text-on-surface">
        <ExhibitionHero totalCount={photos.length} />

        <section className="mx-auto max-w-[2400px] px-4 pb-24 md:px-6 lg:px-12">
          {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading exhibition…</p>}
          {status === 'error' && <p className="text-sm text-red-700">Unable to load the exhibition right now.</p>}
          {status === 'empty' && <p className="text-sm text-on-surface-variant">No works are available yet.</p>}
          {status === 'ready' && (
            <div>
              {groups.map((group) => (
                <ExhibitionSection key={group.title} title={group.title} photos={group.photos} onOpen={openPhoto} />
              ))}
              <LoadTrigger disabled={false} isComplete={!hasMorePhotos} onLoadMore={loadMore} />
            </div>
          )}
        </section>
      </main>

      {status === 'ready' && selectedIndex >= 0 && (
        <PhotoViewerModal
          photos={photos}
          selectedIndex={selectedIndex}
          onSelectIndex={selectPhotoAtIndex}
          onClose={closeViewer}
        />
      )}
    </>
  );
}
