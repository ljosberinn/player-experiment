# 137 — Favorites, Most Played and Recently Added are built into the library

Every library ships with three smart playlists. They sit at the bottom of
LIBRARY, under Statistics, with no count, and no longer in Smart Playlists.
They cannot be renamed, edited, deleted or sorted differently, and they open on
Songs.

Stacks on [136](136-a-lastfm-import-sets-play-counts.md): Favorites reads the
local loved set from 134, and Most Played counts imported plays.

| | Filter | Order | Limit | Icon |
| --- | --- | --- | --- | --- |
| Favorites | Loved is | Artist asc | — | `favorites` → Phosphor `Heart` |
| Most Played | Plays > 0 | Plays desc | 100 | `most-played` → `Fire` |
| Recently Added | — | Date Added desc | 1000 | `recently-added` → `Clock` |

## Real rows, marked

Rows in `playlists` with a `built_in` key (`BuiltIn`: `favorites`,
`mostPlayed`, `recentlyAdded`). Everything keyed on `playlistId` works
unchanged.

- Migration 19 adds the nullable column and a partial unique index, claims each
  old seed whose name, `filter_json` and `sort_json` still equal the seed, and
  deletes `playlists.seeded`. A touched seed stays the user's.
- `ensure_built_ins` replaces `seed_built_ins`. On every launch it inserts a
  missing key and rewrites each row's name, filter and order to `definition`.
  That rewrite is what raises Recently Added to 1000.
- `rename`, `set_smart` and `delete` refuse a built-in.
- `scope()` carries a built-in's stored sort, and `sort_order_by` uses it ahead
  of `query.sort_by` and relevance.
- A library export keeps them, with a `builtIn` key.

## Frontend

- `LibraryNav` draws them after `VIEWS`, reading the stores itself. The row
  menu has Play and Export… only, and there is no drop target.
- `PlaylistSidebar` filters them out.
- The playlists store hands the library store the built-in ids on each load
  (`setBuiltIns`), because back and forward know a playlist only by id.
- `landingTab` sends a built-in to Songs. `sortForEntry` opens it in
  `BUILT_IN_SORT`. `toggleSort` and `applySearch` leave that sort alone, and so
  does hiding the sorted column.
- Columns load from and save to the library's layout (`null`).
- New optional column: Date Added (`addedAt`).
- An empty Favorites says "Love a song to add it here."

## Verification

- A fresh library shows Favorites, Most Played and Recently Added under
  Statistics, and none of them under Smart Playlists.
- Their row menu has no Rename, Delete or Edit Filter….
- Each opens on Songs, with the library's columns, in its own order. Clicking
  a header does not re-sort. Hiding the sorted column does not re-sort.
- Most Played holds at most 100 played songs, most played first. Recently
  Added holds the newest 1000.
- A keyless build shows Favorites, empty with its hint. Loving a song from the
  row menu puts it there, in Artist order.
- An upgraded library with untouched seeds shows each playlist once. An edited
  seed stays under Smart Playlists.
