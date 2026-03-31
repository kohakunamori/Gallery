import type { AppRoute } from './AppShell';

const disabledItems = ['Sharing', 'Archive', 'Trash'];

interface SidebarProps {
  route: AppRoute;
}

const navItems: Array<{ label: 'Photos' | 'Albums'; href: '/photos' | '/albums'; route: AppRoute }> = [
  { label: 'Photos', href: '/photos', route: 'photos' },
  { label: 'Albums', href: '/albums', route: 'albums' },
];

export function Sidebar({ route }: SidebarProps) {
  return (
    <aside className="hidden md:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col gap-4 bg-surface-container-low px-4 py-6 text-on-surface">
      <div className="px-4">
        <p className="font-headline text-xl font-extrabold tracking-tight text-primary">Immich</p>
        <p className="mt-1 text-xs uppercase tracking-[0.3em] text-on-surface-variant">Your Digital Archive</p>
      </div>

      <nav className="flex flex-col gap-2 px-2" aria-label="Primary navigation">
        {navItems.map((item) => {
          const isActive = item.route === route;

          return (
            <a
              key={item.label}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-fixed font-semibold text-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high',
              ].join(' ')}
            >
              {item.label}
            </a>
          );
        })}

        {disabledItems.map((item) => (
          <button
            key={item}
            type="button"
            disabled
            className="rounded-xl px-4 py-3 text-left text-sm font-medium text-on-surface-variant opacity-60"
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}
