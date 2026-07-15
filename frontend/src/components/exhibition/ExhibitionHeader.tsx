import { memo } from 'react';
import { t } from '../../i18n';

type ExhibitionHeaderProps = {
  isAtTop: boolean;
  isVisible: boolean;
  onOpenSettings: () => void;
};

export const ExhibitionHeader = memo(function ExhibitionHeader({ isAtTop, isVisible, onOpenSettings }: ExhibitionHeaderProps) {
  const shellInertProps = !isVisible ? ({ inert: true } as Record<string, unknown>) : {};

  return (
    <header className="fixed inset-x-0 top-0 z-40 px-4 py-5 md:px-8" role="banner">
      <div
        className={`gallery-header-shell mx-auto max-w-[2400px] transition-all duration-300 ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
        }`}
        data-testid="gallery-header-shell"
        aria-hidden={isVisible ? undefined : true}
        {...shellInertProps}
      >
        <div className="relative min-h-12">
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-500"
            data-testid="gallery-wordmark"
          >
            <div
              className={`rounded-full px-5 py-3 transition-all duration-300 ${
                isAtTop
                  ? 'gallery-chrome-surface bg-surface/82 backdrop-blur-xl'
                  : 'gallery-chrome-surface-scrolled bg-surface/92 backdrop-blur-2xl'
              }`}
            >
              <p className="font-headline text-sm font-medium uppercase tracking-[0.28em] text-on-surface">{t('header.wordmark')}</p>
            </div>
          </div>

          <div className="flex justify-between">
            <div className="flex items-center gap-2">
              <a
                href="/upload"
                aria-label={t('header.openUpload')}
                tabIndex={isVisible ? undefined : -1}
                className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-on-surface transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isAtTop
                    ? 'gallery-chrome-surface bg-surface/78 backdrop-blur-xl'
                    : 'gallery-chrome-surface-scrolled bg-surface/92 backdrop-blur-2xl'
                }`}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 14.5V3.5m0 0L5.8 7.7M10 3.5l4.2 4.2" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 13.5v2.2c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5v-2.2" />
                </svg>
                <span className="hidden md:inline">{t('header.upload')}</span>
              </a>

              <a
                href="/albums"
                aria-label={t('header.openAlbums')}
                tabIndex={isVisible ? undefined : -1}
                className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-on-surface transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isAtTop
                    ? 'gallery-chrome-surface bg-surface/78 backdrop-blur-xl'
                    : 'gallery-chrome-surface-scrolled bg-surface/92 backdrop-blur-2xl'
                }`}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-[1.7]">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 5.5h5v5h-5v-5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 5.5h5v5h-5v-5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 12.5h5v5h-5v-5Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.5 12.5h5v5h-5v-5Z" />
                </svg>
                <span className="hidden md:inline">{t('header.albums')}</span>
              </a>
            </div>

            <button
              type="button"
              aria-label={t('header.openSettings')}
              onClick={onOpenSettings}
              tabIndex={isVisible ? undefined : -1}
              className={`inline-flex min-h-12 items-center gap-2 rounded-full px-4 text-sm font-medium text-on-surface transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                isAtTop
                  ? 'gallery-chrome-surface bg-surface/78 backdrop-blur-xl'
                  : 'gallery-chrome-surface-scrolled bg-surface/92 backdrop-blur-2xl'
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
              <span className="hidden md:inline">{t('header.settings')}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});
