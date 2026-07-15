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

export type ColumnItemMetric = {
  top: number;
  height: number;
  bottom: number;
};

export type ColumnLayoutMetrics = {
  items: ColumnItemMetric[];
  totalHeight: number;
};

export type VisibleItemRange = {
  start: number;
  end: number;
};

const AUTO_COLUMN_TARGET_WIDTH = 360;
const MAX_AUTO_COLUMN_COUNT = 6;
/** Matches Tailwind `gap-2` (0.5rem at default root font size). */
export const COLUMN_GAP_PX = 8;
/** Extra pixels above/below the viewport to keep mounted while scrolling. */
export const COLUMN_OVERSCAN_PX = 800;
const DEFAULT_VIEWPORT_WIDTH = 1280;
const MIN_COLUMN_WIDTH_PX = 1;

export function getAutoColumnCount(viewportWidth: number) {
  const safeViewportWidth = Math.max(viewportWidth, AUTO_COLUMN_TARGET_WIDTH);

  return clampGalleryColumnCount(
    Math.min(MAX_AUTO_COLUMN_COUNT, Math.max(1, Math.round(safeViewportWidth / AUTO_COLUMN_TARGET_WIDTH))),
  );
}

export function resolveColumnCount(viewportWidth: number, columnPreference: GalleryColumnPreference) {
  return columnPreference === 'auto' ? getAutoColumnCount(viewportWidth) : clampGalleryColumnCount(columnPreference);
}

export function getPhotoAspectHeight(photo: Photo) {
  if (photo.width !== null && photo.height !== null && photo.width > 0 && photo.height > 0) {
    return photo.height / photo.width;
  }

  return 3 / 4;
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
    columnHeights[targetColumnIndex] += getPhotoAspectHeight(photo);
  }

  return columns;
}

export function getColumnLayoutMetrics(
  photos: Photo[],
  columnWidth: number,
  gapPx: number = COLUMN_GAP_PX,
): ColumnLayoutMetrics {
  const safeColumnWidth = Math.max(columnWidth, MIN_COLUMN_WIDTH_PX);
  const items: ColumnItemMetric[] = [];
  let offset = 0;

  for (let index = 0; index < photos.length; index += 1) {
    const height = getPhotoAspectHeight(photos[index]!) * safeColumnWidth;
    items.push({
      top: offset,
      height,
      bottom: offset + height,
    });
    offset += height;

    if (index < photos.length - 1) {
      offset += gapPx;
    }
  }

  return {
    items,
    totalHeight: offset,
  };
}

/**
 * Returns an inclusive-start / exclusive-end range of items whose vertical
 * span intersects [windowTop, windowBottom).
 */
export function getVisibleItemRange(
  items: ReadonlyArray<Pick<ColumnItemMetric, 'top' | 'bottom'>>,
  windowTop: number,
  windowBottom: number,
): VisibleItemRange {
  if (items.length === 0 || windowBottom <= windowTop) {
    return { start: 0, end: 0 };
  }

  let start = 0;

  while (start < items.length && items[start]!.bottom <= windowTop) {
    start += 1;
  }

  let end = start;

  while (end < items.length && items[end]!.top < windowBottom) {
    end += 1;
  }

  return { start, end };
}

export function estimateColumnWidth(viewportWidth: number, columnCount: number, gapPx: number = COLUMN_GAP_PX) {
  const safeColumnCount = Math.max(1, columnCount);
  // Approximate the exhibition content width (max-w-[2400px] with horizontal padding).
  const horizontalPadding = viewportWidth >= 1024 ? 96 : viewportWidth >= 768 ? 48 : 32;
  const contentWidth = Math.min(Math.max(viewportWidth, 0), 2400) - horizontalPadding;
  const totalGap = gapPx * Math.max(0, safeColumnCount - 1);

  return Math.max(MIN_COLUMN_WIDTH_PX, (contentWidth - totalGap) / safeColumnCount);
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
  if (columnCount >= 5) {
    return '800px 0px';
  }

  if (columnCount >= 3) {
    return '1000px 0px';
  }

  return '1200px 0px';
}

export function getImageReleaseRootMargin(columnCount: number) {
  if (columnCount >= 5) {
    return '2200px 0px';
  }

  if (columnCount >= 3) {
    return '2600px 0px';
  }

  return '3000px 0px';
}

export function getLoadTriggerRootMargin(columnCount: number) {
  if (columnCount >= 5) {
    return '600px 0px';
  }

  if (columnCount >= 3) {
    return '800px 0px';
  }

  return '1000px 0px';
}

export function getInitialVisibleCount(columnCount: number) {
  if (columnCount <= 2) {
    return columnCount * 5;
  }

  return Math.min(24, columnCount * 4);
}

export function getLoadMoreCount(columnCount: number) {
  if (columnCount <= 2) {
    return columnCount * 4;
  }

  return Math.min(24, columnCount * 3);
}

export function shouldReleaseOffscreenImages(columnCount: number) {
  return columnCount >= 2;
}

export function getPriorityPhotoCount(columnCount: number) {
  if (columnCount <= 1) {
    return 1;
  }

  if (columnCount === 2) {
    return 2;
  }

  return 3;
}

export function getPriorityPhotoIds(columns: Photo[][], limit: number) {
  if (limit <= 0) {
    return [];
  }

  const priorityPhotoIds: string[] = [];

  for (let rowIndex = 0; priorityPhotoIds.length < limit; rowIndex += 1) {
    let hasPhotoInRow = false;

    for (const column of columns) {
      const photo = column[rowIndex];

      if (photo === undefined) {
        continue;
      }

      hasPhotoInRow = true;
      priorityPhotoIds.push(photo.id);

      if (priorityPhotoIds.length === limit) {
        break;
      }
    }

    if (!hasPhotoInRow) {
      break;
    }
  }

  return priorityPhotoIds;
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
  return typeof window === 'undefined' ? getAutoColumnCount(DEFAULT_VIEWPORT_WIDTH) : getAutoColumnCount(window.innerWidth);
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

type VirtualizedWaterfallColumnProps = {
  photos: Photo[];
  columnIndex: number;
  columnCount: number;
  preloadPhotoIds: Set<string>;
  priorityPhotoIds: Set<string>;
  onOpen: (photoId: string) => void;
  onEnterViewport: (photoId: string) => void;
  imageRootMargin: string;
  imageReleaseRootMargin: string;
  releaseImageOnExit: boolean;
};

type ScrollWindow = {
  top: number;
  bottom: number;
};

function readColumnScrollWindow(columnElement: HTMLElement, overscanPx: number): ScrollWindow {
  const rect = columnElement.getBoundingClientRect();
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;

  return {
    top: -rect.top - overscanPx,
    bottom: -rect.top + viewportHeight + overscanPx,
  };
}

const VirtualizedWaterfallColumn = memo(function VirtualizedWaterfallColumn({
  photos,
  columnIndex,
  columnCount,
  preloadPhotoIds,
  priorityPhotoIds,
  onOpen,
  onEnterViewport,
  imageRootMargin,
  imageReleaseRootMargin,
  releaseImageOnExit,
}: VirtualizedWaterfallColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);
  const [columnWidth, setColumnWidth] = useState(() =>
    typeof window === 'undefined'
      ? estimateColumnWidth(DEFAULT_VIEWPORT_WIDTH, columnCount)
      : estimateColumnWidth(window.innerWidth, columnCount),
  );
  const [scrollWindow, setScrollWindow] = useState<ScrollWindow>(() => ({
    top: -COLUMN_OVERSCAN_PX,
    bottom: (typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerHeight) + COLUMN_OVERSCAN_PX,
  }));
  const scheduledFrameRef = useRef<number | null>(null);

  const layout = useMemo(
    () => getColumnLayoutMetrics(photos, columnWidth, COLUMN_GAP_PX),
    [columnWidth, photos],
  );

  const visibleRange = useMemo(
    () => getVisibleItemRange(layout.items, scrollWindow.top, scrollWindow.bottom),
    [layout.items, scrollWindow.bottom, scrollWindow.top],
  );

  const syncScrollWindow = useCallback(() => {
    const columnElement = columnRef.current;

    if (columnElement === null) {
      return;
    }

    const nextWindow = readColumnScrollWindow(columnElement, COLUMN_OVERSCAN_PX);

    setScrollWindow((currentWindow) => {
      if (
        Math.abs(currentWindow.top - nextWindow.top) < 1 &&
        Math.abs(currentWindow.bottom - nextWindow.bottom) < 1
      ) {
        return currentWindow;
      }

      return nextWindow;
    });
  }, []);

  const scheduleScrollWindowSync = useCallback(() => {
    if (scheduledFrameRef.current !== null) {
      return;
    }

    scheduledFrameRef.current = window.requestAnimationFrame(() => {
      scheduledFrameRef.current = null;
      syncScrollWindow();
    });
  }, [syncScrollWindow]);

  useEffect(() => {
    const columnElement = columnRef.current;

    if (columnElement === null) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = columnElement.getBoundingClientRect().width;

      if (nextWidth <= 0) {
        return;
      }

      setColumnWidth((currentWidth) => (Math.abs(currentWidth - nextWidth) < 0.5 ? currentWidth : nextWidth));
    };

    updateWidth();
    syncScrollWindow();

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            updateWidth();
            scheduleScrollWindowSync();
          });

    resizeObserver?.observe(columnElement);
    window.addEventListener('scroll', scheduleScrollWindowSync, { passive: true });
    window.addEventListener('resize', scheduleScrollWindowSync);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('scroll', scheduleScrollWindowSync);
      window.removeEventListener('resize', scheduleScrollWindowSync);

      if (scheduledFrameRef.current !== null) {
        window.cancelAnimationFrame(scheduledFrameRef.current);
        scheduledFrameRef.current = null;
      }
    };
  }, [columnCount, photos.length, scheduleScrollWindowSync, syncScrollWindow]);

  // Re-measure when the estimated layout height changes enough to shift the column in the page.
  useEffect(() => {
    scheduleScrollWindowSync();
  }, [layout.totalHeight, scheduleScrollWindowSync]);

  const visiblePhotos = photos.slice(visibleRange.start, visibleRange.end);
  const visibleMetrics = layout.items.slice(visibleRange.start, visibleRange.end);

  return (
    <div
      ref={columnRef}
      className="relative w-full"
      style={{ height: layout.totalHeight > 0 ? layout.totalHeight : undefined }}
      data-testid={`waterfall-column-${columnIndex}`}
      data-total-count={photos.length}
      data-visible-start={visibleRange.start}
      data-visible-end={visibleRange.end}
      data-mounted-count={visiblePhotos.length}
    >
      {visiblePhotos.map((photo, visibleIndex) => {
        const metric = visibleMetrics[visibleIndex];

        if (metric === undefined) {
          return null;
        }

        return (
          <div
            key={photo.id}
            className="absolute left-0 right-0"
            style={{ top: metric.top }}
            data-testid="waterfall-virtual-item"
            data-photo-id={photo.id}
          >
            <WaterfallCard
              photo={photo}
              onOpen={onOpen}
              shouldPreload={preloadPhotoIds.has(photo.id)}
              isPriority={priorityPhotoIds.has(photo.id)}
              onEnterViewport={onEnterViewport}
              rootMargin={imageRootMargin}
              releaseRootMargin={imageReleaseRootMargin}
              releaseImageOnExit={releaseImageOnExit}
            />
          </div>
        );
      })}
    </div>
  );
});

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
  const priorityPhotoIds = useMemo(
    () => new Set(getPriorityPhotoIds(columns, getPriorityPhotoCount(resolvedColumnCount))),
    [columns, resolvedColumnCount],
  );
  const imageRootMargin = getImageRootMargin(resolvedColumnCount);
  const imageReleaseRootMargin = getImageReleaseRootMargin(resolvedColumnCount);
  const releaseImageOnExit = shouldReleaseOffscreenImages(resolvedColumnCount);

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
        <VirtualizedWaterfallColumn
          key={`column-${columnIndex}`}
          photos={columnPhotos}
          columnIndex={columnIndex}
          columnCount={resolvedColumnCount}
          preloadPhotoIds={preloadPhotoIds}
          priorityPhotoIds={priorityPhotoIds}
          onOpen={onOpen}
          onEnterViewport={handlePhotoEnterViewport}
          imageRootMargin={imageRootMargin}
          imageReleaseRootMargin={imageReleaseRootMargin}
          releaseImageOnExit={releaseImageOnExit}
        />
      ))}
    </div>
  );
});
