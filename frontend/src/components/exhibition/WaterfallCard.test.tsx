import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cachePhotoImageForTest,
  getCachedPhotoImageUrl,
  isImagePreloaded,
  markImageAsPreloadedForTest,
  preloadPhotoImage,
  resetPreloadedImages,
  WaterfallCard,
} from './WaterfallCard';

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

  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    MockIntersectionObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}
  unobserve() {}

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting, target: document.createElement('div') } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

class MockImage {
  static instances: MockImage[] = [];

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';

  constructor() {
    MockImage.instances.push(this);
  }

  triggerLoad() {
    this.onload?.();
  }
}

function getObserverByRootMargin(rootMargin: string) {
  return MockIntersectionObserver.instances.find((instance) => instance.options?.rootMargin === rootMargin);
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  MockImage.instances = [];
  resetPreloadedImages();
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  resetPreloadedImages();
  vi.unstubAllGlobals();
});

describe('WaterfallCard', () => {
  it('uses a larger viewport preload margin for card images', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

    expect(getObserverByRootMargin('1200px 0px')).toBeDefined();
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

  it('reuses a cached image url for the same photo id across sources', () => {
    cachePhotoImageForTest('one', 'https://r2.example.com/one.jpg');

    render(
      <WaterfallCard
        photo={{
          ...photo,
          url: 'https://qiniu.example.com/one.jpg',
          thumbnailUrl: 'https://qiniu.example.com/one.jpg',
        }}
        onOpen={vi.fn()}
      />,
    );

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toHaveAttribute('src', 'https://r2.example.com/one.jpg');
  });

  it('updates the cached image url after the new source finishes loading', () => {
    cachePhotoImageForTest('one', 'https://r2.example.com/one.jpg');

    render(
      <WaterfallCard
        photo={{
          ...photo,
          url: 'https://qiniu.example.com/one.jpg',
          thumbnailUrl: 'https://qiniu.example.com/one.jpg',
        }}
        onOpen={vi.fn()}
      />,
    );

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    fireEvent.load(screen.getByRole('img', { name: 'one.jpg' }));

    expect(getCachedPhotoImageUrl('one')).toBe('https://r2.example.com/one.jpg');
  });

  it('keeps the image mounted after the card leaves the observed range once it has started loading', () => {
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

  it('releases the image only after it leaves the wider release range in memory-saving mode', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} releaseImageOnExit releaseRootMargin="2600px 0px" />);

    const mountObserver = getObserverByRootMargin('1200px 0px');
    const releaseObserver = getObserverByRootMargin('2600px 0px');

    act(() => {
      mountObserver?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();

    act(() => {
      mountObserver?.trigger(false);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();

    act(() => {
      releaseObserver?.trigger(false);
    });

    expect(screen.queryByRole('img', { name: 'one.jpg' })).not.toBeInTheDocument();
  });

  it('uses eager loading without forcing high fetch priority for preloaded cards', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} shouldPreload />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toHaveAttribute('loading', 'eager');
    expect(screen.getByRole('img', { name: 'one.jpg' })).not.toHaveAttribute('fetchpriority');
  });

  it('marks priority images with eager loading and high fetch priority', () => {
    render(<WaterfallCard photo={photo} onOpen={vi.fn()} isPriority />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    const image = screen.getByRole('img', { name: 'one.jpg' });

    expect(image).toHaveAttribute('loading', 'eager');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    expect(image).toHaveAttribute('width', '1200');
    expect(image).toHaveAttribute('height', '800');
    expect(image.className).toContain('transition-[opacity,transform]');
    expect(image.className).not.toContain('filter');
  });

  it('reveals a preloaded image immediately after it mounts', () => {
    markImageAsPreloadedForTest(photo.thumbnailUrl);

    render(<WaterfallCard photo={photo} onOpen={vi.fn()} shouldPreload />);

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(screen.getByRole('img', { name: 'one.jpg' })).toHaveClass('opacity-100');
  });

  it('deduplicates in-flight preloads for the same url', () => {
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);

    const firstSuccess = vi.fn();
    const secondSuccess = vi.fn();

    preloadPhotoImage('one', '/media/one.jpg', firstSuccess);
    preloadPhotoImage('two', '/media/one.jpg', secondSuccess);

    expect(MockImage.instances).toHaveLength(1);

    act(() => {
      MockImage.instances[0]?.triggerLoad();
    });

    expect(firstSuccess).toHaveBeenCalledTimes(1);
    expect(secondSuccess).toHaveBeenCalledTimes(1);
    expect(isImagePreloaded('/media/one.jpg')).toBe(true);
    expect(getCachedPhotoImageUrl('one')).toBe('/media/one.jpg');
    expect(getCachedPhotoImageUrl('two')).toBe('/media/one.jpg');
  });

  it('evicts old preloaded image urls after the cache cap', () => {
    for (let index = 0; index < 801; index += 1) {
      markImageAsPreloadedForTest(`/media/${index}.jpg`);
    }

    expect(isImagePreloaded('/media/0.jpg')).toBe(false);
    expect(isImagePreloaded('/media/800.jpg')).toBe(true);
  });
});
