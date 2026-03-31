import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Photo } from '../../types/photo';
import { ViewerActionBar } from './ViewerActionBar';
import { ViewerSidePanel } from './ViewerSidePanel';
import { ViewerTopBar } from './ViewerTopBar';

type PhotoViewerModalProps = {
  photos: Photo[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onClose: () => void;
};

const ZOOM_LEVELS = [100, 150, 200, 300];

export function PhotoViewerModal({ photos, selectedIndex, onSelectIndex, onClose }: PhotoViewerModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const [showDetails, setShowDetails] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isPanning, setIsPanning] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    setZoomLevel(100);
    setPanOffset({ x: 0, y: 0 });
    setIsPanning(false);
  }, [selectedIndex]);

  useEffect(() => {
    const container = imageContainerRef.current;

    if (!container) {
      return undefined;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      if (event.deltaY < 0) {
        setZoomLevel((currentZoomLevel) => {
          const currentLevelIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
          if (currentLevelIndex >= ZOOM_LEVELS.length - 1) {
            return currentZoomLevel;
          }

          return ZOOM_LEVELS[currentLevelIndex + 1];
        });
        setPanOffset({ x: 0, y: 0 });
      }

      if (event.deltaY > 0) {
        setZoomLevel((currentZoomLevel) => {
          const currentLevelIndex = ZOOM_LEVELS.indexOf(currentZoomLevel);
          if (currentLevelIndex <= 0) {
            return currentZoomLevel;
          }

          return ZOOM_LEVELS[currentLevelIndex - 1];
        });
        setPanOffset({ x: 0, y: 0 });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  if (selectedIndex < 0 || selectedIndex >= photos.length) {
    return null;
  }

  const photo = photos[selectedIndex];
  const isFirstPhoto = selectedIndex === 0;
  const isLastPhoto = selectedIndex === photos.length - 1;

  const handleToggleDetails = () => {
    setShowDetails((currentValue) => !currentValue);
  };

  const handleZoomIn = () => {
    const currentLevelIndex = ZOOM_LEVELS.indexOf(zoomLevel);

    if (currentLevelIndex >= ZOOM_LEVELS.length - 1) {
      return;
    }

    setZoomLevel(ZOOM_LEVELS[currentLevelIndex + 1]);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleZoomOut = () => {
    const currentLevelIndex = ZOOM_LEVELS.indexOf(zoomLevel);

    if (currentLevelIndex <= 0) {
      return;
    }

    setZoomLevel(ZOOM_LEVELS[currentLevelIndex - 1]);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (zoomLevel <= 100) {
      return;
    }

    event.preventDefault();
    setIsPanning(true);
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isPanning || zoomLevel <= 100) {
      return;
    }

    setPanOffset((currentOffset) => ({
      x: currentOffset.x + event.movementX,
      y: currentOffset.y + event.movementY,
    }));
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      if (!isFirstPhoto) {
        event.preventDefault();
        onSelectIndex(selectedIndex - 1);
      }
      return;
    }

    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      if (!isLastPhoto) {
        event.preventDefault();
        onSelectIndex(selectedIndex + 1);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[#050505] text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_38%),linear-gradient(180deg,rgba(0,0,0,0.72),rgba(0,0,0,0.94))]" />

      <div className="relative flex h-full flex-col px-4 py-4 md:px-6 md:py-6 xl:px-8 xl:py-8">
        <ViewerTopBar
          photo={photo}
          currentIndex={selectedIndex}
          total={photos.length}
          onClose={onClose}
          closeButtonRef={closeButtonRef}
        />

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <section
            ref={imageContainerRef}
            className="relative min-h-[18rem] flex-1 overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] shadow-2xl lg:min-h-0"
          >
            <div className="absolute inset-y-0 left-0 z-10 flex items-center pl-4 md:pl-6">
              <button
                type="button"
                aria-label="Previous photo"
                disabled={isFirstPhoto}
                onClick={() => onSelectIndex(selectedIndex - 1)}
                className="rounded-full border border-white/10 bg-black/45 px-4 py-4 text-sm font-semibold text-white backdrop-blur-xl transition disabled:cursor-not-allowed disabled:opacity-35"
              >
                Previous
              </button>
            </div>

            <div className="absolute inset-y-0 right-0 z-10 flex items-center pr-4 md:pr-6">
              <button
                type="button"
                aria-label="Next photo"
                disabled={isLastPhoto}
                onClick={() => onSelectIndex(selectedIndex + 1)}
                className="rounded-full border border-white/10 bg-black/45 px-4 py-4 text-sm font-semibold text-white backdrop-blur-xl transition disabled:cursor-not-allowed disabled:opacity-35"
              >
                Next
              </button>
            </div>

            <div
              className="flex h-full items-center justify-center overflow-auto px-16 py-8 md:px-24 xl:px-28"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              style={{ cursor: zoomLevel > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default' }}
            >
              <img
                src={photo.url}
                alt={photo.filename}
                className="max-h-full max-w-full object-contain drop-shadow-[0_30px_80px_rgba(0,0,0,0.45)] transition-transform duration-200"
                style={{
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel / 100})`,
                  transformOrigin: 'center center',
                }}
              />
            </div>
          </section>

          {showDetails && (
            <div className="min-h-0 w-full shrink-0 lg:w-80">
              <ViewerSidePanel photo={photo} />
            </div>
          )}
        </div>

        <div className="pointer-events-none mt-4 flex justify-center">
          <ViewerActionBar
            zoomLevel={zoomLevel}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            showDetails={showDetails}
            onToggleDetails={handleToggleDetails}
          />
        </div>
      </div>
    </div>
  );
}
