import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExhibitionPage } from './ExhibitionPage';
import { fetchPhotos } from '../services/photos';
import { fetchMediaSourceStatuses } from '../services/mediaSources';
import type { MediaSourceStatus } from '../services/mediaSources';
import { GALLERY_MEDIA_SOURCE_VISIBILITY, GALLERY_SETTINGS_STORAGE_KEY } from '../utils/gallerySettings';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

vi.mock('../services/mediaSources', () => ({
  fetchMediaSourceStatuses: vi.fn(),
}));

vi.mock('../utils/photoQuery', () => ({
  readSelectedPhotoId: vi.fn(() => null),
  writeSelectedPhotoId: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);
const mockedFetchMediaSourceStatuses = vi.mocked(fetchMediaSourceStatuses);

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
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

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => {
      this.onload?.();
    });
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

const mediaSourceStatuses: MediaSourceStatus[] = [
  {
    source: 'r2' as const,
    isAvailable: true,
    isDisabled: false,
    status: 'available',
  },
  {
    source: 'qiniu' as const,
    isAvailable: true,
    isDisabled: false,
    status: 'available',
    usage: {
      period: '2026-04',
      usedBytes: 1024 ** 3,
      quotaBytes: 10 * 1024 ** 3,
      remainingBytes: 9 * 1024 ** 3,
      isDisabled: false,
      isAvailable: true,
      status: 'available',
      lastUpdatedAt: '2026-04-06T00:00:00Z',
    },
  },
  {
    source: 'local' as const,
    isAvailable: true,
    isDisabled: false,
    status: 'available',
  },
];

describe('ExhibitionPage', () => {
  beforeEach(() => {
    mockedFetchPhotos.mockReset();
    mockedFetchPhotos.mockImplementation(async () => photos);
    mockedFetchMediaSourceStatuses.mockReset();
    mockedFetchMediaSourceStatuses.mockResolvedValue(mediaSourceStatuses);
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal('Image', MockImage);
    window.localStorage.clear();
    GALLERY_MEDIA_SOURCE_VISIBILITY.r2 = true;
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = true;
    GALLERY_MEDIA_SOURCE_VISIBILITY.local = true;
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the exhibition header, hero, month sections, and photo tiles', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<ExhibitionPage />);

    expect(await screen.findByRole('banner')).toHaveTextContent('Settings');
    expect(screen.getByRole('link', { name: 'Open gallery upload' })).toHaveAttribute('href', '/upload');
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

    const dialog = screen.getByRole('dialog', { name: 'Gallery settings' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass('overflow-y-auto');
    expect(screen.getByRole('button', { name: 'Close gallery settings' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Newest first' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Random order' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Auto' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Qiniu' })).toBeInTheDocument();
    expect(screen.getByText('Qiniu monthly traffic')).toBeInTheDocument();
    expect(screen.getByText('1.00 / 10.00 GB')).toBeInTheDocument();
    expect(screen.getByLabelText('Selected waterfall column count').parentElement?.parentElement).toHaveClass('flex-col', 'sm:flex-row');
    expect(screen.getByRole('progressbar', { name: 'Qiniu monthly traffic usage' })).toHaveAttribute('aria-valuenow', '10');
  });

  it('uses warning color when Qiniu traffic reaches 80 percent', async () => {
    const user = userEvent.setup();

    mockedFetchMediaSourceStatuses.mockResolvedValue([
      mediaSourceStatuses[0],
      {
        ...mediaSourceStatuses[1],
        usage: {
          period: '2026-04',
          usedBytes: 8 * 1024 ** 3,
          quotaBytes: 10 * 1024 ** 3,
          remainingBytes: 2 * 1024 ** 3,
          isDisabled: false,
          isAvailable: true,
          status: 'available',
          lastUpdatedAt: '2026-04-06T00:00:00Z',
        },
      },
      mediaSourceStatuses[2],
    ]);

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    const progressBar = screen.getByRole('progressbar', { name: 'Qiniu monthly traffic usage' });
    expect(progressBar).toHaveAttribute('aria-valuenow', '80');
    expect(progressBar.firstElementChild).toHaveClass('bg-amber-500');
  });

  it('uses critical color when Qiniu traffic reaches 100 percent', async () => {
    const user = userEvent.setup();

    mockedFetchMediaSourceStatuses.mockResolvedValue([
      mediaSourceStatuses[0],
      {
        ...mediaSourceStatuses[1],
        isDisabled: true,
        usage: {
          period: '2026-04',
          usedBytes: 10 * 1024 ** 3,
          quotaBytes: 10 * 1024 ** 3,
          remainingBytes: 0,
          isDisabled: true,
          isAvailable: false,
          status: 'over-quota',
          lastUpdatedAt: '2026-04-06T00:00:00Z',
        },
      },
      mediaSourceStatuses[2],
    ]);

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    const progressBar = screen.getByRole('progressbar', { name: 'Qiniu monthly traffic usage' });
    expect(progressBar).toHaveAttribute('aria-valuenow', '100');
    expect(progressBar.firstElementChild).toHaveClass('bg-red-500');
  });

  it('hides auto when qiniu is hidden and removes the qiniu usage card', async () => {
    const user = userEvent.setup();
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = false;
    GALLERY_MEDIA_SOURCE_VISIBILITY.local = false;

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.queryAllByRole('button', { name: 'Auto' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Qiniu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Server local' })).not.toBeInTheDocument();
    expect(screen.queryByText('Qiniu monthly traffic')).not.toBeInTheDocument();
  });

  it('shows the current fixed column count in the stepper while auto is selected', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.getByLabelText('Selected waterfall column count')).toHaveTextContent('4');
    expect(screen.getAllByRole('button', { name: 'Auto' }).at(-1)).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides auto when r2 is hidden', async () => {
    const user = userEvent.setup();
    GALLERY_MEDIA_SOURCE_VISIBILITY.r2 = false;

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.queryAllByRole('button', { name: 'Auto' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'R2' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Qiniu' })).toBeInTheDocument();
  });

  it('updates the waterfall column count from gallery settings', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Increase waterfall columns' }));

    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '5');
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
      'Open late-afternoon.jpg',
      'Open fresh.jpg',
      'Open older.jpg',
    ]);
  });

  it('keeps month groups newest first while randomizing photos within a month', async () => {
    const user = userEvent.setup();

    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9);

    render(<ExhibitionPage />);

    await screen.findAllByRole('button', { name: /Open .*\.jpg/ });
    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Random order' }));

    const monthHeadings = screen.getAllByRole('heading', { name: /^(March|February) 2026$/ });
    expect(monthHeadings.map((heading) => heading.textContent)).toEqual(['March 2026', 'February 2026']);

    expect(screen.getByRole('button', { name: 'Open fresh.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open older.jpg' })).toBeInTheDocument();
  });

  it('keeps later month headings available after loading enough random photos', async () => {
    const user = userEvent.setup();
    const manyPhotos = [
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `april-${index}`,
        filename: `april-${index}.jpg`,
        url: `/media/april-${index}.jpg`,
        thumbnailUrl: `/media/april-${index}.jpg`,
        takenAt: `2026-04-${String(30 - index).padStart(2, '0')}T09:00:00Z`,
        sortTime: `2026-04-${String(30 - index).padStart(2, '0')}T09:00:00Z`,
        width: 1200,
        height: 800,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `march-${index}`,
        filename: `march-${index}.jpg`,
        url: `/media/march-${index}.jpg`,
        thumbnailUrl: `/media/march-${index}.jpg`,
        takenAt: `2026-03-${String(31 - index).padStart(2, '0')}T09:00:00Z`,
        sortTime: `2026-03-${String(31 - index).padStart(2, '0')}T09:00:00Z`,
        width: 1200,
        height: 800,
      })),
    ];

    mockedFetchPhotos.mockResolvedValue(manyPhotos);
    vi.spyOn(Math, 'random').mockReturnValue(0);

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open april-0.jpg' });
    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Random order' }));

    expect(screen.queryByRole('heading', { name: 'March 2026' })).not.toBeInTheDocument();

    act(() => {
      for (const instance of MockIntersectionObserver.instances) {
        instance.trigger(true);
      }
    });

    expect(await screen.findByRole('heading', { name: 'March 2026' })).toBeInTheDocument();
  });

  it('refetches photos when switching media source', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'r2', expect.any(AbortSignal));

    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Server local' }));

    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(2, 'local', expect.any(AbortSignal));
  });

  it('supports selecting qiniu as the media source', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    await user.click(screen.getByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Qiniu' }));

    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(2, 'qiniu', expect.any(AbortSignal));
  });

  it('hydrates localStorage custom column counts on first render', async () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 6,
        sortPreference: 'random',
        mediaSourcePreference: 'local',
      }),
    );

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'local', expect.any(AbortSignal));
    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '6');
  });

  it('hydrates persisted qiniu settings when qiniu is available', async () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'qiniu',
      }),
    );

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'qiniu', expect.any(AbortSignal));
  });

  it('persists settings after the user changes them', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Increase waterfall columns' }));
    await user.click(screen.getByRole('button', { name: 'Random order' }));
    await user.click(screen.getByRole('button', { name: 'Server local' }));

    expect(JSON.parse(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      columnPreference: 5,
      sortPreference: 'random',
      mediaSourcePreference: 'local',
    });
  });

  it('falls back from persisted qiniu to r2 when qiniu is disabled', async () => {
    mockedFetchMediaSourceStatuses.mockResolvedValue([
      mediaSourceStatuses[0],
      {
        ...mediaSourceStatuses[1],
        isAvailable: false,
        isDisabled: true,
        status: 'over-quota',
        message: 'Qiniu monthly traffic quota has been reached.',
        usage: {
          ...mediaSourceStatuses[1].usage!,
          usedBytes: 11 * 1024 ** 3,
          quotaBytes: 10 * 1024 ** 3,
          remainingBytes: 0,
          isDisabled: true,
          isAvailable: false,
          status: 'over-quota',
        },
      },
      mediaSourceStatuses[2],
    ]);
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'qiniu',
      }),
    );

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    await waitFor(() => {
      expect(mockedFetchPhotos).toHaveBeenCalledWith('r2', expect.any(AbortSignal));
    });
    expect(JSON.parse(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      columnPreference: 'auto',
      sortPreference: 'newest',
      mediaSourcePreference: 'auto',
    });
  });

  it('normalizes oversized stored column counts', async () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 99,
        sortPreference: 'broken',
        mediaSourcePreference: 'cdn',
      }),
    );

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'r2', expect.any(AbortSignal));
    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '8');
  });

  it('normalizes persisted hidden media source preferences to r2 when auto is unavailable', async () => {
    GALLERY_MEDIA_SOURCE_VISIBILITY.qiniu = false;
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'qiniu',
      }),
    );

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'r2', expect.any(AbortSignal));
    expect(JSON.parse(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      columnPreference: 'auto',
      sortPreference: 'newest',
      mediaSourcePreference: 'r2',
    });
  });

  it('restores saved settings after remount', async () => {
    const user = userEvent.setup();

    const firstRender = render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Increase waterfall columns' }));
    await user.click(screen.getByRole('button', { name: 'Server local' }));

    firstRender.unmount();
    mockedFetchPhotos.mockClear();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, 'local', expect.any(AbortSignal));
    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '5');
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

  it('disables the qiniu option when the source status says it is unavailable', async () => {
    const user = userEvent.setup();

    mockedFetchMediaSourceStatuses.mockResolvedValue([
      mediaSourceStatuses[0],
      {
        ...mediaSourceStatuses[1],
        isAvailable: false,
        isDisabled: true,
        status: 'over-quota',
        message: 'Qiniu monthly traffic quota has been reached.',
      },
      mediaSourceStatuses[2],
    ]);

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.getByRole('button', { name: 'Qiniu' })).toBeDisabled();
    expect(screen.getByText('Qiniu monthly traffic quota has been reached.')).toBeInTheDocument();
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

  it('aborts the previous request when the media source changes', async () => {
    const user = userEvent.setup();
    const firstRequest = Promise.resolve(photos);
    const secondRequest = Promise.resolve(photos);

    mockedFetchPhotos
      .mockImplementationOnce((_mediaSource, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return firstRequest;
      })
      .mockImplementationOnce((_mediaSource, signal) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        return secondRequest;
      });

    render(<ExhibitionPage />);

    const firstSignal = mockedFetchPhotos.mock.calls[0]?.[1];
    expect(firstSignal?.aborted).toBe(false);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Server local' }));

    expect(firstSignal?.aborted).toBe(true);
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(2, 'local', expect.any(AbortSignal));
  });

  it('does not show an error when a request is aborted during cleanup', async () => {
    mockedFetchPhotos.mockImplementation(
      () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );

    const view = render(<ExhibitionPage />);

    view.unmount();

    await waitFor(() => {
      expect(screen.queryByText('Unable to load the exhibition right now.')).not.toBeInTheDocument();
    });
  });

  it('reveals more photos when the load trigger enters the viewport', async () => {
    const manyPhotos = Array.from({ length: 30 }, (_, index) => ({
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

    expect(screen.queryByRole('button', { name: 'Open photo-24.jpg' })).not.toBeInTheDocument();
    expect(MockIntersectionObserver.instances.at(-1)?.options?.rootMargin).toBe('1200px 0px');

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-29.jpg' })).toBeInTheDocument();
  });

  it('loads another batch after visible count grows even if the trigger never leaves intersection', async () => {
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

    expect(screen.queryByRole('button', { name: 'Open photo-24.jpg' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open photo-39.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger(true);
    });

    expect(await screen.findByRole('button', { name: 'Open photo-39.jpg' })).toBeInTheDocument();
  });
});
