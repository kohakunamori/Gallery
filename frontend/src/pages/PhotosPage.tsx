import { useEffect, useMemo, useState } from 'react';
import { TimelineRail } from '../components/timeline/TimelineRail';
import { TimelineSection } from '../components/timeline/TimelineSection';
import { PhotoViewerModal } from '../components/viewer/PhotoViewerModal';
import { fetchPhotos } from '../services/photos';
import type { Photo } from '../types/photo';
import { groupPhotosByDate } from '../utils/groupPhotosByDate';
import { readSelectedPhotoId, writeSelectedPhotoId } from '../utils/photoQuery';

function getTimelineYear(photos: Photo[]) {
  const firstPhoto = photos[0];

  if (!firstPhoto) {
    return new Date().getFullYear().toString();
  }

  return new Date(firstPhoto.sortTime).getFullYear().toString();
}

export function PhotosPage() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(() => readSelectedPhotoId());

  const orderedPhotos = useMemo(
    () => [...photos].sort((left, right) => new Date(right.sortTime).getTime() - new Date(left.sortTime).getTime()),
    [photos],
  );

  useEffect(() => {
    let cancelled = false;

    fetchPhotos()
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
  }, []);

  const groups = useMemo(() => groupPhotosByDate(orderedPhotos), [orderedPhotos]);
  const railLabels = useMemo(() => groups.map((group) => group.title), [groups]);
  const timelineYear = useMemo(() => getTimelineYear(orderedPhotos), [orderedPhotos]);
  const selectedIndex = orderedPhotos.findIndex((photo) => photo.id === selectedPhotoId);

  useEffect(() => {
    if (selectedPhotoId !== null && selectedIndex === -1 && orderedPhotos.length > 0) {
      setSelectedPhotoId(null);
      writeSelectedPhotoId(null);
    }
  }, [orderedPhotos.length, selectedIndex, selectedPhotoId]);

  const openPhoto = (photoId: string) => {
    setSelectedPhotoId(photoId);
    writeSelectedPhotoId(photoId);
  };

  const closeViewer = () => {
    setSelectedPhotoId(null);
    writeSelectedPhotoId(null);
  };

  const selectPhotoAtIndex = (index: number) => {
    const nextPhoto = orderedPhotos[index];

    if (!nextPhoto) {
      return;
    }

    setSelectedPhotoId(nextPhoto.id);
    writeSelectedPhotoId(nextPhoto.id);
  };

  return (
    <>
      <section className="mx-auto max-w-7xl px-6 py-10 md:px-12 md:py-12">
        <div className="mb-10 max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-on-surface-variant">Photo timeline</p>
          <h1 className="mt-3 font-headline text-5xl font-black tracking-tight text-on-surface md:text-6xl">
            A living archive of recent moments.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-on-surface-variant md:text-base">
            Browse your latest captures in an editorial timeline, then open any photo in the viewer without leaving the current flow.
          </p>
        </div>

        {status === 'loading' && <p className="text-sm text-on-surface-variant">Loading gallery…</p>}
        {status === 'error' && <p className="text-sm text-red-700">Unable to load photos right now.</p>}
        {status === 'empty' && <p className="text-sm text-on-surface-variant">No photos found in the server folder yet.</p>}
        {status === 'ready' && (
          <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-start xl:grid-cols-[240px_minmax(0,1fr)]">
            <TimelineRail year={timelineYear} labels={railLabels} />
            <div className="space-y-8">
              {groups.map((group) => (
                <TimelineSection
                  key={group.title}
                  title={group.title}
                  photos={group.photos}
                  onOpen={openPhoto}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {status === 'ready' && selectedIndex >= 0 && (
        <PhotoViewerModal
          photos={orderedPhotos}
          selectedIndex={selectedIndex}
          onSelectIndex={selectPhotoAtIndex}
          onClose={closeViewer}
        />
      )}
    </>
  );
}
