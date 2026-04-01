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
    mockedFetchPhotos.mockImplementation(async () => photos);
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0,
    });
  });

  it('renders the exhibition header, hero, month sections, and photo tiles', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<ExhibitionPage />);

    expect(await screen.findByRole('banner')).toHaveTextContent('Settings');
    expect(screen.getByTestId('gallery-wordmark')).toHaveTextContent('Gallery');
    expect(screen.queryByRole('heading', { name: 'A curated wall of AIGC imagery.' })).not.toBeInTheDocument();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
  });

  it('shows the header shell and wordmark when the page is at the top', async () => {
    render(<ExhibitionPage />);

    await screen.findByRole('banner');
    expect(screen.getByTestId('gallery-header-shell').className).toContain('opacity-100');
    expect(screen.getByTestId('gallery-wordmark')).toHaveTextContent('Gallery');
  });

  it('hides the whole header after downward scroll and only reveals it after enough upward scroll', async () => {
    render(<ExhibitionPage />);

    await screen.findByRole('banner');
    const headerShell = screen.getByTestId('gallery-header-shell');

    act(() => {
      window.scrollY = 80;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(headerShell.className).toContain('opacity-0');

    act(() => {
      window.scrollY = 40;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(headerShell.className).toContain('opacity-0');

    act(() => {
      window.scrollY = 0;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(headerShell.className).toContain('opacity-100');
  });

  it('opens the gallery settings dialog from the header', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.getByRole('dialog', { name: 'Gallery settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close gallery settings' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Newest first' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument();
  });

  it('updates the waterfall column count from gallery settings', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: '2' }));

    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '2');
  });

  it('updates rendered order when switching sort preference', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    const initialButtons = await screen.findAllByRole('button', { name: /Open .*\.jpg/ });
    expect(initialButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open late-afternoon.jpg',
      'Open fresh.jpg',
      'Open older.jpg',
    ]);

    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Oldest first' }));

    const reorderedButtons = screen.getAllByRole('button', { name: /Open .*\.jpg/ });
    expect(reorderedButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open older.jpg',
      'Open fresh.jpg',
      'Open late-afternoon.jpg',
    ]);
  });

  it('refetches photos when switching media source', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'r2');

    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Server local' }));

    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(2, 'local');
  });

  it('closes the gallery settings dialog with Escape and backdrop click', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Gallery settings' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByTestId('gallery-settings-backdrop'));

    expect(screen.queryByRole('dialog', { name: 'Gallery settings' })).not.toBeInTheDocument();
  });

  it('opens the in-page viewer when a photo tile is clicked', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
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
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-19.jpg' })).toBeInTheDocument();
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
  });
});
