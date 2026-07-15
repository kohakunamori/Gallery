import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExhibitionPage } from './ExhibitionPage';
import { fetchPhotos, resetPhotoRequestCache } from '../services/photos';
import { GALLERY_SETTINGS_STORAGE_KEY } from '../utils/gallerySettings';
import { GALLERY_THEME_STORAGE_KEY } from '../utils/galleryTheme';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
  resetPhotoRequestCache: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);
const mockedResetPhotoRequestCache = vi.mocked(resetPhotoRequestCache);

function resetLocation(path = '/') {
  window.history.replaceState(window.history.state, '', path);
}

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

  trigger(target?: Element, isIntersecting = true) {
    const resolvedTarget = target ?? this.observedElements.values().next().value ?? document.createElement('div');

    this.callback(
      [{ isIntersecting, target: resolvedTarget } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function getObserverForElement(element: Element) {
  return MockIntersectionObserver.instances.find((instance) => instance.observedElements.has(element));
}


const photos = [
  {
    id: 'late-afternoon',
    filename: 'late-afternoon.jpg',
    url: 'https://r2.example.com/late-afternoon.jpg?v=late-afternoon',
    thumbnailUrl: 'https://r2.example.com/late-afternoon.jpg?v=late-afternoon',
    takenAt: '2026-03-31T16:30:00Z',
    sortTime: '2026-03-31T16:30:00Z',
    width: 1000,
    height: 1400,
  },
  {
    id: 'fresh',
    filename: 'fresh.jpg',
    url: 'https://r2.example.com/fresh.jpg?v=fresh',
    thumbnailUrl: 'https://r2.example.com/fresh.jpg?v=fresh',
    takenAt: '2026-03-31T09:00:00Z',
    sortTime: '2026-03-31T09:00:00Z',
    width: 1200,
    height: 800,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: 'https://r2.example.com/older.jpg?v=older',
    thumbnailUrl: 'https://r2.example.com/older.jpg?v=older',
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
    mockedResetPhotoRequestCache.mockReset();
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(min-width: 768px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    resetLocation('/');
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      configurable: true,
      value: 0,
    });
  });

  afterEach(() => {
    // Avoid restoreAllMocks() here: RTL cleanup unmounts after this hook and theme
    // effects still need a working matchMedia. beforeEach re-stubs globals next test.
    resetLocation('/');
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
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
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'R2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Qiniu' })).not.toBeInTheDocument();
    expect(screen.queryByText('Media source')).not.toBeInTheDocument();
    expect(screen.queryByTestId('gallery-build-id')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Selected waterfall column count').parentElement?.parentElement).toHaveClass('flex-col', 'sm:flex-row');
  });

  it('shows the current fixed column count in the stepper while auto is selected', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));

    expect(screen.getByLabelText('Selected waterfall column count')).toHaveTextContent('4');
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
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
        instance.trigger();
      }
    });

    expect(await screen.findByRole('heading', { name: 'March 2026' })).toBeInTheDocument();
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
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, expect.any(AbortSignal));
    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '6');
  });

  it('persists settings after the user changes them', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Increase waterfall columns' }));
    await user.click(screen.getByRole('button', { name: 'Random order' }));

    expect(JSON.parse(window.localStorage.getItem(GALLERY_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      columnPreference: 5,
      sortPreference: 'random',
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
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, expect.any(AbortSignal));
    expect(screen.getAllByTestId(/waterfall-gallery/)[0]).toHaveAttribute('data-column-count', '8');
  });

  it('restores saved settings after remount', async () => {
    const user = userEvent.setup();

    const firstRender = render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Increase waterfall columns' }));

    firstRender.unmount();
    mockedFetchPhotos.mockClear();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });
    expect(mockedFetchPhotos).toHaveBeenNthCalledWith(1, expect.any(AbortSignal));
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

  it('opens the in-page viewer when a photo tile is clicked', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
  });

  it('writes the selected photo id with pushState when a tile is opened', async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open fresh.jpg' });
    replaceState.mockClear();
    pushState.mockClear();

    await user.click(screen.getByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
    expect(window.location.search).toBe('?photo=fresh');
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0]?.[2]).toBe('/?photo=fresh');
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('uses replaceState when opening another photo while the viewer is already open', async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));
    expect(window.location.search).toBe('?photo=fresh');

    replaceState.mockClear();
    pushState.mockClear();

    await user.click(screen.getByRole('button', { name: 'Open older.jpg' }));

    expect(window.location.search).toBe('?photo=older');
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('clears the photo query param with replaceState when the viewer closes', async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));
    expect(window.location.search).toBe('?photo=fresh');

    replaceState.mockClear();
    pushState.mockClear();

    await user.click(screen.getByRole('button', { name: 'Close image' }));

    expect(screen.queryByRole('dialog', { name: 'Image lightbox' })).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('updates the photo query with replaceState when navigating to the next image', async () => {
    const user = userEvent.setup();
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open late-afternoon.jpg' }));
    expect(window.location.search).toBe('?photo=late-afternoon');

    replaceState.mockClear();
    pushState.mockClear();

    await user.click(screen.getByRole('button', { name: 'Next image' }));

    expect(window.location.search).toBe('?photo=fresh');
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('closes the viewer when popstate clears the photo query', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));
    expect(screen.getByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
    expect(window.location.search).toBe('?photo=fresh');

    act(() => {
      window.history.replaceState(window.history.state, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Image lightbox' })).not.toBeInTheDocument();
    });
    expect(window.location.search).toBe('');
  });

  it('opens the viewer when popstate restores a valid photo query', async () => {
    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open fresh.jpg' });
    expect(screen.queryByRole('dialog', { name: 'Image lightbox' })).not.toBeInTheDocument();

    act(() => {
      window.history.replaceState(window.history.state, '', '/?photo=fresh');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(await screen.findByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
    expect(window.location.search).toBe('?photo=fresh');
  });

  it('clears selection with replaceState when popstate has an unknown photo id', async () => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });

    replaceState.mockClear();
    pushState.mockClear();

    act(() => {
      window.history.replaceState(window.history.state, '', '/?photo=missing-work');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(screen.queryByRole('dialog', { name: 'Image lightbox' })).not.toBeInTheDocument();
    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('hydrates a valid deep-linked photo after photos load', async () => {
    resetLocation('/?photo=fresh');

    render(<ExhibitionPage />);

    expect(await screen.findByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
    expect(window.location.search).toBe('?photo=fresh');
  });

  it('ignores an unknown deep-linked photo id and clears the query', async () => {
    resetLocation('/?photo=missing-work');

    render(<ExhibitionPage />);

    expect(await screen.findByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
    await waitFor(() => {
      expect(window.location.search).toBe('');
    });
    expect(screen.queryByRole('dialog', { name: 'Image lightbox' })).not.toBeInTheDocument();
  });

  it('shows the back-to-top control after scrolling and scrolls to the top when activated', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as typeof window.scrollTo;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });

    const backToTop = screen.getByTestId('back-to-top');
    expect(backToTop).toHaveAttribute('aria-hidden', 'true');

    act(() => {
      window.scrollY = 120;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(backToTop).toHaveAttribute('aria-hidden', 'false');
    await user.click(backToTop);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('uses instant scroll for back-to-top when reduced motion is preferred', async () => {
    const user = userEvent.setup();
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo as typeof window.scrollTo;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });

    const backToTop = screen.getByTestId('back-to-top');

    act(() => {
      window.scrollY = 120;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(backToTop).toHaveAttribute('aria-hidden', 'false');
    await user.click(backToTop);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('hides the back-to-top control while the viewer is open', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await screen.findByRole('button', { name: 'Open late-afternoon.jpg' });

    const backToTop = screen.getByTestId('back-to-top');

    act(() => {
      window.scrollY = 120;
      window.dispatchEvent(new Event('scroll'));
    });

    expect(backToTop).toHaveAttribute('aria-hidden', 'false');

    await user.click(screen.getByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Image lightbox' })).toBeInTheDocument();
    expect(backToTop).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows a loading skeleton before photos resolve', async () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'r2',
      }),
    );

    let resolvePhotos: (value: typeof photos) => void = () => undefined;
    mockedFetchPhotos.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePhotos = resolve;
        }),
    );

    render(<ExhibitionPage />);

    const skeleton = await screen.findByTestId('exhibition-skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute('data-column-count', '4');
    expect(screen.getAllByTestId('exhibition-skeleton-card').length).toBeGreaterThan(1);
    expect(screen.getByTestId('exhibition-hero-meta')).toHaveTextContent('Loading works…');
    expect(screen.getByLabelText('Loading exhibition')).toHaveAttribute('aria-busy', 'true');

    resolvePhotos(photos);

    expect(await screen.findByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
    expect(screen.queryByTestId('exhibition-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('exhibition-hero-meta')).toHaveTextContent(/3 works · \d+ months?/);
  });

  it('shows an empty status panel when no photos are returned', async () => {
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'r2',
      }),
    );
    mockedFetchPhotos.mockResolvedValue([]);

    render(<ExhibitionPage />);

    expect(await screen.findByTestId('exhibition-status-empty')).toBeInTheDocument();
    expect(screen.getByText('No works yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload first images' })).toHaveAttribute('href', '/upload');
  });

  it('shows an error panel with retry that refetches photos', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      GALLERY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        columnPreference: 'auto',
        sortPreference: 'newest',
        mediaSourcePreference: 'r2',
      }),
    );
    mockedFetchPhotos.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(photos);

    render(<ExhibitionPage />);

    expect(await screen.findByTestId('exhibition-status-error')).toBeInTheDocument();
    expect(screen.getByText('Unable to load the exhibition')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open upload' })).toHaveAttribute('href', '/upload');
    expect(mockedResetPhotoRequestCache).toHaveBeenCalled();
    const resetsBeforeRetry = mockedResetPhotoRequestCache.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
    expect(mockedFetchPhotos).toHaveBeenCalledTimes(2);
    expect(mockedResetPhotoRequestCache.mock.calls.length).toBeGreaterThan(resetsBeforeRetry);
  });

  it('does not show an error when a request is aborted during cleanup', async () => {
    mockedFetchPhotos.mockImplementation(
      () => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')),
    );

    const view = render(<ExhibitionPage />);

    view.unmount();

    await waitFor(() => {
      expect(screen.queryByTestId('exhibition-status-error')).not.toBeInTheDocument();
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

    expect(screen.queryByRole('button', { name: 'Open photo-16.jpg' })).not.toBeInTheDocument();

    const initialLoadedCount = screen
      .getAllByTestId(/waterfall-column-/)
      .reduce((sum, column) => sum + Number(column.getAttribute('data-total-count') ?? 0), 0);
    expect(initialLoadedCount).toBe(16);

    const loadTrigger = screen.getByText('Continue scrolling');
    const loadTriggerObserver = getObserverForElement(loadTrigger);

    expect(loadTriggerObserver?.options?.rootMargin).toBe('800px 0px');

    act(() => {
      loadTriggerObserver?.trigger(loadTrigger, true);
    });

    // Progressive load-more still completes (may take multiple auto re-triggers while intersecting).
    // Virtualized columns may not mount every card into the DOM at once.
    await waitFor(() => {
      const loadedCount = screen
        .getAllByTestId(/waterfall-column-/)
        .reduce((sum, column) => sum + Number(column.getAttribute('data-total-count') ?? 0), 0);
      expect(loadedCount).toBe(30);
    });
    expect(screen.queryByText('Continue scrolling')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open photo-0.jpg' })).toBeInTheDocument();
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

    expect(screen.queryByRole('button', { name: 'Open photo-16.jpg' })).not.toBeInTheDocument();

    const initialLoadedCount = screen
      .getAllByTestId(/waterfall-column-/)
      .reduce((sum, column) => sum + Number(column.getAttribute('data-total-count') ?? 0), 0);
    expect(initialLoadedCount).toBe(16);

    const loadTrigger = screen.getByText('Continue scrolling');
    const loadTriggerObserver = getObserverForElement(loadTrigger);

    act(() => {
      loadTriggerObserver?.trigger(loadTrigger, true);
    });

    await waitFor(() => {
      const loadedCount = screen
        .getAllByTestId(/waterfall-column-/)
        .reduce((sum, column) => sum + Number(column.getAttribute('data-total-count') ?? 0), 0);
      expect(loadedCount).toBe(40);
    });
    expect(screen.queryByText('Continue scrolling')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open photo-0.jpg' })).toBeInTheDocument();
  });


  it('applies dark data-theme from settings and persists gallery.theme', async () => {
    const user = userEvent.setup();

    render(<ExhibitionPage />);

    await user.click(await screen.findByRole('button', { name: 'Open gallery settings' }));
    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(GALLERY_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('hydrates theme preference and applies light data-theme on first render', async () => {
    window.localStorage.setItem(GALLERY_THEME_STORAGE_KEY, 'light');

    render(<ExhibitionPage />);

    await screen.findByRole('banner');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

});
