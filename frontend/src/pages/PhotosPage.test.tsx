import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { fetchPhotos } from '../services/photos';

vi.mock('../services/photos', () => ({
  fetchPhotos: vi.fn(),
}));

const mockedFetchPhotos = vi.mocked(fetchPhotos);

const photos = [
  {
    id: 'fresh',
    filename: 'fresh.jpg',
    url: '/media/fresh.jpg',
    thumbnailUrl: '/media/fresh.jpg',
    takenAt: '2026-03-31T09:00:00',
    sortTime: '2026-03-31T09:00:00',
    width: 1200,
    height: 800,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: '/media/older.jpg',
    thumbnailUrl: '/media/older.jpg',
    takenAt: '2026-03-28T12:00:00',
    sortTime: '2026-03-28T12:00:00',
    width: 1600,
    height: 900,
  },
  {
    id: 'late-afternoon',
    filename: 'late-afternoon.jpg',
    url: '/media/late-afternoon.jpg',
    thumbnailUrl: '/media/late-afternoon.jpg',
    takenAt: '2026-03-31T16:30:00',
    sortTime: '2026-03-31T16:30:00',
    width: 1000,
    height: 1400,
  },
];

describe('PhotosPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-31T12:00:00+00:00'));
    mockedFetchPhotos.mockReset();
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the redesigned timeline shell with grouped sections and rail labels', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    const rail = await screen.findByLabelText('Timeline rail');

    expect(within(rail).getByText('2026')).toBeInTheDocument();
    expect(within(rail).getByText('Today')).toBeInTheDocument();
    expect(within(rail).getByText('Mar 28, 2026')).toBeInTheDocument();
    expect(within(rail).getAllByText('New Moments').length).toBeGreaterThanOrEqual(1);

    const todaySection = screen.getByRole('heading', { name: 'Today' }).closest('section');
    const olderSection = screen.getByRole('heading', { name: 'Mar 28, 2026' }).closest('section');

    expect(todaySection).not.toBeNull();
    expect(olderSection).not.toBeNull();
    expect(within(todaySection as HTMLElement).getByText('New Moments')).toBeInTheDocument();
    expect(within(olderSection as HTMLElement).getByText('New Moments')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'fresh.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'late-afternoon.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'older.jpg' })).toBeInTheDocument();
  });

  it('opens the viewer from a redesigned timeline card and persists the selection in the query string', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Open fresh.jpg' }));

    expect(screen.getByRole('dialog', { name: 'Photo viewer' })).toBeInTheDocument();
    expect(window.location.search).toContain('photo=fresh');
  });

  it('navigates the viewer in the same order the timeline renders', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<App />);

    const renderedImageAlts = (await screen.findAllByRole('img'))
      .map((image) => image.getAttribute('alt'))
      .filter((alt): alt is string => alt !== null);

    expect(renderedImageAlts).toEqual(['late-afternoon.jpg', 'fresh.jpg', 'older.jpg']);

    const [firstRendered, secondRendered, thirdRendered] = renderedImageAlts;

    await user.click(screen.getByRole('button', { name: `Open ${secondRendered}` }));

    const viewer = screen.getByRole('dialog', { name: 'Photo viewer' });

    expect(within(viewer).getByRole('img', { name: secondRendered })).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Previous photo' }));
    expect(within(viewer).getByRole('img', { name: firstRendered })).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(within(viewer).getByRole('img', { name: secondRendered })).toBeInTheDocument();

    await user.click(within(viewer).getByRole('button', { name: 'Next photo' }));
    expect(within(viewer).getByRole('img', { name: thirdRendered })).toBeInTheDocument();
  });
});
