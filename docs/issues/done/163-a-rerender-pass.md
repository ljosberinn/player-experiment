# 163 — A re-render pass over the frontend

Last pass: [25](25-frontend-render-pass.md), then 60, 63, 65. Walked in jsdom
with bippy (react-scan's fiber hook) driving the real stores through their IPC
events; `dev:scan` by hand for what needs layout.

| Woke for nothing | Cause | Fix |
| --- | --- | --- |
| `App`, background, now-playing, love, scrubber — per pause, seek, volume step | `player://state` re-sends the track and palette | `reuse` keeps equal values' identity |
| `App`, menus, sidebar, nav, search, stats tokens — per `library://changed` | playlists and stats re-read fresh | `reuse` |
| 190 cells and a frame of placeholders — per `library://changed` | `refresh` dropped the page cache | `refresh(true)` keeps pages as `stalePages` until replaced |
| `App` and the whole tag editor — per `tags://progress` | `App` held the progress | `TagEditor` reads `saving`; a leaf reads progress |
| menus, table, player bar — per love confirmed | backend answer is a new `Set` | kept when the members match |
| every visible row and the header — per click, scroll frame | uncompiled `SongTable` calls them | `memo` on both |
| every playlist row's context menu — per playlist opened, per row a drag crosses | rows built inline in a `.map` | `PlaylistRow`, `BuiltInRow`, `memo` |

Narrowed reads: `App` (`total === 0`, `stats.missing`, track id),
`useWindowTitle` (title string), `BrowseView` (empty).

Kept: `AppMenus` rebuilding the menu bar per selection change (60).

Counts in `App.renders.test.tsx` (`App` counted through `useNativeFeel`),
`SongTable.renders.test.tsx` (row and header runs) and
`PlaylistSidebar.renders.test.tsx` (row menus).

## Verification

- `npm run dev:scan`, songs view: a row click outlines the table and two rows;
  a scroll outlines only rows entering; nothing outlines while a scan, an import
  or the lookup pass runs, beyond the table body and the readout.
- Pause, seek, drag volume: only the control that changed.
- Open one playlist after another: two sidebar rows, not all of them.
- Drag rows onto a playlist; open a row menu; Settings; Statistics with music
  playing: nothing outside the thing being used.
