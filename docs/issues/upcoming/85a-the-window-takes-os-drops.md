# 85a — The window takes OS drops

Flipping `dragDropEnabled` and keeping everything that already works, working.
No new behaviour: the artwork drop moves from an HTML5 handler to the native
event on the same day the flag turns it off, and
[85b](85b-drop-files-and-folders.md) is what then does something with a dropped
folder.

Reopens [15, cut](../done/15-ingest-ergonomics-cut.md). **Tauri is not what
changed** — [74](../done/74-in-app-dragging-without-html5.md) is. Verified
against wry 0.55.1 under tauri 2.11.5:

- `with_drag_drop_handler` is still **builder-only**. There is no
  `set_drag_drop_enabled`, so the flag is still fixed at window creation and the
  cut's stated condition for revisiting has not been met.
- The documented escape hatch does not exist either. "Return `true` in the
  callback to block the OS' default behavior" is not implemented on Windows:
  `DragDropTarget`'s `DragEnter`, `DragOver`, `DragLeave` and `Drop` all
  **discard the listener's return value**. There is no report-the-paths-and-let-
  the-page-have-it-too.
- And the mechanism is `RevokeDragDrop` on the WebView2 child HWND, which
  *removes* the webview's drop target rather than intercepting it. That is why
  phase 6's in-app dragging died, and it is why nothing short of 74 unblocks
  this.

So: `dragDropEnabled` to `true` in `tauri.conf.json`, and `onDragDropEvent`
carries real paths.

## What stops working in the same moment

- **`.tag-cover`'s `onDragOver`/`onDrop` and `isFileDrag`.** There is no
  `dragover` or `drop` in the window any more, so the artwork drop is not
  degraded, it is gone. It has to arrive by the other route in the same commit.
- **`useNativeFeel`'s window-level drag swallow**, and with it the hazard it
  guarded. It exists because a file dropped on an unhandled part of the page
  makes WebView2 *open* it and the app is gone until relaunch — and with the
  drop target revoked rather than intercepted, WebView2 never sees the drop at
  all. The listener goes; so does the note on it in
  [frontend.md](../../knowledge/frontend.md).

## One listener, routed by coordinates

`getCurrentWebview().onDragDropEvent`. The payload is `enter` (paths and a
`PhysicalPosition`), `over` (a position), `drop` (both) and `leave` (nothing).

- **Physical pixels, so divide by `window.devicePixelRatio`** to get the CSS
  coordinates `getBoundingClientRect` speaks. `setZoom` is webview zoom, which
  leaves CSS coordinates untouched, and Chromium folds the page zoom into
  `devicePixelRatio` — so the one division is right at any DPI and any zoom
  rather than needing the zoom factor read out of the store.
- **`enter` already carries the paths**, so whether a drop is an image for the
  artwork square or music for the library is decided before it lands, and the
  hover feedback can be right the first time instead of correcting itself.
- **`over` fires continuously.** Nothing it produces may reach React state per
  event; the hover flag flips only when the resolved target changes. The
  listener mounts in its own component the way `ReleaseLookup` and
  `TaskProgress` do, per `CLAUDE.md` — `App` must not re-render because a
  pointer moved across it holding a file.

**The artwork square registers itself as a target while it is mounted**, and
the listener hit-tests the registered rect. `document.elementFromPoint` was the
obvious alternative and is declined twice over: it returns the topmost element,
which is a child of the square rather than the square, and jsdom does not
implement it — [74](../done/74-in-app-dragging-without-html5.md) kept the test
setup free of that stub on purpose. There is exactly one such target today, so
the registry is a module-level ref and a rect test, not a system.

`TagEditor` stays presentational and keeps owning the `rejected` message; what
changes is that its cover arrives as a staged path from the listener rather than
from a `DataTransfer` it read itself.

## The raw-bytes route goes with it

A drop now carries a path, so `stage_picked_cover` handles both and
`CoverEdit::Replace` has one producer instead of two. `stage_dropped_cover`
leaves `commands/mod.rs`, the `invoke_handler` list in `lib.rs`, `ipc/index.ts`
and its tests, and `onDropCover` in `App.tsx` stops converting a `File` to an
`ArrayBuffer`.

The [gotchas](../../knowledge/gotchas.md) entry on all-or-nothing raw IPC
payloads loses its only caller. **Keep the entry** — it is still true of the
next one — and reword the example, which names the command by hand.

Both [limitations](../../knowledge/limitations.md) and
[gotchas](../../knowledge/gotchas.md) entries on `dragDropEnabled` invert: the
flag must now stay `true`, and no HTML5 drag may be reintroduced anywhere in the
window. The e2e limitation stays and widens — an OS drag was uncoverable for the
artwork square and is now uncoverable for every drop.

Testing: the physical-to-CSS conversion and the rect test as unit tests, which
is where the arithmetic that cannot be seen in a screenshot belongs.
`TagEditor.test.tsx` loses the `DataTransfer` half of its drop specs and gains
the staged-path path. `App.test.tsx` and `App.renders.test.tsx` drop the
`stageDroppedCover` mock.
