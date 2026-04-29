import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoadTrigger } from './LoadTrigger';

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
    this.callback([{ isIntersecting } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoadTrigger', () => {
  it('does not load again when only callback identity changes while intersecting', () => {
    const firstLoadMore = vi.fn();
    const secondLoadMore = vi.fn();
    const { rerender } = render(
      <LoadTrigger disabled={false} isComplete={false} onLoadMore={firstLoadMore} resetKey={0} />,
    );

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(firstLoadMore).toHaveBeenCalledTimes(1);

    rerender(<LoadTrigger disabled={false} isComplete={false} onLoadMore={secondLoadMore} resetKey={0} />);

    expect(secondLoadMore).not.toHaveBeenCalled();
  });

  it('re-arms loading when resetKey changes while still intersecting', () => {
    const loadMore = vi.fn();
    const { rerender } = render(
      <LoadTrigger disabled={false} isComplete={false} onLoadMore={loadMore} resetKey={0} />,
    );

    act(() => {
      MockIntersectionObserver.instances[0]?.trigger(true);
    });

    expect(loadMore).toHaveBeenCalledTimes(1);

    rerender(<LoadTrigger disabled={false} isComplete={false} onLoadMore={loadMore} resetKey={1} />);

    expect(loadMore).toHaveBeenCalledTimes(2);
  });
});
