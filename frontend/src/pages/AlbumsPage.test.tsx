import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlbumsPage } from './AlbumsPage';
import { fetchAlbums } from '../services/albums';
import { GALLERY_SETTINGS_STORAGE_KEY } from '../utils/gallerySettings';

vi.mock('../services/albums', () => ({
  fetchAlbums: vi.fn(),
}));

const mockedFetchAlbums = vi.mocked(fetchAlbums);

const sampleAlbums = [
  {
    id: 'travel',
    name: 'travel',
    coverUrl: 'https://r2.example.com/gallery/travel/cover.jpg',
    photoCount: 3,
    latestSortTime: '2026-03-31T09:00:00+00:00',
  },
  {
    id: 'home',
    name: 'home',
    coverUrl: 'https://r2.example.com/gallery/home/cover.jpg',
    photoCount: 1,
    latestSortTime: '2026-02-01T09:00:00+00:00',
  },
];

describe('AlbumsPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GALLERY_SETTINGS_STORAGE_KEY);
    mockedFetchAlbums.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders album cards from fetchAlbums', async () => {
    mockedFetchAlbums.mockResolvedValue(sampleAlbums);

    render(<AlbumsPage />);

    expect(screen.getByTestId('albums-skeleton')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('albums-grid')).toBeInTheDocument();
    });

    expect(mockedFetchAlbums).toHaveBeenCalledWith();
    expect(screen.getByRole('heading', { name: 'travel' })).toBeInTheDocument();
    expect(screen.getByText('3 photos')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'home' })).toBeInTheDocument();
    expect(screen.getByText('1 photo')).toBeInTheDocument();

    const travelLink = screen.getByTestId('album-card-travel');
    expect(travelLink).toHaveAttribute('href', '/albums/travel');
  });

  it('shows an empty state when there are no albums', async () => {
    mockedFetchAlbums.mockResolvedValue([]);

    render(<AlbumsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('exhibition-status-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No albums yet')).toBeInTheDocument();
  });

  it('shows an error state and can retry', async () => {
    const user = userEvent.setup();
    mockedFetchAlbums.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(sampleAlbums);

    render(<AlbumsPage />);

    await waitFor(() => {
      expect(screen.getByTestId('exhibition-status-error')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(screen.getByTestId('albums-grid')).toBeInTheDocument();
    });

    expect(mockedFetchAlbums).toHaveBeenCalledTimes(2);
  });
});
