# 146e — Stories for the library views and sidebar

Needs [146a](146a-story-harness.md); stacked on 146d for the shared
`.storybook/` files. Titles go under `Features/Library` and
`Features/Playlists`.

`SongRow` and `ColumnHeader` get no stories of their own: they are drawn
through `SongTable` and `ReleaseGroups`, the only places they render.
`RowStatusCell` has its own from 146c.

A story reaches its view through the store's navigation (`refresh`,
`showTab`, `showPlaylist`, `showTrackGroup`, `back`) rather than by seeding
the counts, pages and groups a navigation fetches.

| Story file | Draws | States |
| --- | --- | --- |
| `library/SongTable.stories.tsx` | `SongTable`, `SongRow`, `ColumnHeader` | whole library; sorted by Duration, descending; several rows selected; a playing row and a missing row; inside Late Night in its own order |
| `library/ReleaseGroups.stories.tsx` | `ReleaseGroups` | an artist with two releases, one uncovered; one release with a playing row |
| `library/BrowseView.stories.tsx` | `BrowseView` | one per browse kind; no songs; no results for a search |
| `library/SearchBox.stories.tsx` | `SearchBox` in `AppBar` | empty, with a term, inside a playlist |
| `library/HistoryNav.stories.tsx` | `HistoryNav` | nothing either way, back only, both |
| `ui/LibraryNav.stories.tsx` | `LibraryNav`, wired to the store as `App` wires it | before the playlists load, Songs open, a built-in open |
| `playlists/PlaylistSidebar.stories.tsx` | `PlaylistSidebar` | playlists, none, Smart Playlists folded, renaming; the delete confirmation opened by `play` |
| `tagsource/ReviewQueue.stories.tsx` | `ReviewQueue` | needs review, only set-aside, empty (draws nothing); its menu opened by `play` |

- `SongTable` and `ReleaseGroups` have no empty story: `App` draws its own
  empty states instead of them at `total === 0`. 146i's `FirstRun` covers it.
- `BrowseView` has no loading story: it draws nothing while its groups load.
- The virtualised views sit in a `.content` 720px high.
- `.storybook/library.ts` answers the library queries over `LIBRARY`:
  filtered by search, playlist and drill-in, sorted by the query's field, and
  in `RELEASE_GROUP_ORDER` inside a drill-in, which `ReleaseGroups` depends on.
- `libraryHandlers`, `playlistHandlers` and `reviewHandlers` in
  `.storybook/handlers.ts`, including the column, sidebar-section and
  playlist writes.
- Fixtures: Demos 2008 is The Lanterns', so an artist opens on two releases;
  `LATE_NIGHT` is that playlist's contents; `BUILT_INS` are the three
  built-in playlists.
- `rightClick` in `.storybook/play.ts` opens a context menu from `play`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- Scrolling `SongTable` to the end of `LIBRARY` fills every row.
- Clicking a header, a tile, a history arrow, a view or a playlist logs no
  `no story handler for` warning.
