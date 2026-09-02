# 85 — Drop files and folders into the library

Reopens [15, cut](../done/15-ingest-ergonomics-cut.md). **Tauri is not what
changed** — [74](74-in-app-dragging-without-html5.md) is. Verified against
wry 0.55.1 under tauri 2.11.5:

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

So: `dragDropEnabled` to `true`, and `onDragDropEvent` carries real paths.

- **A dropped folder becomes a watch folder**, exactly as the picker's
  "Add Folders…" does, and a scan follows.
- **Dropped files need [83](83-the-library-folder.md)**. The scanner is
  root-driven and `plan` marks anything not under a root missing, so loose files
  with nowhere to live would vanish at the next scan. With organizing on they
  are moved into the Library root, which is watched, and the problem does not
  arise. With it off, a file drop is refused and says why — adding their parent
  folder instead would pull an entire Downloads directory into the library.
- **Non-audio in a dropped selection is ignored**, not an error. `is_audio_file`
  already decides this.
- **A drop lifts the tombstone** [73](../done/73-remove-a-song-from-the-library.md)
  left, or dropping a song that was removed once would silently do nothing.

`stage_dropped_cover` goes, and the raw-bytes IPC route with it: an artwork drop
now carries a path, so `stage_picked_cover` handles both and `CoverEdit::Replace`
has one producer instead of two. The [gotchas](../../knowledge/gotchas.md) entry
on all-or-nothing raw IPC payloads loses its only caller — keep the entry, it is
still true of the next one.

Both [limitations](../../knowledge/limitations.md) entries change: the
folder-drag-and-drop one goes, and the `dragDropEnabled` gotcha inverts — the
flag must now stay `true`, and no HTML5 drag may be reintroduced anywhere in the
window.
