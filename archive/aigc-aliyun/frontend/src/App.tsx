import { ExhibitionPage } from './pages/ExhibitionPage';
import { UploadPage } from './pages/UploadPage';

export default function App() {
  return window.location.pathname === '/upload' ? <UploadPage /> : <ExhibitionPage />;
}
