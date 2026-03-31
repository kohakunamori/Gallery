import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExhibitionPage } from './ExhibitionPage';
import { fetchPhotos } from '../services/photos';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

vi.mock('../utils/photoQuery', () => ({
  readSelectedPhotoId: vi.fn(() => null),
  writeSelectedPhotoId: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}
  unobserve() {}

  trigger(isIntersecting = true) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

const photos = [
  {
    id: 'late-afternoon',
    filename: 'late-afternoon.jpg',
    url: '/media/late-afternoon.jpg',
    thumbnailUrl: '/media/late-afternoon.jpg',
    takenAt: '2026-03-31T16:30:00Z',
    sortTime: '2026-03-31T16:30:00Z',
    width: 1000,
    height: 1400,
  },
  {
    id: 'fresh',
    filename: 'fresh.jpg',
    url: '/media/fresh.jpg',
    thumbnailUrl: '/media/fresh.jpg',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1200,
    height: 800,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: '/media/older.jpg',
    thumbnailUrl: '/media/older.jpg',
    takenAt: '2026-02-28T12:00:00Z',
    sortTime: '2026-02-28T12:00:00Z',
    width: 1600,
    height: 900,
  },
];

describe('ExhibitionPage', () => {
  beforeEach(() => {
    mockedFetchPhotos.mockReset();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  it('renders the exhibition header, hero, month sections, and photo tiles', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<ExhibitionPage />);

    expect(await screen.findByRole('banner')).toHaveTextContent('The Curator');
    expect(screen.getByRole('heading', { name: 'A living exhibition of recent work.' })).toBeInTheDocument();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
  });

  it('opens the in-page viewer when a photo tile is clicked', async () => {
    const user = userEvent.setup();
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
  });

  it('shows an empty message when no photos are returned', async () => {
    mockedFetchPhotos.mockResolvedValue([]);

    render(<ExhibitionPage />);

    expect(await screen.findByText('No works are available yet.')).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    mockedFetchPhotos.mockRejectedValue(new Error('boom'));

    render(<ExhibitionPage />);

    expect(await screen.findByText('Unable to load the exhibition right now.')).toBeInTheDocument();
  });

  it('reveals more photos when the load trigger enters the viewport', async () => {
    const manyPhotos = Array.from({ length: 20 }, (_, index) => ({
      id: `photo-${index}`,
      filename: `photo-${index}.jpg`,
      url: `/media/photo-${index}.jpg`,
      thumbnailUrl: `/media/photo-${index}.jpg`,
      takenAt: '2026-03-31T09:00:00Z',
      sortTime: `2026-03-${String(31 - index).padStart(2, '0')}T09:00:00Z`,
      width: 1200,
      height: 800,
    }));

    mockedFetchPhotos.mockResolvedValue(manyPhotos);

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open photo-0.jpg' });

    expect(screen.queryByRole('button', { name: 'Open photo-19.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-19.jpg' })).toBeInTheDocument();
    expect(screen.getByText('End of exhibition')).toBeInTheDocument();
  });

  it('loads one batch per visibility entry and requires leaving before loading again', async () => {
    const manyPhotos = Array.from({ length: 40 }, (_, index) => ({
      id: `photo-${index}`,
      filename: `photo-${index}.jpg`,
      url: `/media/photo-${index}.jpg`,
      thumbnailUrl: `/media/photo-${index}.jpg`,
      takenAt: '2026-03-31T09:00:00Z',
      sortTime: `2026-03-31T09:${String(59 - index).padStart(2, '0')}:00Z`,
      width: 1200,
      height: 800,
    }));

    mockedFetchPhotos.mockResolvedValue(manyPhotos);

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open photo-0.jpg' });

    expect(screen.queryByRole('button', { name: 'Open photo-29.jpg' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open photo-30.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-29.jpg' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open photo-30.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(screen.queryByRole('button', { name: 'Open photo-30.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger(false);
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-39.jpg' })).toBeInTheDocument();
    expect(screen.getByText('End of exhibition')).toBeInTheDocument();
  });
});
