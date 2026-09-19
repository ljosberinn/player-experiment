# 85a — The window takes OS drops

Flipping `dragDropEnabled` and keeping everything that already works, working.
The artwork drop moves from an HTML5 handler to the native event on the same
day the flag turns it off, and [85b](../upcoming/85b-drop-files-and-folders.md) is what
then does something with a dropped folder.

Reopens [15, cut](15-ingest-ergonomics-cut.md). **Tauri is not what
changed** — [74](74-in-app-dragging-without-html5.md) is. Verified against
wry 0.55.1 under tauri 2.11.5 (`src/webview2/drag_drop.rs`):

- `with_drag_drop_handler` is still **builder-only**. There is no
  `set_drag_drop_enabled`.
- "Return `true` in the callback to block the OS' default behavior" is not
  implemented on Windows: `DragEnter`, `DragOver`, `DragLeave` and `Drop` all
  **discard the listener's return value**.
- The mechanism is `RevokeDragDrop` on every WebView2 child HWND, which
  *removes* the webview's drop target rather than intercepting it.
- `DragEnter` answers `DROPEFFECT_COPY` for any drag that carries files, and
  `DragOver` repeats it. **The cursor says "copy" over the whole window.**

So: `dragDropEnabled` to `true` in `tauri.conf.json`, and `onDragDropEvent`
carries real paths.

## What stops working in the same moment

- **`.tag-cover`'s `onDragOver`/`onDrop` and `isFileDrag`.** No `dragover` or
  `drop` reaches the page any more. The artwork drop arrives by the other route
  in the same commit.
- **`useNativeFeel`'s window-level drag swallow**, and the hazard it guarded:
  with the drop target revoked, WebView2 never sees a drop to open.
- **The no-drop cursor outside the square**, which the swallow's
  `dropEffect = "none"` provided. wry forces "copy" everywhere, so the only
  honest signal left is the target's own: **the block outlines while a file
  hovers it**, the way `.sidebar-row.drop-target` does. The one visible change.

## One listener, routed by coordinates

`getCurrentWebview().onDragDropEvent`. The payload is `enter` (paths and a
`PhysicalPosition`), `over` (a position), `drop` (both) and `leave` (nothing).

- **Physical pixels, so divide by `window.devicePixelRatio`.** Webview zoom is
  folded into `devicePixelRatio` by Chromium, so the one division is right at
  any DPI and any zoom.
- **`over` fires continuously.** Nothing it produces reaches React state per
  event; the hover flag flips only when the hit changes. The listener mounts in
  its own component beside `TaskProgress`, rendering nothing.

**The target registers itself while it is mounted**, and the listener
hit-tests the registered element's rect. Not `document.elementFromPoint`: it
returns a child rather than the target, and jsdom lacks it. One target today, so
the registry is a single module-level slot.

The target is the whole `.tag-cover` block — preview and buttons — as the HTML5
handlers were, not the 120px square. It takes `paths[0]`, as it took
`files[0]`, and the backend's sniff stays the authority on what is artwork.

`TagEditor` keeps owning `rejected`. `onDropCover` takes a path instead of a
`File`, and `App` wires it to `stagePickedCover`.

## The raw-bytes route goes with it

`stage_picked_cover` handles both. `stage_dropped_cover` leaves
`commands/mod.rs`, the `invoke_handler` list, `ipc/index.ts` and its tests.

The [gotchas](../../knowledge/gotchas.md) entry on all-or-nothing raw IPC
payloads loses its only caller. **Keep it**, with a generic example.

## Docs

- [gotchas](../../knowledge/gotchas.md), [limitations](../../knowledge/limitations.md):
  the `dragDropEnabled` entries invert — it must stay `true`, and no HTML5 drag
  may be reintroduced.
- [frontend.md](../../knowledge/frontend.md): the "last HTML5 drop target" and
  `useNativeFeel` drag entries.
- [architecture.md](../../knowledge/architecture.md): the staging paragraph —
  one route now, not two.
- [testing.md](../../knowledge/testing.md), [limitations](../../knowledge/limitations.md):
  the OS leg (Explorer → wry) stays uncoverable; everything from the Tauri event
  on is covered.

## Testing

- Unit: the physical-to-CSS conversion, the rect test, and hover flipping only
  on change.
- `TagEditor.test.tsx`: the `DataTransfer` drop specs become routed drops.
- `useNativeFeel.test.tsx`: the two drag specs go.
- `App.test.tsx`, `App.renders.test.tsx`: the `stageDroppedCover` mock goes.
- e2e: `tag-editor.test.ts`'s two drop specs dispatch a synthetic HTML5 `drop`
  and break. Rewritten on `emit("tauri://drag-drop", …)` with a real file
  written under `e2e/.tmp` and a position from the block's rect — the same
  stand-in `emit` already is for `task://progress`. Plus a capture of the hover
  outline from `tauri://drag-enter`.
