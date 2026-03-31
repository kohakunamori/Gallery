import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { fetchAlbums } from '../services/albums';

vi.mock('../services/albums', () => ({
  fetchAlbums: vi.fn(),
}));

const mockedFetchAlbums = vi.mocked(fetchAlbums);

describe('AlbumsPage', () => {
  beforeEach(() => {
    mockedFetchAlbums.mockReset();
    window.history.replaceState({}, '', '/albums');
  });

  it('renders real albums from the API', async () => {
    mockedFetchAlbums.mockResolvedValue([
      {
        id: 'travel',
        name: 'travel',
        coverUrl: '/media/travel/cover.jpg',
        photoCount: 12,
        latestSortTime: '2026-03-31T08:30:00+00:00',
      },
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'travel' })).toBeInTheDocument();
    expect(screen.getByText('12 photos')).toBeInTheDocument();
  });

  it('shows the empty state when the API returns no albums', async () => {
    mockedFetchAlbums.mockResolvedValue([]);

    render(<App />);

    expect(await screen.findByText('No album folders found yet.')).toBeInTheDocument();
  });

  it('shows the error state when loading albums fails', async () => {
    mockedFetchAlbums.mockRejectedValue(new Error('boom'));

    render(<App />);

    expect(await screen.findByText('Unable to load albums right now.')).toBeInTheDocument();
  });
});
