# Performance and Loading Polish Design

Date: 2026-04-01
Project: Gallery frontend
Context: follow-up polish pass after the minimal lightbox redesign

## 1. Goal

Refine the current gallery for production use by improving perceived smoothness, media delivery, and memory behavior without changing the single-page waterfall layout or the new minimal lightbox interaction model.

This pass should make the page feel calmer, lighter, and more reliable while preserving the current design direction.

## 2. Explicit Scope Decisions

### In scope
- Show `GALLERY` only when the page is at the top
- Hide `GALLERY` immediately once the user scrolls away from the top
- Add an HTML head favicon
- Make image appearance more elegant by fading in loaded images rather than showing an obvious empty frame first
- Investigate and fix the apparent ordering disruption during incremental waterfall loading
- Add configurable media base URL support so production can serve images from Cloudflare R2
- Improve cache reuse behavior between the waterfall and the lightbox where possible
- Add limited image memory optimization by unloading images that are far from the viewport
- Rebuild the frontend locally after implementation

### Out of scope
- Redesigning the page structure again
- Replacing the current minimal lightbox model
- Replacing month grouping with a different information architecture
- Introducing a full virtualized gallery system
- Building a full R2 upload/sync pipeline inside the app

## 3. Product Direction

This pass is not about adding features. It is about making the current experience feel more polished and less mechanically loaded.

The intended result is:
- less visual noise
- less obvious image popping
- better perceived smoothness during long scrolling
- cleaner production asset delivery
- reduced waste when the lightbox opens after an image was already seen in the wall

## 4. Header Behavior

The `GALLERY` wordmark should only be visible when the page is at the top.

### Intended behavior
- At `scrollY === 0`, show the header normally
- Once the user scrolls away from the top, fade the header out
- When the user returns to the top, fade it back in

### UX rules
- Trigger should be immediate, not delayed until a full viewport has passed
- Hidden state should also disable pointer interaction
- The transition should be subtle rather than abrupt

This keeps the page identity at entry, then gets out of the way once browsing starts.

## 5. Timeline / Ordering Integrity

The user reports that when scrolling, newly loaded images sometimes appear to insert into already loaded content and make the sequence feel wrong.

### Most likely root cause
This is likely a layout-stability problem, not a data-sorting problem:
- the waterfall currently uses CSS columns
- image dimensions resolve after image load
- card heights finalize late
- column flow recomputes, making the visual sequence appear to jump or insert upward

### Required validation
Before changing layout logic, verify:
- the underlying photo order from `fetchPhotos()` is still sorted newest-first
- `slice(0, visibleCount)` is still producing an ordered prefix
- `groupPhotosByMonth()` is not reordering items incorrectly

### Fix direction
Assume data ordering is correct unless proven otherwise. Fix the visual instability by:
- giving each card a stable reserved aspect ratio before image load
- avoiding obvious empty shells that later expand
- only revealing a card once its image has reached a usable loaded state

If data order itself turns out to be wrong, then fix the data flow, but that is the second line of investigation, not the first.

## 6. Image Appearance and Fade-In

The current gallery should avoid showing obvious empty card frames before the image appears.

### Intended behavior
- Reserve card layout size up front using known width/height ratio
- Keep the image container in a visually quiet preloaded state
- Once the image finishes loading, fade in the visible image content
- Hover overlay should not dominate before the image is ready

### Design rule
The transition should feel like the image arrives softly into an already stable layout, not like a box is created and then suddenly populated.

## 7. Memory Optimization

The user wants inactive images to stop consuming unnecessary memory.

### Chosen strategy
Use the moderate strategy:
- keep images near the viewport mounted and visible
- unload images that are far from the viewport
- preserve layout size so the page does not jump when images are unloaded

### Practical interpretation
This should not become full virtualization.

A pragmatic first version is:
- track each card’s distance from the viewport via `IntersectionObserver`
- define a generous “keep alive” margin around the viewport
- when a card is far outside that margin, release the actual `<img>` element or its decoded source from the DOM
- keep a fixed-height visual placeholder that preserves layout continuity
- re-mount the image when the card comes back near the viewport

### Why moderate, not aggressive
The user explicitly chose a balanced version. Images close to the active reading area should remain available for smooth scrolling. Only far-away content should be unloaded.

## 8. Cache Reuse Between Wall and Lightbox

The user wants the lightbox to avoid wasting bandwidth by re-requesting content that the waterfall has already loaded.

### Important constraint
This cannot be absolutely guaranteed by frontend code alone.

Whether the browser reuses cached image data depends on:
- identical final URL
- cache headers from the server or R2 edge
- browser memory pressure and eviction behavior
- whether the wall and lightbox are using the same asset variant

### Design goal
Maximize cache reuse probability.

### Rules
- use one configurable media base URL for both waterfall and lightbox generation
- avoid having the waterfall use one origin and the lightbox another for the same asset family
- keep URL construction stable and deterministic
- ensure production media responses are cacheable

### Practical trade-off
Do not force the waterfall to use full-size originals just to chase perfect reuse. That would hurt initial performance.

Preferred approach:
- keep the current data model
- keep wall and lightbox on the same media origin/base domain
- accept that thumbnail and original image may still be separate requests if they are different assets
- optimize headers and URL consistency rather than pretending full dedupe is always possible

## 9. R2 Media Base URL

The user will upload `storage/photos` to Cloudflare R2 without changing the object path structure.

This means the application only needs to switch the base URL used for generated media links.

### Required behavior
- local/default environment continues to use `/media`
- production can use a custom R2 domain such as `https://img.example.com`
- the object path after the base remains unchanged

### Correct place to implement this
This should be handled in the backend media URL generation layer, not patched in the frontend.

That keeps the frontend simple and makes returned `url` / `thumbnailUrl` already correct for the active environment.

### Configuration direction
Introduce a configurable media base URL value and pass it into app creation.

The backend should then produce either:
- `/media/path/to/file.jpg`
or
- `https://your-r2-domain/path/to/file.jpg`

using the same relative object path.

## 10. favicon

Add a favicon through `frontend/index.html`.

### Requirements
- include a standard `<link rel="icon" ...>` entry in `<head>`
- use an existing project asset if available
- if no final icon asset exists yet, use a temporary placeholder favicon file path that can be swapped later without changing logic

## 11. Implementation Direction by Area

### 11.1 `ExhibitionHeader`
Add top-of-page visibility logic.

Likely approach:
- page-level `isAtTop` state driven by scroll listener or scroll effect
- header receives visible/hidden state as a prop or computes it via a dedicated hook
- hidden state uses opacity transition and disables pointer events

### 11.2 `WaterfallCard`
Add:
- reserved aspect ratio derived from `photo.width` and `photo.height`
- image-loaded state
- fade-in behavior for loaded content
- optional unload/reload control for cards far outside the viewport

### 11.3 `ExhibitionPage`
Potential responsibilities added:
- top-of-page detection state for header visibility
- maintain the current ordered-photo flow
- possibly provide shared context or props for media loading behavior

### 11.4 Backend media URL configuration
Introduce one configurable media base URL input for app creation so local and production media URLs can diverge cleanly.

## 12. Testing Strategy

### Page tests
Add or update coverage for:
- header visible at top
- header hidden after leaving top
- lightbox still opens correctly after polish changes
- incremental loading still reveals ordered images

### Waterfall/image tests
Add or update coverage for:
- card remains layout-stable before image load
- card becomes visible after image load event
- unloading logic only applies when cards are far outside the viewport
- re-entering the keep-alive zone restores the image

### Ordering validation
Add a regression that proves incremental loading appends the next ordered batch and does not alter the logical order of already-visible items.

### Backend tests
Add or update coverage for:
- default media base URL remains `/media`
- configured media base URL produces R2-domain image URLs

## 13. Risks and Controls

### Risk: header hide/show feels jittery
Control: use a simple top/not-top threshold, not a noisy scroll-direction system.

### Risk: fade-in logic causes placeholder flicker
Control: reserve stable height first, then only animate opacity of the loaded image layer.

### Risk: unloading saves memory but causes too many re-requests
Control: only unload far-away images, not nearby ones.

### Risk: R2 base URL change breaks local development
Control: keep `/media` as the default fallback and make R2 opt-in.

### Risk: perceived order still looks wrong with CSS columns
Control: first fix height stabilization and reveal timing. Only escalate to layout-strategy changes if the issue still remains.

## 14. Success Criteria

This optimization pass is successful when:
- `GALLERY` is only visible when the page is at the top
- favicon is present in the document head
- images fade in more gracefully instead of appearing as obvious empty boxes first
- incremental loading no longer gives a strong impression of new images inserting into old content out of order
- media URL generation can switch between local `/media` and an R2 custom domain
- the lightbox and waterfall share a media-origin strategy that improves cache reuse probability
- far-away waterfall images can be unloaded without breaking layout continuity
- the frontend still builds cleanly after the changes
