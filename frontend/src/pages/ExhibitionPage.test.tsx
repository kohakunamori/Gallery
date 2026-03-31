import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExhibitionPage from './ExhibitionPage';
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

describe('ExhibitionPage', () => {
  beforeEach(() => {
    mockedFetchPhotos.mockReset();
  });

  it('renders the exhibition header, hero, month sections, and photo tiles', async () => {
    mockedFetchPhotos.mockResolvedValue(photos);

    render(<ExhibitionPage />);

    expect(await screen.findByRole('banner')).toHaveTextContent('The Curator');
    expect(screen.getByRole('heading', { name: 'A living exhibition of recent work.' })).toBeInTheDocument();
    expect(screen.getByText('March 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open late-afternoon.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open fresh.jpg' })).toBeInTheDocument();
  });
});
