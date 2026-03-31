export function ViewerActionBar() {
  return (
    <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-3 py-2 text-white shadow-2xl backdrop-blur-xl">
      <button
        type="button"
        aria-label="Zoom out"
        disabled
        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 opacity-60 disabled:cursor-not-allowed"
      >
        Zoom out
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        disabled
        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 opacity-60 disabled:cursor-not-allowed"
      >
        Zoom in
      </button>
      <button
        type="button"
        aria-label="Toggle details"
        disabled
        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/60 opacity-60 disabled:cursor-not-allowed"
      >
        Details
      </button>
    </div>
  );
}
