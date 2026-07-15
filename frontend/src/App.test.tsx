import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./pages/ExhibitionPage', () => ({
  ExhibitionPage: () => <div>Exhibition page body</div>,
}));

vi.mock('./pages/UploadPage', () => ({
  UploadPage: () => <div>Upload page body</div>,
}));

vi.mock('./pages/AlbumsPage', () => ({
  AlbumsPage: () => <div>Albums page body</div>,
}));

vi.mock('./pages/AlbumDetailPage', () => ({
  AlbumDetailPage: ({ albumId }: { albumId: string }) => <div>Album detail body {albumId}</div>,
}));

describe('App', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('renders the exhibition page at the root path', () => {
    window.history.replaceState(null, '', '/');

    render(<App />);

    expect(screen.getByText('Exhibition page body')).toBeInTheDocument();
  });

  it('renders the upload page at the upload path', () => {
    window.history.replaceState(null, '', '/upload');

    render(<App />);

    expect(screen.getByText('Upload page body')).toBeInTheDocument();
  });

  it('renders the albums list at /albums', () => {
    window.history.replaceState(null, '', '/albums');

    render(<App />);

    expect(screen.getByText('Albums page body')).toBeInTheDocument();
  });

  it('renders album detail at /albums/{id}', () => {
    window.history.replaceState(null, '', '/albums/travel');

    render(<App />);

    expect(screen.getByText('Album detail body travel')).toBeInTheDocument();
  });

  it('renders album detail from ?album= soft fallback', () => {
    window.history.replaceState(null, '', '/albums?album=home');

    render(<App />);

    expect(screen.getByText('Album detail body home')).toBeInTheDocument();
  });
});
