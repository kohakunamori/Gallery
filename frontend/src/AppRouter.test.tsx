import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRouter } from './AppRouter';

vi.mock('./pages/PhotosPage', () => ({
  PhotosPage: () => <div>Photos page body</div>,
}));

vi.mock('./pages/AlbumsPage', () => ({
  AlbumsPage: () => <div>Albums page body</div>,
}));

describe('AppRouter', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('renders the photos route for /', () => {
    window.history.replaceState({}, '', '/');

    render(<AppRouter />);

    expect(screen.getByText('Photos page body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the photos route for /photos', () => {
    window.history.replaceState({}, '', '/photos');

    render(<AppRouter />);

    expect(screen.getByText('Photos page body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Photos' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders the albums route for /albums/', () => {
    window.history.replaceState({}, '', '/albums/');

    render(<AppRouter />);

    expect(screen.getByText('Albums page body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Albums' })).toHaveAttribute('aria-current', 'page');
  });

  it('renders a not found state for unknown routes', () => {
    window.history.replaceState({}, '', '/missing');

    render(<AppRouter />);

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('The page you requested is not available.')).toBeInTheDocument();
  });
});
