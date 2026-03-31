import { AppShell, type AppRoute } from './components/layout/AppShell';
import { AlbumsPage } from './pages/AlbumsPage';
import { PhotosPage } from './pages/PhotosPage';

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function resolveRoute(pathname: string): AppRoute {
  const normalizedPathname = normalizePathname(pathname);

  if (normalizedPathname === '/' || normalizedPathname === '/photos') {
    return 'photos';
  }

  if (normalizedPathname === '/albums') {
    return 'albums';
  }

  return 'not-found';
}

function NotFoundPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-12 md:px-12">
      <h1 className="font-headline text-4xl font-extrabold tracking-tight text-on-surface">Page not found</h1>
      <p className="mt-4 text-sm text-on-surface-variant">The page you requested is not available.</p>
    </section>
  );
}

export function AppRouter() {
  const route = resolveRoute(window.location.pathname);

  return (
    <AppShell route={route}>
      {route === 'albums' ? <AlbumsPage /> : route === 'photos' ? <PhotosPage /> : <NotFoundPage />}
    </AppShell>
  );
}
