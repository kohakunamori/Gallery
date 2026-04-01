import { useEffect, useMemo, useState } from 'react';
import type { Photo } from '../../types/photo';
import type { GalleryColumnPreference } from './GallerySettingsModal';
import { WaterfallCard } from './WaterfallCard';

type WaterfallGalleryProps = {
  photos: Photo[];
  columnPreference: GalleryColumnPreference;
  onOpen: (photoId: string) => void;
};

export function getAutoColumnCount(viewportWidth: number) {
  if (viewportWidth >= 1536) {
    return 4;
  }

  if (viewportWidth >= 1024) {
    return 3;
  }

  if (viewportWidth >= 640) {
    return 2;
  }

  return 1;
}

export function resolveColumnCount(viewportWidth: number, columnPreference: GalleryColumnPreference) {
  return columnPreference === 'auto' ? getAutoColumnCount(viewportWidth) : columnPreference;
}

export function distributePhotosIntoColumns(photos: Photo[], columnCount: number) {
  const safeColumnCount = Math.max(columnCount, 1);
  const columns = Array.from({ length: safeColumnCount }, () => [] as Photo[]);
  const columnHeights = Array.from({ length: safeColumnCount }, () => 0);

  for (const photo of photos) {
    let targetColumnIndex = 0;

    for (let index = 1; index < safeColumnCount; index += 1) {
      if (columnHeights[index] < columnHeights[targetColumnIndex]) {
        targetColumnIndex = index;
      }
    }

    columns[targetColumnIndex].push(photo);

    const aspectHeight =
      photo.width !== null && photo.height !== null && photo.width > 0 && photo.height > 0
        ? photo.height / photo.width
        : 3 / 4;

    columnHeights[targetColumnIndex] += aspectHeight;
  }

  return columns;
}

export function WaterfallGallery({ photos, columnPreference, onOpen }: WaterfallGalleryProps) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const resolvedColumnCount = useMemo(
    () => resolveColumnCount(viewportWidth, columnPreference),
    [columnPreference, viewportWidth],
  );

  const columns = useMemo(
    () => distributePhotosIntoColumns(photos, resolvedColumnCount),
    [photos, resolvedColumnCount],
  );

  return (
    <div
      className="grid items-start gap-2"
      style={{ gridTemplateColumns: `repeat(${resolvedColumnCount}, minmax(0, 1fr))` }}
      data-column-count={resolvedColumnCount}
      data-testid="waterfall-gallery"
    >
      {columns.map((columnPhotos, columnIndex) => (
        <div key={`column-${columnIndex}`} className="flex flex-col gap-2" data-testid={`waterfall-column-${columnIndex}`}>
          {columnPhotos.map((photo) => (
            <WaterfallCard key={photo.id} photo={photo} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}
