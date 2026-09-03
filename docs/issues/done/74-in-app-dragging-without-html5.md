# 74 — In-app dragging without HTML5 drag and drop

No behaviour change. Prerequisite for [85](../upcoming/85-drop-files-and-folders.md), which
cannot happen while any drag in the window depends on the webview's own
drag-and-drop.

**The model is already in the tree.** Column reorder has been pointer-event
dragging since phase 20: `columnDrag.ts` separates a click from a drag by a 4px
threshold and hit-tests against header midpoints, on `onPointerDown`. What a row
adds over a header is that the drop target is in another component's subtree,
which is what the design below is about.

## Sites

- **`playlists/drag.ts` → `playlists/trackDrag.ts`.** `TRACK_IDS_MIME`,
  `DragData`, `setTrackIds`, `readTrackIds` and `hasTrackIds` all go: a payload
  held in a module is reachable neither from a text field nor from arbitrary
  text, so the private MIME type has nothing left to guard. `dropIndexFor`
  survives unchanged. `setDragImage` becomes a badge that follows the pointer.
- **`SongRow`** — `draggable` and `onDragStart`/`onDragOver`/`onDrop` become
  `onPointerDown`/`onPointerMove`/`onPointerUp`. `offsetWithin` keeps working:
  it reads `clientY` against the row's own rect, which a `PointerEvent` carries
  the same way.
- **`SongTable`** — `onDragLeave` on `<tbody>` becomes `onPointerLeave`, and it
  owns the edge auto-scroll loop. `dropIndex` stays local state derived into a
  per-row `drop` prop; nothing about the render path changes.
- **`PlaylistSidebar`** — both targets, same shape.
- **`TagEditor`** — one line. `isFileDrag` loses its `hasTrackIds` half, because
  no song drag carries a `DataTransfer` any more. The artwork drop itself stays
  HTML5: it is an *OS* file drop, and it keeps working until 85 flips
  `dragDropEnabled`. Migrating it here breaks it.
- **`useNativeFeel`** is unchanged. Its window-level swallow now guards the
  artwork square alone.

## No pointer capture

`setPointerCapture` retargets every subsequent pointer event to the capturing
element, so a row that captured could never see the sidebar under the pointer —
the drop would have to be resolved by `document.elementFromPoint` and a registry
of targets. Two reasons not to:

- Dragging is **mouse-only** (unchanged, and still a
  [limitation](../../knowledge/limitations.md)). Chromium's implicit pointer
  capture applies to touch and pen; a mouse `pointermove` targets whatever is
  under the pointer, which is exactly the routing HTML5 was providing. Each drop
  target therefore keeps handlers shaped like the ones it has now.
- The source row is virtualized. Capture on an element that unmounts mid-drag is
  released silently, and auto-scrolling far enough unmounts the row the drag
  started on.

Releasing the button outside the window still delivers `pointerup` to the
document, so nothing is needed for that case.

The session lives in `trackDrag.ts` as module state, not in a store: the badge
moves every frame, and `SongRow` subscribes to nothing by design. Targets read
it synchronously in their own handlers — `trackDragIds()` in place of
`readTrackIds(event.dataTransfer)`, and an `isTrackDragging()` guard in place of
`hasTrackIds`.

**Targets must not `stopPropagation`.** A target performs the drop in its
`onPointerUp`; the session's window listener tears the drag down afterwards, on
the same event.

## What the webview was providing for free

- **Recognition.** A press becomes a drag past `DRAG_THRESHOLD_PX`, measured on
  `Math.hypot(dx, dy)` rather than on x alone — a row drag is vertical for a
  reorder and horizontal for the sidebar. Import the constant from
  `columnDrag.ts`; two of them would drift.
- **The click that follows.** `pointerup` precedes `click`, so a recognized drag
  has to swallow it or every reorder also re-selects the row it started on, the
  way `ColumnHeader` swallows the sort. A drag ending on a *different* row is
  already safe: `click` fires on the nearest common ancestor, which is `<tbody>`
  and has no handler.
- **Selection at drag start.** Today's `onDragStart` makes the grabbed row the
  selection if it was outside it, and that decision moves to the moment of
  recognition — not to `pointerdown`, which is still only a click.
- **`draggable` must go, not merely be ignored.** A native `dragstart` fires
  `pointercancel` and kills the pointer stream. No `<img>` is inside a row, and
  `body { user-select: none }` already blocks a selection drag, so removing the
  attribute is the whole of it.
- **The badge.** A `position: fixed` element appended to `body` and moved by
  `transform`, imperatively — as React state it would re-render a subscriber per
  frame. It needs `pointer-events: none`, or it becomes the element under the
  pointer and swallows the drag. `.drag-badge` keeps its looks; the off-screen
  positioning and the `requestAnimationFrame` teardown go, since it is now meant
  to be seen.
- **Cancel routes.** `pointercancel` and Escape, both of which HTML5 handled.
- **Edge auto-scroll**, on `.song-body` only. A band of roughly one row at each
  edge, rate scaling linearly with depth into it, driven by
  `requestAnimationFrame` off the frame delta and applied as `scrollTop +=` —
  which keeps jsdom out of `scrollBy`, which it does not implement. The loop
  must recompute the drop index each frame: a stationary pointer over a
  scrolling virtualized list fires no `pointermove`, and the rows under it
  change anyway. The sidebar gets none — its targets are a short list, and
  scrolling it during a drag is a wheel away.

Not replaced: the copy/move/no-drop cursor. The insertion line, the target
outline and the badge are the feedback, which is the positive-only signal
Explorer gives. Deliberate.

## Tests

No new `src/test/setup.ts` stubs: the design needs neither `elementFromPoint`
nor `scrollBy`, both of which jsdom lacks. `PointerEvent` and the pointer-capture
no-ops are already there for the header drags.

Rewrites, all mechanical apart from the first:

- `SongTable.test.tsx` and `PlaylistSidebar.test.tsx` fabricate incoming drags
  (`trackDrag([9])`) that were never started from the table. A module payload
  has no such shortcut, so each spec begins its drag through the UI — a
  `pointerdown` on a source row past the threshold — behind one helper per file.
  Drop *positions* port as they are: jsdom reports a zero rect, so `clientY`
  remains the offset within the row.
- `drag.test.ts` → `trackDrag.test.ts`. The payload round-trip and the
  malformed-JSON cases go with the MIME type; `dropIndexFor` and the badge stay,
  and recognition, click-swallowing and the cancel routes are new.
- `App.test.tsx` — two `fireEvent.drop` calls and the `TRACK_IDS_MIME` import.
- `TagEditor.test.tsx:316` loses the song-drag half of one assertion.

e2e gets better, but **not through the Actions API, which is not available.**
The driver is an embedded Tauri plugin offering execute and command mocking
only — see `library.test.ts:279`, which dispatches a shift-click for the same
reason. What changes is that a dispatched
`PointerEvent` sequence now drives the real thing: the app's own listeners run,
so hit-testing, the indicators, auto-scroll and the badge are all genuinely
exercised, where a synthesized `DragEvent` could only ever hand a stub
`DataTransfer` to a handler with no OS drag loop behind it. The badge also
becomes photographable, being a DOM element rather than an OS drag image —
worth a `capture` in the new spec.

The Menu key, Alt+Arrow and Delete routes are untouched.

## Docs

- [frontend.md](../../knowledge/frontend.md) — the drag-badge note (built
  off-screen and rasterized: no longer true), and the private-MIME-type note,
  whose remaining half is the tag editor deciding a drag is a file.
- [testing.md](../../knowledge/testing.md) — "OS-level drag gestures" stays
  uncovered; in-app dragging stops being part of that gap.
- [limitations.md](../../knowledge/limitations.md) — "Dragging is mouse-only"
  stands, and is now load-bearing rather than incidental: see the capture
  section above. The `dragDropEnabled` entries belong to 85.
