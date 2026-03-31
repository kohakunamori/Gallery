import type { Photo } from '../../types/photo';

type ViewerSidePanelProps = {
  photo: Photo;
};

function formatDimensions(photo: Photo) {
  if (photo.width === null || photo.height === null) {
    return 'Unknown';
  }

  return `${photo.width} × ${photo.height}`;
}

function formatTakenAt(value: string | null) {
  if (value === null) {
    return 'Unknown';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function ViewerSidePanel({ photo }: ViewerSidePanelProps) {
  return (
    <aside className="pointer-events-auto flex h-full w-full max-w-sm flex-col rounded-[32px] border border-white/10 bg-black/55 p-6 text-white shadow-2xl backdrop-blur-xl">
      <h2 className="text-lg font-semibold">Info</h2>
      <div className="mt-6 space-y-5 text-sm">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Filename</p>
          <p className="mt-2 break-all text-white/90">{photo.filename}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Captured</p>
          <p className="mt-2 text-white/90">{formatTakenAt(photo.takenAt)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Dimensions</p>
          <p className="mt-2 text-white/90">{formatDimensions(photo)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/45">Aspect ratio</p>
          <p className="mt-2 text-white/90">
            {photo.width !== null && photo.height !== null ? `${photo.width}:${photo.height}` : 'Unknown'}
          </p>
        </div>
      </div>
    </aside>
  );
}
