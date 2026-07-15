import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlbumDetailPage } from './AlbumDetailPage';
import { fetchAlbums } from '../services/albums';
import { fetchPhotos } from '../services/photos';
import { GALLERY_SETTINGS_STORAGE_KEY } from '../utils/gallerySettings';

vi.mock('../services/albums', () => ({
  fetchAlbums: vi.fn(),
}));

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

const mockedFetchAlbums = vi.mocked(fetchAlbums);
const mockedFetchPhotos = vi.mocked(fetchPhotos);

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observedElements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observedElements.add(target);
  }

  disconnect() {
    this.observedElements.clear();
  }

  unobserve(target: Element) {
    this.observedElements.delete(target);
  }
}

const photos = [
  {
    id: 'travel-a',
    filename: 'a.jpg',
    url: 'https://r2.example.com/gallery/travel/a.jpg?v=travel-a',
    thumbnailUrl: 'https://r2.example.com/gallery/travel/a.jpg?v=travel-a',
    takenAt: '2026-03-31T16:30:00Z',
    sortTime: '2026-03-31T16:30:00Z',
    width: 1000,
    height: 1400,
  },
  {
    id: 'home-b',
    filename: 'b.jpg',
    url: 'https://r2.example.com/gallery/home/b.jpg?v=home-b',
    thumbnailUrl: 'https://r2.example.com/gallery/home/b.jpg?v=home-b',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1200,
    height: 800,
  },
  {
    id: 'travel-c',
    filename: 'c.jpg',
    url: 'https://r2.example.com/gallery/travel/c.jpg?v=travel-c',
    thumbnailUrl: 'https://r2.example.com/gallery/travel/c.jpg?v=travel-c',
    takenAt: '2026-02-28T12:00:00Z',
    sortTime: '2026-02-28T12:00:00Z',
    width: 1600,
    height: 900,
  },
];

describe('AlbumDetailPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(GALLERY_SETTINGS_STORAGE_KEY);
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    mockedFetchAlbums.mockReset();
    mockedFetchPhotos.mockReset();
    mockedFetchAlbums.mockResolvedValue([
      {
        id: 'travel',
        name: 'travel',
        coverUrl: 'https://r2.example.com/gallery/travel/a.jpg',
        photoCount: 2,
        latestSortTime: '2026-03-31T16:30:00Z',
      },
    ]);
    mockedFetchPhotos.mockResolvedValue(photos);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('filters photos to the album path prefix and renders the wall', async () => {
    render(<AlbumDetailPage albumId="travel" />);

    await waitFor(() => {
      expect(screen.getByText('2 photos')).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: 'travel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open a.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open c.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open b.jpg' })).not.toBeInTheDocument();
  });

  it('shows empty state when the album has no matching photos', async () => {
    render(<AlbumDetailPage albumId="missing" />);

    await waitFor(() => {
      expect(screen.getByTestId('exhibition-status-empty')).toBeInTheDocument();
    });

    expect(screen.getByText('No photos in this album')).toBeInTheDocument();
  });

  it('opens the photo viewer for album photos', async () => {
    const user = userEvent.setup();

    render(<AlbumDetailPage albumId="travel" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open a.jpg' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Open a.jpg' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
