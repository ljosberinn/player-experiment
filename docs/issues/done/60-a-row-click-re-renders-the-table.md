# 60 — A row click woke the whole app

Phase 25 moved the three schedule-driven values out of `App` and closed with
`memo(SongTable)` deliberately not taken, on the grounds that nothing left in
`App` changed often enough. Phase 34 put that back: the menu bar's Edit menu
serves `rowMenuItems`, built in `App`, so `App` subscribed to `selection` and
`trackById`. Selection changes on every click, every shift-range and every
Ctrl+A.

| action     | `App` renders before | after |
| ---------- | -------------------- | ----- |
| one click  | 1                    | 0     |
| ten clicks | 10                   | 0     |
| shift-range| 2                    | 0     |
| Ctrl+A     | 1                    | 0     |

## AppMenus

`features/shell/AppMenus.tsx` renders `<MenuBar menus={menus({...})} />` and
subscribes on its own behalf: `selection`, `trackById`, `playlistId` and
`stats.missing` from the library; `playlists`, `addTracks` and `removeTracks`
from playlists; `canUndo`, `open` and `undo` from the editor; `configured`,
`username` and `disconnect` from last.fm; `play`; and the two scan actions the
File menu starts.

Three things arrive as props, because they act on state `App` owns:
`onRemoveMissing` and `onSettings` set dialog flags, and `onExport(choice)` runs
the save dialog and writes `toolbarNotice`. `AppMenus` builds its own
`exportChoice` and `exportSelectionLabel` from the selection it holds.

`MenuBar` stays presentational — it knows how a menu opens, not what is in one.

`App` needs no `memo` as a result: it has no per-interaction subscription left.
`loadLastfm` and `watchLastfm` stayed in `App` — they are launch lifecycle, and
actions cost no renders where they sit.

## What this does not fix

`SongTable` subscribes to `selection` itself, so it renders once per click
whatever `App` does, and React batches its store notification with `App`'s into
one pass rather than two. `memo(SongTable)` could never have helped, and neither
could passing `columns` as a prop. What a click stops waking is everything that
does not care: `PlaylistSidebar`, `Sidebar`, `LibraryNav`, `HistoryNav`,
`ScanBar`, `TaskProgress`, `DynamicBackground`, the six components of the
transport strip, `CrashNotice`, `ErrorPopover` and the footer — plus a fresh
`resolveColumns` array and a rebuilt `menus()`.

The table's own forty rows are [63](../upcoming/63-every-visible-row-re-renders.md).

## Tests

`App.renders.test.tsx` asserts on `renders.playlistSidebar`, not
`renders.songTable`: the `SongTable` stub has no store subscription, so its
count says whether `App` re-rendered, not whether the real table did. An
assertion that a click leaves the table alone would pass against a fiction. The
sidebar wants nothing from the selection, so every render it does for a click is
one the click had no business causing.

`mounted()` now seeds the first page as well as `total`, so a click resolves to
a real row and a shift-range to real ids — `clickRow` reads them out of the page
cache.

`what the last.fm status re-renders` lost its "the whole tree once, when an
account connects" floor: the two scalars behind it no longer live in `App`, so
connecting reaches the menu bar and nothing else.
