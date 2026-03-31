# Gallery Display System Design

## Overview
Build a Stitch-inspired gallery display system that shows server-stored images in a time-descending timeline. The system uses a React + Vite + Tailwind frontend and a PHP 8.2+ + Slim 4 backend. The backend scans a server image folder at request time, extracts EXIF capture time when available, falls back to file modification time, sorts newest to oldest, and returns structured JSON to the frontend. The frontend renders a Photos timeline and a Photo Viewer, while keeping the full navigation shell visible with non-implemented sections disabled.

## Goals
- Display images from a server folder without manually maintaining JSON files.
- Automatically show newly uploaded images after page refresh.
- Match the visual direction of the exported Stitch screens for Photos Timeline and Photo Viewer.
- Keep the full sidebar navigation structure, with non-MVP areas visible but disabled.
- Keep the backend thin and file-system-based for the first release.

## Non-Goals
- Uploading images from the web UI.
- Authentication or permissions.
- Real albums, sharing, archive, trash, or search functionality.
- Real-time push updates while the page stays open.
- Database-backed indexing.
- Pre-generated thumbnails in the first release.

## MVP Scope
### Implemented pages
1. **Photos Timeline**
   - Main page.
   - Fetches photo data from the backend.
   - Displays images grouped by date.
   - Sorted from newest to oldest.
   - Uses Stitch-inspired hover behavior and spacing.

2. **Photo Viewer**
   - Opens from the timeline when a photo is clicked.
   - Supports previous / next navigation.
   - Supports close and return to the timeline.
   - Preserves the timeline browsing flow as much as possible.

### Navigation shell
The sidebar keeps the Stitch-inspired structure:
- Photos
- Albums
- Sharing
- Archive
- Trash

Only **Photos** is interactive in MVP. The others remain visible but disabled / grayed out.

## Reference Screens
Primary UI references:
- `stitch_exports/10475339810720302491/9c1e443f3d364116867b61ef52dc6a0d.html`
- `stitch_exports/10475339810720302491/a2e6c0d67dc943bba5bf6fbbc16f7c34.html`
- `stitch_exports/10475339810720302491/asset-stub-assets-3d67e6dd2b2a4c1b83546cbfc26bf391-1774878367834.design-system.json`

Secondary future references only:
- Albums List
- Sharing Center
- Trash & Recovery
- Search Results
- Archive View

## Architecture
### Frontend
- **Stack:** React + Vite + Tailwind
- **Responsibilities:**
  - Request photo data from the backend.
  - Group photos by date for the timeline.
  - Render the Stitch-inspired layout.
  - Open and manage the photo viewer state.
  - Keep disabled navigation items visible.

Suggested routes/state:
- `/` → timeline page
- Viewer can be implemented as a modal/overlay on top of the timeline, using either in-memory state or a query parameter such as `?photo=<id>`.

### Backend
- **Stack:** PHP 8.2+ + Slim 4
- **Responsibilities:**
  - Scan the configured photo directory at request time.
  - Filter supported image files.
  - Read EXIF metadata when available.
  - Fall back to file modification time when EXIF capture time is unavailable.
  - Build a normalized photo response list.
  - Sort items newest to oldest.
  - Return JSON to the frontend.
  - Expose image files through a static `/media/...` path.

## Data Source and Sorting Rules
### Image source
The source of truth is a server-side photo directory, e.g.:
- `storage/photos/`

The user manually uploads or copies image files into this folder outside the web UI.

### Supported formats
MVP should support common web-friendly image formats:
- jpg
- jpeg
- png
- webp

Other formats can be ignored in MVP.

### Sorting rule
For each image:
1. Try to read EXIF capture time.
2. If EXIF capture time exists, use it as both `takenAt` and the primary source for `sortTime`.
3. If EXIF capture time does not exist, set `takenAt` to `null` and use the file modification time as `sortTime`.
4. Sort all photos by `sortTime` descending.

## API Design
### `GET /api/photos`
Returns the normalized, already-sorted photo list.

Example response:
```json
{
  "items": [
    {
      "id": "20260331_abc123",
      "filename": "IMG_1024.JPG",
      "url": "/media/IMG_1024.JPG",
      "thumbnailUrl": "/media/IMG_1024.JPG",
      "takenAt": "2026-03-30T18:25:11+08:00",
      "sortTime": "2026-03-30T18:25:11+08:00",
      "width": 4032,
      "height": 3024
    }
  ]
}
```

### Field definitions
- `id`: Stable identifier derived from path and file state.
- `filename`: Original file name.
- `url`: Public media URL.
- `thumbnailUrl`: In MVP, may equal `url`.
- `takenAt`: EXIF capture time or `null`.
- `sortTime`: Effective timeline sort time.
- `width`: Image width if readable.
- `height`: Image height if readable.

## Backend Structure
Suggested structure:
```text
backend/
  public/
    index.php
  src/
    Action/
      GetPhotosAction.php
    Service/
      PhotoScanner.php
      PhotoMetadataReader.php
      PhotoIndexService.php
    Support/
  composer.json
frontend/
  src/
  public/
  package.json
storage/
  photos/
```

### Service responsibilities
- **PhotoScanner**
  - Recursively or non-recursively scans the configured photo folder.
  - Filters only supported image files.

- **PhotoMetadataReader**
  - Reads EXIF metadata when possible.
  - Reads width/height.
  - Returns `takenAt` when available.

- **PhotoIndexService**
  - Builds the normalized photo records.
  - Calculates `sortTime`.
  - Sorts descending.
  - Returns the final collection for the API.

- **GetPhotosAction**
  - Handles the Slim route.
  - Returns JSON.

## Frontend Structure
Suggested structure:
```text
frontend/src/
  components/
    layout/
    timeline/
    viewer/
  pages/
    PhotosPage.tsx
  services/
    photos.ts
  types/
  utils/
```

### Core components
- `Sidebar`
- `Topbar`
- `TimelineSection`
- `PhotoCard`
- `PhotoViewerModal`

## Timeline Behavior
- Request `/api/photos` on page load.
- Group photos into human-readable date buckets.
- Show newest content first, from top to bottom.
- Use a Stitch-inspired editorial hierarchy and card hover states.
- Use lazy loading for images.

## Viewer Behavior
- Opens when a timeline photo is clicked.
- Uses the currently loaded timeline list as the viewer source.
- Supports previous and next navigation.
- Closes back to the timeline.
- Should preserve browsing continuity; using an overlay/modal is preferred over a fully separate page for MVP.

## Performance Strategy
Because the backend scans the directory at request time, MVP should include a short-lived server-side cache.

### Recommended cache behavior
- Cache the normalized `/api/photos` result for 10–30 seconds using a simple file cache.
- After cache expiry, rebuild from the directory scan.
- This preserves the “new files appear after refresh” behavior while avoiding repeated full rescans on every request.

### Initial optimization boundaries
Do in MVP:
- Filter only image files.
- Fail open on EXIF reads by falling back to file modification time.
- Keep response already sorted.
- Use lazy image loading in the frontend.

Do not do in MVP:
- Database indexing.
- WebSocket push updates.
- Thumbnail generation pipelines.
- Full pagination unless image volume makes it necessary.

## Visual Design Notes
Use the exported Stitch assets as the source for:
- Typography feel
- Sidebar layout
- Top navigation treatment
- Photo grid spacing
- Hover overlays
- Viewer mood and control placement

Maintain the high-level design language from the exported design system:
- soft minimalism
- editorial scale contrast
- tonal surfaces instead of heavy borders
- breathable spacing
- subtle hover depth

## Error Handling
### Backend
- Ignore unsupported file types.
- Skip files that cannot be read safely.
- If EXIF is unavailable, continue with file modification time.
- If dimensions cannot be read, return `null` or omit only if the frontend can safely handle it; prefer explicit nullable fields.

### Frontend
- Show a lightweight empty state if no photos are returned.
- Show a lightweight error state if `/api/photos` fails.
- Non-implemented sidebar items must not navigate.

## Acceptance Criteria
### Backend
- Adding a new image file to the server photo directory causes it to appear after page refresh.
- `/api/photos` returns photos sorted by `sortTime` descending.
- Images without EXIF still appear correctly.
- Non-image files do not appear in the response.

### Frontend
- Timeline visual style clearly follows the Stitch reference.
- Photos are grouped by date.
- Clicking a photo opens the viewer.
- Viewer supports previous/next navigation.
- Closing the viewer returns the user to the timeline flow.
- Sidebar keeps full structure while disabling non-MVP sections.

### User workflow
- The user only needs to place files into the configured server folder.
- No manual JSON editing is required.
- Refreshing the page is enough to see new photos.

## Future Expansion
The following can be added later without changing the MVP goal:
- Real albums generated from folders or rules
- Search
- Archive
- Trash / recovery
- Sharing views
- Thumbnail generation
- Pagination / infinite scrolling
- Real-time updates
- Database indexing if scale eventually requires it
