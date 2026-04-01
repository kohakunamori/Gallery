# Performance and Loading Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the current gallery by hiding the header off-top, adding favicon and image fade-in behavior, stabilizing waterfall loading order, adding configurable R2 media base URLs, and unloading far-away images to reduce memory usage.

**Architecture:** Keep the single-page exhibition and minimal lightbox intact, but improve the shell and media pipeline around them. The frontend will gain top-of-page visibility state, stable image placeholders, fade-in and unload behavior, and stronger regression coverage; the backend will gain a configurable media base URL so local `/media` and production R2 domains share one URL-generation path.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Tailwind CSS, PHP 8.2+, Slim 4

---

## File Structure

### Files to modify
- `frontend/index.html` — add favicon link in document head
- `frontend/src/components/exhibition/ExhibitionHeader.tsx` — add visible/hidden behavior driven by top-of-page state
- `frontend/src/components/exhibition/WaterfallCard.tsx` — add reserved aspect ratio, image load fade-in, and far-away image unload/reload behavior
- `frontend/src/pages/ExhibitionPage.tsx` — own top-of-page visibility state and pass it to header; preserve ordered waterfall flow
- `frontend/src/pages/ExhibitionPage.test.tsx` — add header visibility and ordered incremental loading regressions
- `backend/public/index.php` — pass a configurable media base URL into app creation instead of hardcoding `/media`
- `backend/src/createApp.php` — keep the current signature contract intact while supporting the configurable media base URL path end-to-end
- `backend/tests/Action/GetPhotosActionTest.php` or service-level backend tests that cover generated media URLs — update to verify local and configured URL base behavior if needed

### New files
- `frontend/src/components/exhibition/WaterfallCard.test.tsx` — focused tests for reserved aspect ratio, fade-in, and unload/reload behavior
- `frontend/public/favicon.ico` — project favicon placeholder if no existing icon asset is available

### Files expected to remain unchanged
- `frontend/src/components/viewer/PhotoViewerModal.tsx` — keep the current minimal lightbox behavior
- `frontend/src/components/exhibition/ExhibitionSection.tsx` — keep month separators
- `frontend/src/components/exhibition/WaterfallGallery.tsx` — keep columns-based gallery structure
- `frontend/src/utils/groupPhotosByMonth.ts` — preserve ordering logic unless tests prove data ordering is wrong
- `frontend/src/services/photos.ts` — API contract remains `/api/photos`

---

### Task 1: Add top-of-page header visibility and favicon

**Files:**
- Create: `frontend/public/favicon.ico`
- Modify: `frontend/index.html`
- Modify: `frontend/src/components/exhibition/ExhibitionHeader.tsx`
- Modify: `frontend/src/pages/ExhibitionPage.tsx`
- Modify: `frontend/src/pages/ExhibitionPage.test.tsx`

- [ ] **Step 1: Add failing page tests for header visibility**

Add these tests to `frontend/src/pages/ExhibitionPage.test.tsx`:

```ts
it('shows the Gallery header when the page is at the top', async () => {
  mockedFetchPhotos.mockResolvedValue(photos);

  render(<ExhibitionPage />);

  const banner = await screen.findByRole('banner');
  expect(banner).toHaveTextContent('Gallery');
  expect(banner).not.toHaveClass('opacity-0');
});

it('hides the Gallery header after leaving the top of the page', async () => {
  mockedFetchPhotos.mockResolvedValue(photos);

  render(<ExhibitionPage />);

  const banner = await screen.findByRole('banner');

  Object.defineProperty(window, 'scrollY', {
    writable: true,
    configurable: true,
    value: 32,
  });

  window.dispatchEvent(new Event('scroll'));

  expect(banner).toHaveClass('opacity-0');
  expect(banner).toHaveClass('pointer-events-none');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/pages/ExhibitionPage.test.tsx`
Expected: FAIL because the header component has no visibility state or hidden classes.

- [ ] **Step 3: Add the favicon file**

Create `frontend/public/favicon.ico` as the project favicon placeholder. Use the existing project-provided icon file if available; otherwise add a temporary favicon asset at this exact path so `index.html` can reference it.

- [ ] **Step 4: Update `frontend/index.html` to reference the favicon**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gallery Timeline</title>
    <link rel="icon" href="/favicon.ico" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Update `frontend/src/components/exhibition/ExhibitionHeader.tsx` to accept a top-state prop**

```tsx
type ExhibitionHeaderProps = {
  isAtTop: boolean;
};

export function ExhibitionHeader({ isAtTop }: ExhibitionHeaderProps) {
  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 flex justify-center px-4 py-6 transition-opacity duration-300 md:px-8 ${
        isAtTop ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      role="banner"
    >
      <div className="rounded-full bg-surface/80 px-5 py-3 backdrop-blur-xl">
        <p className="font-headline text-sm font-medium uppercase tracking-[0.28em] text-on-surface">Gallery</p>
      </div>
    </header>
  );
}
```

- [ ] **Step 6: Update `frontend/src/pages/ExhibitionPage.tsx` to own top-of-page state**

Add state and scroll effect near the top of the component:

```tsx
const [isAtTop, setIsAtTop] = useState(true);

useEffect(() => {
  const handleScroll = () => {
    setIsAtTop(window.scrollY === 0);
  };

  handleScroll();
  window.addEventListener('scroll', handleScroll, { passive: true });

  return () => {
    window.removeEventListener('scroll', handleScroll);
  };
}, []);
```

Then update the header usage:

```tsx
<ExhibitionHeader isAtTop={isAtTop} />
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/pages/ExhibitionPage.test.tsx`
Expected: PASS with the new header visibility tests green.

- [ ] **Step 8: Commit**

```bash
git add frontend/public/favicon.ico frontend/index.html frontend/src/components/exhibition/ExhibitionHeader.tsx frontend/src/pages/ExhibitionPage.tsx frontend/src/pages/ExhibitionPage.test.tsx
git commit -m "feat: add top-aware header and favicon"
```

### Task 2: Stabilize waterfall cards with reserved aspect ratio and fade-in loading

**Files:**
- Create: `frontend/src/components/exhibition/WaterfallCard.test.tsx`
- Modify: `frontend/src/components/exhibition/WaterfallCard.tsx`

- [ ] **Step 1: Write failing tests for aspect ratio and fade-in**

Create `frontend/src/components/exhibition/WaterfallCard.test.tsx`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/components/exhibition/WaterfallCard.test.tsx`
Expected: FAIL because the frame has no explicit aspect ratio data-testid and the image has no load-state classes.

- [ ] **Step 3: Implement reserved aspect ratio and fade-in in `WaterfallCard.tsx`**

Replace the component body with:

```tsx
import { useMemo, useState } from 'react';
import type { Photo } from '../../types/photo';

type WaterfallCardProps = {
  photo: Photo;
  onOpen: (photoId: string) => void;
};

export function WaterfallCard({ photo, onOpen }: WaterfallCardProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const aspectRatio = useMemo(() => {
    if (photo.width !== null && photo.height !== null && photo.width > 0 && photo.height > 0) {
      return `${photo.width} / ${photo.height}`;
    }

    return '4 / 3';
  }, [photo.height, photo.width]);

  return (
    <button
      type="button"
      aria-label={`Open ${photo.filename}`}
      onClick={() => onOpen(photo.id)}
      className="group mb-2 block w-full overflow-hidden rounded-xl bg-surface-container-low text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 [break-inside:avoid]"
    >
      <div className="relative overflow-hidden" data-testid="waterfall-card-frame" style={{ aspectRatio }}>
        <img
          src={photo.thumbnailUrl}
          alt={photo.filename}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={`block h-full w-full object-cover transition-all duration-500 ${
            isLoaded ? 'opacity-100 group-hover:scale-[1.03]' : 'opacity-0'
          }`}
        />
        <div className="absolute inset-0 flex items-end bg-black/10 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white">View details</span>
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/components/exhibition/WaterfallCard.test.tsx`
Expected: PASS with 2 tests passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/exhibition/WaterfallCard.tsx frontend/src/components/exhibition/WaterfallCard.test.tsx
git commit -m "feat: add stable waterfall image loading"
```

### Task 3: Add far-away image unload behavior without breaking layout continuity

**Files:**
- Modify: `frontend/src/components/exhibition/WaterfallCard.tsx`
- Modify: `frontend/src/components/exhibition/WaterfallCard.test.tsx`

- [ ] **Step 1: Extend tests for unload/reload behavior**

Append this test support and test to `frontend/src/components/exhibition/WaterfallCard.test.tsx`:

```ts
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

it('unloads the image when it is far outside the viewport and restores it when it comes back', () => {
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

  render(<WaterfallCard photo={photo} onOpen={vi.fn()} />);

  expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();

  MockIntersectionObserver.instances[0]?.trigger(false);
  expect(screen.queryByRole('img', { name: 'one.jpg' })).not.toBeInTheDocument();

  MockIntersectionObserver.instances[0]?.trigger(true);
  expect(screen.getByRole('img', { name: 'one.jpg' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/components/exhibition/WaterfallCard.test.tsx`
Expected: FAIL because the card currently never unmounts the image based on intersection state.

- [ ] **Step 3: Add moderate unload behavior in `WaterfallCard.tsx`**

Update the component to track near-viewport state using `IntersectionObserver` with a generous root margin and only render the `<img>` element when near the viewport.

Add imports and refs/state:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';

const cardRef = useRef<HTMLDivElement | null>(null);
const [isNearViewport, setIsNearViewport] = useState(true);
```

Add effect:

```tsx
useEffect(() => {
  if (cardRef.current === null) {
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      setIsNearViewport(entry?.isIntersecting ?? false);
    },
    { rootMargin: '1200px 0px' },
  );

  observer.observe(cardRef.current);

  return () => observer.disconnect();
}, []);
```

Use the ref on the frame and conditionally render the image:

```tsx
<div ref={cardRef} className="relative overflow-hidden" data-testid="waterfall-card-frame" style={{ aspectRatio }}>
  {isNearViewport && (
    <img
      src={photo.thumbnailUrl}
      alt={photo.filename}
      loading="lazy"
      onLoad={() => setIsLoaded(true)}
      className={`block h-full w-full object-cover transition-all duration-500 ${
        isLoaded ? 'opacity-100 group-hover:scale-[1.03]' : 'opacity-0'
      }`}
    />
  )}
  <div className="absolute inset-0 flex items-end bg-black/10 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
    <span className="text-[10px] font-medium uppercase tracking-[0.24em] text-white">View details</span>
  </div>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test -- src/components/exhibition/WaterfallCard.test.tsx`
Expected: PASS with unload/reload coverage green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/exhibition/WaterfallCard.tsx frontend/src/components/exhibition/WaterfallCard.test.tsx
git commit -m "feat: unload far-away waterfall images"
```

### Task 4: Add configurable media base URLs for local `/media` and production R2

**Files:**
- Modify: `backend/public/index.php`
- Modify: `backend/tests/Action/GetPhotosActionTest.php`

- [ ] **Step 1: Add a failing backend test for configured media base URLs**

In `backend/tests/Action/GetPhotosActionTest.php`, add a test that creates the app with a custom media base URL and expects returned photo URLs to begin with that custom domain.

Use this test body:

```php
public function testReturnsConfiguredMediaBaseUrl(): void
{
    $photosDir = dirname(__DIR__, 3) . '/storage/photos';
    $cacheDir = dirname(__DIR__, 2) . '/var/cache/test-configured-media';
    @mkdir($cacheDir, 0777, true);

    $app = createApp(
        $photosDir,
        'https://img.example.com',
        new \Gallery\Service\FilePhotoCache($cacheDir),
        true,
    );

    $request = (new \Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest('GET', '/api/photos');
    $response = $app->handle($request);
    $payload = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);

    self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['url']);
    self::assertStringStartsWith('https://img.example.com/', $payload['items'][0]['thumbnailUrl']);
}
```

- [ ] **Step 2: Run test to verify it fails or exposes missing coverage**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/backend && phpunit tests/Action/GetPhotosActionTest.php`
Expected: FAIL until the current app bootstrap is verified against the configured media base expectations.

- [ ] **Step 3: Make `backend/public/index.php` use an environment-controlled media base URL**

Replace the hardcoded `'/media'` with:

```php
$mediaBaseUrl = getenv('GALLERY_MEDIA_BASE_URL');
if ($mediaBaseUrl === false || $mediaBaseUrl === '') {
    $mediaBaseUrl = '/media';
}

$app = createApp(
    dirname(__DIR__, 2) . '/storage/photos',
    $mediaBaseUrl,
    new FilePhotoCache(dirname(__DIR__) . '/var/cache'),
);
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/backend && phpunit tests/Action/GetPhotosActionTest.php`
Expected: PASS with both local and configured-base cases covered.

- [ ] **Step 5: Commit**

```bash
git add backend/public/index.php backend/tests/Action/GetPhotosActionTest.php
git commit -m "feat: support configurable media base urls"
```

### Task 5: Run full verification and rebuild frontend locally

**Files:**
- Test: `frontend/src/**/*.test.tsx`
- Test: `frontend/src/**/*.test.ts`
- Test: `backend/tests/**/*.php`

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm test`
Expected: PASS with all frontend tests green.

- [ ] **Step 2: Run the backend test suite**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/backend && phpunit`
Expected: PASS with backend tests green.

- [ ] **Step 3: Rebuild the frontend locally**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm run build`
Expected: PASS with Vite build output and updated `dist` assets.

- [ ] **Step 4: Start the frontend dev server for manual checking**

Run: `cd C:/Users/万华镜/Desktop/Project/Gallery/frontend && npm run dev`
Expected: local Vite URL printed.

Manual verification checklist:

```text
- GALLERY is visible only at the top and fades out after scrolling
- favicon appears in the browser tab
- waterfall cards reserve space and fade in after image load
- incremental loading no longer gives a strong impression of out-of-order insertion
- opening the lightbox still works from waterfall cards
- local image URLs still work with /media
- configured R2 base URL logic is covered by backend tests
- far-away images can be unloaded without collapsing layout
```

- [ ] **Step 5: Commit only if verification required code changes**

```bash
git add frontend backend
git commit -m "test: verify performance and loading polish"
```

- [ ] **Step 6: Prepare handoff note**

```text
Document the final state with:
- header top-only visibility
- favicon added
- image fade-in and reserved aspect ratio
- far-away image unload behavior
- configurable R2 media base URL
- frontend tests run
- backend tests run
- frontend rebuilt locally
```
