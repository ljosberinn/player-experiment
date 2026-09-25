# 146e — Stories for the library views and sidebar

Needs [146a](../done/146a-story-harness.md). Titles go under `Features/Library` and
`Features/Playlists`.

`SongRow`, `ColumnHeader` and `RowStatusCell` get no stories of their own
here. They are drawn through `SongTable` and `ReleaseGroups`, which are the
only places they render.

| Story file | Draws | Seed | States |
| --- | --- | --- | --- |
| `library/SongTable.stories.tsx` | `SongTable`, `SongRow`, `ColumnHeader` | `useLibraryStore` (columns, sort, selection); `queryTracks` pages from `LIBRARY` | whole library; sorted by a column; several rows selected; a playing row and a missing row; empty library; inside a playlist |
| `library/ReleaseGroups.stories.tsx` | `ReleaseGroups` | `useLibraryStore.releases`; `queryTracks` | several releases with and without covers, one release, empty |
| `library/BrowseView.stories.tsx` | `BrowseView` | `useLibraryStore.groups` / `groupsLoading` | one per browse kind, loading, empty |
| `library/SearchBox.stories.tsx` | `SearchBox` | `useLibraryStore.searchInput` | empty, with a filter query, inside a playlist |
| `library/HistoryNav.stories.tsx` | `HistoryNav` | `useLibraryStore.history` | nothing either way, back only, both |
| `ui/LibraryNav.stories.tsx` | `LibraryNav` | `usePlaylistsStore.playlists`, `useLibraryStore.playlistId` | built-ins only, built-ins plus static and smart playlists, one selected |
| `playlists/PlaylistSidebar.stories.tsx` | `PlaylistSidebar` (and `SidebarSection` through it) | `listPlaylists`, `loadSidebarSections` | several playlists, none, a collapsed section; the delete confirmation opened by `play` |
| `tagsource/ReviewQueue.stories.tsx` | `ReviewQueue` | `tagsourceReviewCounts` | with counts, empty; its context menu opened by `play` |

- Give the virtualised views (`SongTable`, `ReleaseGroups`, `BrowseView`) a
  parent with a set height, around 600px. `@tanstack/react-virtual` measures
  its parent and draws no rows at a height of 0.
- `queryTracks` answers slices of `LIBRARY` for the requested offset and limit.
  Sort in the handler so the sorted story reads correctly.
- Add `libraryHandlers` and `playlistHandlers` to `.storybook/handlers.ts`.
  Include `saveColumnConfig` and the playlist rename, delete and add actions,
  so that clicking around a story does not throw.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- Scrolling `SongTable` to the end of `LIBRARY` fills every row.
