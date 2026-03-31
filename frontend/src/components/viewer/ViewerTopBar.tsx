import type { RefObject } from 'react';
import type { Photo } from '../../types/photo';

type ViewerTopBarProps = {
  photo: Photo;
  currentIndex: number;
  total: number;
  onClose: () => void;
  closeButtonRef?: RefObject<HTMLButtonElement | null>;
};

export function ViewerTopBar({ photo, currentIndex, total, onClose, closeButtonRef }: ViewerTopBarProps) {
  return (
    <header className="pointer-events-auto flex items-start justify-between gap-4 rounded-[28px] border border-white/10 bg-black/45 px-5 py-4 text-white shadow-2xl backdrop-blur-xl">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/55">Photo viewer</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="truncate text-base font-semibold text-white md:text-lg">{photo.filename}</h2>
          <span className="text-sm text-white/60">
            {currentIndex + 1} of {total}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Bookmark photo"
          disabled
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 opacity-60 disabled:cursor-not-allowed"
        >
          Save
        </button>
        <button
          type="button"
          aria-label="Share photo"
          disabled
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 opacity-60 disabled:cursor-not-allowed"
        >
          Share
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close viewer"
          onClick={onClose}
          className="rounded-full border border-white/10 bg-white px-3 py-2 text-xs font-semibold text-black"
        >
          Close viewer
        </button>
      </div>
    </header>
  );
}
