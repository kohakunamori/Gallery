import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// jsdom does not implement IntersectionObserver. WaterfallCard / LoadTrigger
// disconnect on unmount; keep a durable stub even when suites call unstubAllGlobals.
class GalleryTestIntersectionObserver {
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  root: Element | Document | null = null;
  rootMargin = '';
  thresholds: ReadonlyArray<number> = [];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '';
    const threshold = options?.threshold;
    this.thresholds = Array.isArray(threshold) ? threshold : [threshold ?? 0];
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function installIntersectionObserverStub() {
  vi.stubGlobal('IntersectionObserver', GalleryTestIntersectionObserver);
}

installIntersectionObserverStub();

afterEach(() => {
  if (typeof globalThis.IntersectionObserver === 'undefined') {
    installIntersectionObserverStub();
  }
});
