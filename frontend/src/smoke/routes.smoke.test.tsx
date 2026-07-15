import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../pages/ExhibitionPage', () => ({
  ExhibitionPage: () => <div data-testid="exhibition-route">Exhibition page body</div>,
}));

vi.mock('../pages/UploadPage', () => ({
  UploadPage: () => <div data-testid="upload-route">Upload page body</div>,
}));

vi.mock('../pages/AlbumsPage', () => ({
  AlbumsPage: () => <div data-testid="albums-route">Albums page body</div>,
}));

vi.mock('../pages/AlbumDetailPage', () => ({
  AlbumDetailPage: ({ albumId }: { albumId: string }) => (
    <div data-testid="album-detail-route">Album {albumId}</div>
  ),
}));

describe('route smoke', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders the exhibition page for /', () => {
    window.history.replaceState(null, '', '/');

    render(<App />);

    expect(screen.getByTestId('exhibition-route')).toBeInTheDocument();
    expect(screen.queryByTestId('upload-route')).not.toBeInTheDocument();
  });

  it('renders the upload page for /upload', () => {
    window.history.replaceState(null, '', '/upload');

    render(<App />);

    expect(screen.getByTestId('upload-route')).toBeInTheDocument();
    expect(screen.queryByTestId('exhibition-route')).not.toBeInTheDocument();
  });

  it('renders the albums page for /albums', () => {
    window.history.replaceState(null, '', '/albums');

    render(<App />);

    expect(screen.getByTestId('albums-route')).toBeInTheDocument();
  });

  it('renders the album detail page for /albums/:id', () => {
    window.history.replaceState(null, '', '/albums/summer');

    render(<App />);

    expect(screen.getByTestId('album-detail-route')).toHaveTextContent('Album summer');
  });
});
