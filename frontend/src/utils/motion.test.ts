import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScrollBehavior, prefersReducedMotion } from './motion';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('motion helpers', () => {
  it('reports reduced motion from matchMedia', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    expect(prefersReducedMotion()).toBe(true);
    expect(getScrollBehavior()).toBe('auto');
  });

  it('keeps smooth scrolling when reduced motion is off', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    expect(prefersReducedMotion()).toBe(false);
    expect(getScrollBehavior()).toBe('smooth');
  });
});
