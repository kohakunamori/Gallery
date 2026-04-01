import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  constructor(public callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}
  unobserve() {}

  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WaterfallCard', () => {
  it('reserves layout using the photo aspect ratio before the image loads', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    expect(screen.getByTestId('waterfall-card-frame')).toHaveStyle({ aspectRatio: '1200 / 800' });
  });

  it('does not mount the image until the observer reports the card is visible', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    expect(screen.queryByRole('img', { name: 'one.jpg' })).not.toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();
  });

  it('reveals the image after the image load event fires', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    const image = screen.getByRole('img', { name: 'one.jpg' });

    expect(image).toHaveClass('opacity-0');

    fireEvent.load(image);

    expect(image).toHaveClass('opacity-100');
  });

  it('keeps a visible thumbnail swap hidden until the new image loads', () => {
    const { rerender } = render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

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

    const secondImage = screen.getByRole('img', { name: 'two.jpg' });

    expect(secondImage).toHaveClass('opacity-0');
  });

  it('keeps the image mounted after it has been revealed once', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(false);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();
  });
});
