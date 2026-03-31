import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WaterfallCard } from './WaterfallCard';

const photo = {
  id: 'one',
  filename: 'one.jpg',
  url: '/media/one.jpg',
  thumbnailUrl: '/media/one.jpg',
  takenAt: '2026-04-01T09:00:00Z',
  sortTime: '2026-04-01T09:00:00Z',
  width: 1200,
  height: 800,
};

describe('WaterfallCard', () => {
  it('reserves layout using the photo aspect ratio before the image loads', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    expect(screen.getByTestId('waterfall-card-frame')).toHaveStyle({ aspectRatio: '1200 / 800' });
  });

  it('reveals the image after the image load event fires', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    const image = screen.getByRole('img', { name: 'one.jpg' });

    expect(image).toHaveClass('opacity-0');

    fireEvent.load(image);

    expect(image).toHaveClass('opacity-100');
  });

  it('resets the loaded state when the thumbnail source changes', () => {
    const { rerender } = render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    const firstImage = screen.getByRole('img', { name: 'one.jpg' });

    fireEvent.load(firstImage);

    expect(firstImage).toHaveClass('opacity-100');

    rerender(
      <WaterfallCard
        photo={{
          ...photo,
          id: 'two',
          filename: 'two.jpg',
          url: '/media/two.jpg',
          thumbnailUrl: '/media/two.jpg',
        }}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole('img', { name: 'two.jpg' })).toHaveClass('opacity-0');
  });
});
