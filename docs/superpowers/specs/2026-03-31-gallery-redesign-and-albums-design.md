# Gallery Redesign and Albums Design

## Overview
Refactor the current gallery MVP into a Stitch-faithful frontend for Photos Timeline and Photo Viewer, and add a real Albums List page backed by folder-based aggregation on the backend. This round keeps the existing PHP + Slim API and React + Vite + Tailwind stack, but replaces the simplified UI with a componentized implementation that visually tracks the exported Stitch screens much more closely.

## Goals
- Restore the Photos Timeline visual design so it feels materially closer to the exported Stitch screen.
- Restore the Photo Viewer visual design so it matches the exported immersive layout much more closely.
- Add a real Albums List page.
- Generate albums from first-level folders under the photo storage directory.
- Keep the existing timeline and viewer data flow functional while upgrading the presentation layer.

## Non-Goals
- Sharing Center functionality.
- Trash & Recovery functionality.
- Search Results functionality.
- Archive View functionality.
- Albums detail page in this round.
- Favorites, sharing, editing, deleting, or cloud sync as real backend actions.
- Nested album hierarchies beyond first-level folders.

## Scope
### Pages in this round
1. **Photos Timeline**
   - Real data-driven page.
   - Reworked to be visually much closer to the Stitch export.
   - Uses the existing `/api/photos` backend data source.

2. **Photo Viewer**
   - Real data-driven overlay / immersive state.
   - Reworked to be visually much closer to the Stitch export.
   - Uses the current timeline photo list as the backing source.

3. **Albums List**
   - Real data-driven page.
   - Backed by a new `/api/albums` endpoint.
   - Aggregates albums from first-level folders.

### Pages not implemented in this round
- Sharing Center
- Trash & Recovery
- Search Results
- Archive View
- Album detail page

These remain future work.

## Reference Assets
Primary visual references:
- `stitch_exports/10475339810720302491/9c1e443f3d364116867b61ef52dc6a0d.html`
- `stitch_exports/10475339810720302491/a2e6c0d67dc943bba5bf6fbbc16f7c34.html`
- `stitch_exports/10475339810720302491/b59b1097927d45d5a810e0141e0b73c4.html`
- `stitch_exports/10475339810720302491/asset-stub-assets-3d67e6dd2b2a4c1b83546cbfc26bf391-1774878367834.design-system.json`

Secondary future references only:
- Sharing Center
- Trash & Recovery
- Search Results
- Archive View

## Frontend Strategy
This round does **not** continue patching the simplified MVP visuals. Instead, it keeps the current working data flow and route behavior, but rebuilds the visible UI structure so the implementation follows the Stitch assets much more closely.

### Design direction
- Keep the left navigation shell and top navigation bar.
- Restore the larger editorial date headings and more expressive section hierarchy in the timeline.
- Restore the lighter, glass-like top bar treatment.
- Restore the mixed-feel gallery card presentation and richer hover overlays.
- Restore the immersive black-background viewer, top controls, side info panel, and floating action bar.
- Add an Albums page that fits the same design language.

### UI implementation principle
- Use the Stitch exports as strong visual references.
- Keep only the interactions that matter for current functionality.
- Non-functional viewer controls may exist visually but should remain inert rather than pretending to work.
- Prioritize faithful layout, spacing, hierarchy, surface treatment, and motion over recreating every demo-only interaction.

## Frontend Architecture
### Layout layer
- `AppShell`
- `Sidebar`
- `Topbar`

### Photos timeline layer
- `TimelinePage`
- `TimelineDateSection`
- `TimelinePhotoCard`
- `TimelineRail`

### Viewer layer
- `ViewerOverlay`
- `ViewerTopBar`
- `ViewerSidePanel`
- `ViewerActionBar`

### Albums layer
- `AlbumsPage`
- `AlbumCard`

### Data layer
- `photos.ts`
- `albums.ts`

This decomposition keeps layout, timeline, viewer, and album concerns separate while still allowing shared styling and navigation state.

## Routing
Recommended route structure for this round:
- `/` or `/photos` → Photos Timeline
- `/?photo=<id>` or `/photos?photo=<id>` → Photo Viewer overlay state
- `/albums` → Albums List

### Explicitly deferred
- `/albums/:albumId` is deferred to a later round.

## Backend Scope
### Existing endpoint retained
- `GET /api/photos`

### New endpoint added
- `GET /api/albums`

The backend remains file-system-based and does not introduce a database in this round.

## Storage Model
Current storage root remains:
- `storage/photos/`

### Example structure
```text
storage/photos/
  root-a.jpg
  root-b.png
  travel/
    1.jpg
    2.jpg
  family/
    a.jpg
```

## Photo Scanning Rules
The backend scanner must evolve from single-level scanning to a structure-aware scan.

### Timeline data rules
Timeline includes:
- all supported images in the storage root
- all supported images in first-level child folders

Timeline remains sorted by `sortTime` descending, where:
1. EXIF capture time is preferred
2. file modification time is the fallback

### Supported formats
Continue supporting:
- jpg
- jpeg
- png
- webp

### Folder depth rule
Only first-level folders participate in Albums generation in this round.
Nested folder hierarchies are out of scope.

## Albums Aggregation Rules
Albums are generated from first-level subfolders under `storage/photos/`.

### For each album folder
- `name` = folder name
- `id` = stable identifier derived from folder name/path
- `photoCount` = number of supported images in that folder
- `coverUrl` = newest image in that folder
- `latestSortTime` = newest image sort time in that folder

### Exclusions
- Root-level images do not become albums.
- Empty folders do not produce albums.
- Nested subfolders do not create nested albums.
- No manual cover overrides in this round.

## API Design
### `GET /api/photos`
Remains the existing normalized photo list endpoint.

### `GET /api/albums`
Returns the folder-derived album list.

Example response:
```json
{
  "items": [
    {
      "id": "travel",
      "name": "travel",
      "coverUrl": "/media/travel-cover.jpg",
      "photoCount": 42,
      "latestSortTime": "2026-03-31T08:30:00+00:00"
    }
  ]
}
```

### Album field definitions
- `id`: stable album identifier
- `name`: folder name used as display label in MVP
- `coverUrl`: URL for the newest image in the folder
- `photoCount`: supported image count within the folder
- `latestSortTime`: newest photo time used to sort albums descending

## Timeline Design Requirements
The rebuilt timeline should align much more closely with the Stitch reference in these dimensions:
- editorial-size date headings
- stronger asymmetry and spacing
- softer surface separation
- glass-like top nav treatment
- richer photo card hover state
- stronger sense of a curated visual gallery
- optional right-side time rail / date navigation treatment if practical within scope

The implementation does not need to duplicate every static decorative element verbatim, but the overall feel should no longer read as a generic simplified gallery.

## Viewer Design Requirements
The rebuilt viewer should align much more closely with the Stitch reference in these dimensions:
- immersive dark background
- top overlay toolbar
- left/right navigation affordances
- bottom floating action bar
- right-side info panel
- more cinematic, less modal-like presentation

### Functional interactions required
- close
- previous / next
- preservation of current image selection

### Visual-only controls allowed
Controls such as favorite, share, edit, delete, save, cloud-sync, and info toggles may be present visually but do not need to be wired to backend functionality in this round.

## Albums Design Requirements
The Albums List page should align with the Stitch reference and share the same shell as Photos:
- same sidebar
- same top bar language
- album cards with cover image, name, and count
- hover feedback matching the visual system
- albums sorted by newest content first

## Navigation Behavior
### Sidebar
- Photos: active on timeline route
- Albums: active on albums route
- Sharing / Archive / Trash: remain visible but disabled

### Topbar
The topbar should be visually aligned with Stitch, but search does not need real functionality in this round.

## Testing Expectations
### Backend
Add tests for:
- first-level folder album aggregation
- album sorting by newest item
- exclusion of empty folders
- continued timeline sorting behavior across root and album-folder images

### Frontend
Add tests for:
- route/state switching between Photos and Albums
- album list rendering from `/api/albums`
- viewer still opening from timeline items
- sidebar active state for Photos and Albums

## Acceptance Criteria
### Visual acceptance
- Timeline is materially closer to the Stitch reference than the current MVP.
- Viewer is materially closer to the Stitch reference than the current MVP.
- Albums page matches the same design language and no longer appears as an unstyled add-on.

### Functional acceptance
- `/api/photos` still returns usable timeline data.
- `/api/albums` returns folder-derived album data.
- Albums route is navigable from the sidebar.
- Clicking a photo opens the redesigned viewer.
- Viewer previous/next navigation still works.

### Data acceptance
- root-level images appear in Timeline
- first-level folder images appear in Timeline
- first-level folders produce albums
- album cover is the newest image in the folder
- albums are ordered by newest content first

## Future Expansion
Deferred to later rounds:
- album detail page
- search functionality
- archive functionality
- sharing functionality
- trash / recovery functionality
- nested album structures
- custom album metadata
