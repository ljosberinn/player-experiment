# 74 — In-app dragging without HTML5 drag and drop

No behaviour change. Prerequisite for [85](85-drop-files-and-folders.md), which
cannot happen while any drag in the window depends on the webview's own
drag-and-drop.

Four sites, all of them `DataTransfer`:

- `SongRow` — dragging rows out, and reordering within a playlist
- `PlaylistSidebar` — two drop targets
- `TagEditor` — artwork
- `playlists/drag.ts` — the private MIME type the payload travels under

**The model is already in the tree.** Column reorder has been pointer-event
dragging since phase 20: `columnDrag.ts` separates a click from a drag by a 4px
threshold and hit-tests against header midpoints, on `onPointerDown`. It feels
native, and nothing about a row or a sidebar item is harder than a header.

`drag.ts` mostly disappears with the migration. A private MIME type exists to
keep a track drag out of text fields and to stop arbitrary text being read as a
track drag; a payload held in a module is not reachable by either, so the
guard has nothing left to guard.

What the webview was providing for free and now has to be built: pointer
capture, the drag image, and edge auto-scroll — the last one against a
virtualized 150k-row list, where HTML5 was not helping much anyway.

The **mouse-only** limitation is unchanged; the Menu key, Alt+Arrow and Delete
routes are untouched. e2e gets better rather than worse: WebDriver can
synthesize a pointer drag, and it never could perform an OS one.
