import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  if (columnCount >= 7) {
    return 2;
  }

  if (columnCount >= 5) {
    return 4;
  }

  return columnCount <= 2 ? 4 : 6;
}

export function getImageRootMargin(columnCount: number) {
  if (columnCount >= 7) {
    return '300px 0px';
  }

  if (columnCount >= 5) {
    return '600px 0px';
  }

  return '1200px 0px';
}

export function getLoadTriggerRootMargin(columnCount: number) {
  if (columnCount >= 7) {
    return '400px 0px';
  }

  if (columnCount >= 5) {
    return '800px 0px';
  }

  return '1200px 0px';
}

export function getLoadMoreCount(columnCount: number) {
  if (columnCount >= 7) {
    return 12;
  }

  if (columnCount >= 5) {
    return 16;
  }

  return 24;
}

export function shouldReleaseOffscreenImages(columnCount: number) {
  return columnCount >= 7;
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

function getInitialAutoColumnCount() {
  return typeof window === 'undefined' ? getAutoColumnCount(1280) : getAutoColumnCount(window.innerWidth);
}

function arePhotoIdSetsEqual(left: Set<string>, right: Set<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const photoId of left) {
    if (!right.has(photoId)) {
      return false;
    }
  }

  return true;
}

export const WaterfallGallery = memo(function WaterfallGallery({ photos, columnPreference, onOpen }: WaterfallGalleryProps) {
  const [autoColumnCount, setAutoColumnCount] = useState(getInitialAutoColumnCount);
  const [preloadPhotoIds, setPreloadPhotoIds] = useState<Set<string>>(() => new Set());
  const seenPhotoIdsRef = useRef<Set<string>>(new Set());
  const syncPreloadPhotoIdsRef = useRef<(() => void) | null>(null);
  const scheduledSyncFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (columnPreference !== 'auto') {
      return;
    }

    const handleResize = () => {
      const nextColumnCount = getAutoColumnCount(window.innerWidth);

      setAutoColumnCount((currentColumnCount) => (currentColumnCount === nextColumnCount ? currentColumnCount : nextColumnCount));
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [columnPreference]);

  useEffect(() => {
    return () => {
      if (scheduledSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledSyncFrameRef.current);
      }
    };
  }, []);

  const resolvedColumnCount = columnPreference === 'auto' ? autoColumnCount : clampGalleryColumnCount(columnPreference);
  const columns = useMemo(() => distributePhotosIntoColumns(photos, resolvedColumnCount), [photos, resolvedColumnCount]);

  const syncPreloadPhotoIds = useCallback(() => {
    const nextSeenPhotoIds = new Set<string>();

    for (const photo of photos) {
      if (seenPhotoIdsRef.current.has(photo.id)) {
        nextSeenPhotoIds.add(photo.id);
      }
    }

    seenPhotoIdsRef.current = nextSeenPhotoIds;

    const nextPreloadPhotoIds = new Set(
      getPreloadPhotoIds(columns, seenPhotoIdsRef.current, getPreloadWindowSize(resolvedColumnCount)),
    );

    setPreloadPhotoIds((currentPreloadPhotoIds) =>
      arePhotoIdSetsEqual(currentPreloadPhotoIds, nextPreloadPhotoIds) ? currentPreloadPhotoIds : nextPreloadPhotoIds,
    );
  }, [columns, photos, resolvedColumnCount]);

  useEffect(() => {
    syncPreloadPhotoIdsRef.current = syncPreloadPhotoIds;
  }, [syncPreloadPhotoIds]);

  useEffect(() => {
    syncPreloadPhotoIds();
  }, [syncPreloadPhotoIds]);

  const schedulePreloadPhotoIdsSync = useCallback(() => {
    if (scheduledSyncFrameRef.current !== null) {
      return;
    }

    scheduledSyncFrameRef.current = window.requestAnimationFrame(() => {
      scheduledSyncFrameRef.current = null;
      syncPreloadPhotoIdsRef.current?.();
    });
  }, []);

  const handlePhotoEnterViewport = useCallback((photoId: string) => {
    if (seenPhotoIdsRef.current.has(photoId)) {
      return;
    }

    seenPhotoIdsRef.current.add(photoId);
    schedulePreloadPhotoIdsSync();
  }, [schedulePreloadPhotoIdsSync]);

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
              rootMargin={getImageRootMargin(resolvedColumnCount)}
              releaseImageOnExit={shouldReleaseOffscreenImages(resolvedColumnCount)}
            />
          ))}
        </div>
      ))}
    </div>
  );
});
