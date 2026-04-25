import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GalleryColumnPreference } from '../../utils/gallerySettings';
import { clampGalleryColumnCount } from '../../utils/gallerySettings';
import type { Photo } from '../../types/photo';
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
  return columnPreference === 'auto' ? getAutoColumnCount(viewportWidth) : clampGalleryColumnCount(columnPreference);
}

export function distributePhotosIntoColumns(photos: Photo[], columnCount: number) {
  const safeColumnCount = clampGalleryColumnCount(columnCount);
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

export function getPreloadWindowSize(columnCount: number) {
  return columnCount <= 2 ? 4 : 6;
}

export function getPreloadPhotoIds(columns: Photo[][], seenPhotoIds: Set<string>, limit: number) {
  if (limit <= 0) {
    return [];
  }

  const preloadPhotoIds: string[] = [];

  for (let offset = 0; offset < 2; offset += 1) {
    for (const column of columns) {
      let seenPrefixLength = 0;

      while (seenPrefixLength < column.length && seenPhotoIds.has(column[seenPrefixLength]?.id ?? '')) {
        seenPrefixLength += 1;
      }

      if (seenPrefixLength === 0) {
        continue;
      }

      const nextPhoto = column[seenPrefixLength + offset];

      if (nextPhoto !== undefined) {
        preloadPhotoIds.push(nextPhoto.id);
      }
    }
  }

  return Array.from(new Set(preloadPhotoIds)).slice(0, limit);
}

export function WaterfallGallery({ photos, columnPreference, onOpen }: WaterfallGalleryProps) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  const [seenPhotoIds, setSeenPhotoIds] = useState<Set<string>>(() => new Set());

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

  useEffect(() => {
    const currentPhotoIds = new Set(photos.map((photo) => photo.id));

    setSeenPhotoIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const photoId of current) {
        if (currentPhotoIds.has(photoId)) {
          next.add(photoId);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [photos]);

  const handlePhotoEnterViewport = useCallback((photoId: string) => {
    setSeenPhotoIds((current) => {
      if (current.has(photoId)) {
        return current;
      }

      const next = new Set(current);
      next.add(photoId);
      return next;
    });
  }, []);

  const preloadPhotoIds = useMemo(
    () => new Set(getPreloadPhotoIds(columns, seenPhotoIds, getPreloadWindowSize(resolvedColumnCount))),
    [columns, resolvedColumnCount, seenPhotoIds],
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
            <WaterfallCard
              key={photo.id}
              photo={photo}
              onOpen={onOpen}
              shouldPreload={preloadPhotoIds.has(photo.id)}
              onEnterViewport={handlePhotoEnterViewport}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
