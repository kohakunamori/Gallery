/**
 * Path routing (no router library). Deep links:
 * - `/` exhibition
 * - `/upload` upload
 * - `/albums` album list
 * - `/albums/{id}` album detail (preferred); soft fallback `/albums?album={id}`
 */
import { AlbumDetailPage } from './pages/AlbumDetailPage';
import { AlbumsPage } from './pages/AlbumsPage';
import { ExhibitionPage } from './pages/ExhibitionPage';
import { UploadPage } from './pages/UploadPage';
import { resolveAppRoute } from './utils/albumRoute';

export default function App() {
  const route = resolveAppRoute(window.location.pathname, window.location.search);

  switch (route.name) {
    case 'upload':
      return <UploadPage />;
    case 'albums':
      return <AlbumsPage />;
    case 'album-detail':
      return <AlbumDetailPage albumId={route.albumId} />;
    case 'exhibition':
    default:
      return <ExhibitionPage />;
  }
}
