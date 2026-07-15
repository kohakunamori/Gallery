import { memo, useEffect, useState } from 'react';
import type { GalleryColumnPreference } from '../../utils/gallerySettings';
import { resolveColumnCount } from './WaterfallGallery';

type ExhibitionSkeletonProps = {
  columnPreference: GalleryColumnPreference;
};

const DEFAULT_VIEWPORT_WIDTH = 1280;
const PLACEHOLDER_ASPECT_RATIOS = ['3 / 4', '4 / 3', '1 / 1', '2 / 3', '5 / 4', '3 / 5'] as const;
const PLACEHOLDERS_PER_COLUMN = 4;

function getViewportWidth() {
  return typeof window === 'undefined' ? DEFAULT_VIEWPORT_WIDTH : window.innerWidth;
}

export const ExhibitionSkeleton = memo(function ExhibitionSkeleton({ columnPreference }: ExhibitionSkeletonProps) {
  const [viewportWidth, setViewportWidth] = useState(getViewportWidth);
  const columnCount = resolveColumnCount(viewportWidth, columnPreference);

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(getViewportWidth());
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div
      aria-busy="true"
      aria-label="Loading exhibition"
      className="grid gap-4"
      data-testid="exhibition-skeleton"
      data-column-count={columnCount}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: columnCount }, (_, columnIndex) => (
        <div key={columnIndex} className="flex flex-col gap-4">
          {Array.from({ length: PLACEHOLDERS_PER_COLUMN }, (_, cardIndex) => {
            const aspectRatio = PLACEHOLDER_ASPECT_RATIOS[(columnIndex + cardIndex) % PLACEHOLDER_ASPECT_RATIOS.length];

            return (
              <div
                key={cardIndex}
                className="overflow-hidden rounded-xl bg-surface-container-low shadow-[0_10px_28px_rgba(15,23,42,0.05)]"
                style={{ aspectRatio }}
                data-testid="exhibition-skeleton-card"
              >
                <div className="gallery-shimmer h-full w-full" />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
});
