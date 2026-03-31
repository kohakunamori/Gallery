import { useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
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

export function PhotoViewerModal({ photos, selectedIndex, onSelectIndex, onClose }: PhotoViewerModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    return () => {
      previouslyFocusedElementRef.current?.focus();
    };
  }, []);

  if (selectedIndex < 0 || selectedIndex >= photos.length) {
    return null;
  }

  const photo = photos[selectedIndex];
  const isFirstPhoto = selectedIndex === 0;
  const isLastPhoto = selectedIndex === photos.length - 1;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
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
          <section className="relative min-h-[18rem] flex-1 overflow-hidden rounded-[36px] border border-white/10 bg-white/[0.03] shadow-2xl lg:min-h-0">
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

            <div className="flex h-full items-center justify-center px-16 py-8 md:px-24 xl:px-28">
              <img src={photo.url} alt={photo.filename} className="max-h-full max-w-full object-contain drop-shadow-[0_30px_80px_rgba(0,0,0,0.45)]" />
            </div>
          </section>

          <div className="min-h-0 w-full shrink-0 lg:w-80">
            <ViewerSidePanel photo={photo} />
          </div>
        </div>

        <div className="pointer-events-none mt-4 flex justify-center">
          <ViewerActionBar />
        </div>
      </div>
    </div>
  );
}
