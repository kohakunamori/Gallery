type ExhibitionHeaderProps = {
  isAtTop: boolean;
  isVisible: boolean;
  onOpenSettings: () => void;
};

export function ExhibitionHeader({ isAtTop, isVisible, onOpenSettings }: ExhibitionHeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 px-4 py-5 md:px-8" role="banner">
      <div
        className={`mx-auto max-w-[2400px] transition-all duration-300 ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
        }`}
        data-testid="gallery-header-shell"
      >
        <div className="relative min-h-12">
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
            data-testid="gallery-wordmark"
          >
            <div
              className={`rounded-full px-5 py-3 transition-all duration-300 ${
                isAtTop
                  ? 'bg-surface/82 shadow-[0_12px_40px_rgba(15,23,42,0.08)] backdrop-blur-xl'
                  : 'bg-surface/92 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-2xl'
              }`}
            >
              <p className="font-headline text-sm font-medium uppercase tracking-[0.28em] text-on-surface">Gallery</p>
            </div>
          </div>

          <div className="flex justify-between">
            <a
              href="/upload"
              aria-label="Open gallery upload"
              className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-on-surface transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isAtTop
                  ? 'bg-surface/78 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl'
                  : 'bg-surface/92 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-2xl'
              }`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 14.5V3.5m0 0L5.8 7.7M10 3.5l4.2 4.2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 13.5v2.2c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5v-2.2" />
              </svg>
              <span className="hidden md:inline">Upload</span>
            </a>

            <button
              type="button"
              aria-label="Open gallery settings"
              onClick={onOpenSettings}
              className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-on-surface transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isAtTop
                  ? 'bg-surface/78 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur-xl'
                  : 'bg-surface/92 shadow-[0_10px_24px_rgba(15,23,42,0.12)] backdrop-blur-2xl'
              }`}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.3 2.8h3.4l.5 2.1a5.7 5.7 0 0 1 1.1.6l2-.8 1.7 2.9-1.5 1.5c.1.4.1.8.1 1.1 0 .4 0 .8-.1 1.1l1.5 1.5-1.7 2.9-2-.8c-.4.2-.7.4-1.1.6l-.5 2.1H8.3l-.5-2.1a5.7 5.7 0 0 1-1.1-.6l-2 .8-1.7-2.9L4.5 12c-.1-.4-.1-.8-.1-1.1 0-.4 0-.8.1-1.1L3 8.3l1.7-2.9 2 .8c.4-.2.7-.4 1.1-.6l.5-2.1Z"
                />
                <circle cx="10" cy="10" r="2.1" />
              </svg>
              <span className="hidden md:inline">Settings</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
