type ViewerActionBarProps = {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  showDetails: boolean;
  onToggleDetails: () => void;
};

export function ViewerActionBar({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  showDetails,
  onToggleDetails,
}: ViewerActionBarProps) {
  const canZoomIn = zoomLevel < 300;
  const canZoomOut = zoomLevel > 100;

  return (
    <div className="pointer-events-auto inline-flex items-center gap-3 rounded-full border border-white/8 bg-neutral-900/80 px-4 py-3 text-white shadow-2xl backdrop-blur-xl">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={!canZoomOut}
        onClick={onZoomOut}
        className="flex flex-col items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:text-white/50"
      >
        Zoom out
      </button>

      <span className="text-xs font-medium text-white/70">{zoomLevel}%</span>

      <button
        type="button"
        aria-label="Zoom in"
        disabled={!canZoomIn}
        onClick={onZoomIn}
        className="flex flex-col items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:text-white/50"
      >
        Zoom in
      </button>

      <button
        type="button"
        aria-label={showDetails ? 'Hide details' : 'Show details'}
        onClick={onToggleDetails}
        className="flex flex-col items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] px-3 py-2 text-xs font-medium text-white transition-all duration-200 hover:bg-white/10 hover:text-white"
      >
        {showDetails ? 'Hide details' : 'Show details'}
      </button>
    </div>
  );
}
