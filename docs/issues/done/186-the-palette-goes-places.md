# 186 — The palette goes places

Needs 185.

## Go to

First group.

| Entry | Does |
| --- | --- |
| Songs, Releases, Artists, Genres, Statistics | `showTab`, named from `VIEW_TITLES`, `LibraryNav`'s order. The open one is left out unless a playlist is showing. |
| Favorites, Most Played, Recently Added | `showPlaylist`; the built-ins, as the sidebar files them. |
| Back to …, Forward to … | History, named by `HistoryNav`'s `destinationOf`. `Alt+←` / `Alt+→`. Absent when there is nothing there. |
| `Artist: <name>`, `Release: <name>` of the playing track | `showTrackArtist`, `showTrackGroup`. Absent while stopped, and each without its tag. |

## Smart Playlists, Playlists

Last groups, as the sidebar's sections. `showPlaylist`; the open one left out.
Names can repeat, so `MenuItem` has an optional `id` the palette keys by.

## Tests

- `commands`: open view absent; built-ins in Go to; playlists by section;
  Back and Forward only with history; now-playing entries only while loaded
  and tagged; same-named playlists get distinct ids.
- Component: two same-named entries both render, the highlighted one runs;
  `Alt+←` announces as `Alt+ArrowLeft`.
- `App`: `rel` Enter opens Releases.

## Verification

- `rel` Enter opens Releases; a playlist's name Enter opens it.
- Back names the view it returns to and goes there.
- While playing, `Artist:` drills into the playing artist.
