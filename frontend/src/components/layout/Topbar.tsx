import type { AppRoute } from './AppShell';

type TopbarProps = {
  route: AppRoute;
};

export function Topbar({ route }: TopbarProps) {
  return (
    <header className="glass-nav sticky top-0 z-30 flex h-16 items-center justify-between px-6 md:px-12">
      <div className="flex flex-1 items-center gap-4">
        <div className="relative w-full max-w-xl">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-outline">⌕</span>
          <input
            type="text"
            placeholder="Search your memories..."
            disabled
            className="w-full rounded-full bg-surface-container-high py-2.5 pl-12 pr-4 text-sm"
          />
        </div>
      </div>

      <div className="ml-4 text-sm font-semibold text-on-surface">
        {route === 'photos' ? 'Photos' : route === 'albums' ? 'Albums' : 'Not found'}
      </div>
    </header>
  );
}
