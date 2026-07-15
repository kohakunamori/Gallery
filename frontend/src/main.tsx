import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerImageCacheServiceWorker } from './services/imageCacheServiceWorker';
import { applyGalleryThemePreference, readGalleryThemePreference } from './utils/galleryTheme';
import { applyGalleryAccent, readGalleryAccentPreference } from './utils/galleryAccent';
import './index.css';

applyGalleryThemePreference(readGalleryThemePreference());
applyGalleryAccent(readGalleryAccentPreference());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

if (import.meta.env.PROD) {
  void registerImageCacheServiceWorker();
}
