import type { ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export type AppRoute = 'photos' | 'albums' | 'not-found';

interface AppShellProps {
  route: AppRoute;
  children: ReactNode;
}

export function AppShell({ route, children }: AppShellProps) {
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Sidebar route={route} />
      <div className="min-h-screen md:ml-64">
        <Topbar route={route} />
        <main>{children}</main>
      </div>
    </div>
  );
}
