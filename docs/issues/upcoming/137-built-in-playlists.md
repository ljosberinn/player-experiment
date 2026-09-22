# 137 — Favorites, Most Played and Recently Added are built into the library

Every library ships with three smart playlists. They sit at the bottom of
LIBRARY, under Statistics, and no longer in Smart Playlists. They cannot be
renamed, edited, deleted or sorted differently, and they open on Songs.

Depends on [134](134-love-is-kept-in-the-library.md): Favorites reads the local
loved set, so it works without last.fm.

| | Filter | Order | Limit | Icon |
| --- | --- | --- | --- | --- |
| Favorites | Loved is | Artist asc | — | `favorites` → Phosphor `Heart` |
| Most Played | Plays > 0 | Plays desc | 100 | `most-played` → `Fire` |
| Recently Added | — | Date Added desc | 1000 | `recently-added` → `Clock` |

Icons are new `IconName`s in
[registry.tsx:44-105](../../../src/components/icons/registry.tsx#L44-L105).

## Real rows, marked

Keep them as rows in `playlists`, with a `built_in` key. Migration 19 (134
takes 18) adds a
nullable TEXT column and a partial unique index on it. Everything keyed on
`playlistId` then works unchanged: `scope()`, counts, paging, history, queue,
export and the window title. Virtual sources would need a second key through
all of it.

- Today `seed_built_ins` seeds Recently Added (limit 100) and Most Played as
  ordinary playlists the user owns, guarded by `PLAYLISTS_SEEDED`
  ([playlists.rs:288-353](../../../src-tauri/src/db/playlists.rs#L288-L353),
  [settings.rs:68-71](../../../src-tauri/src/db/settings.rs#L68-L71), called
  from [lib.rs:128-132](../../../src-tauri/src/lib.rs#L128-L132)). Replace it
  with `ensure_built_ins`, which inserts any missing key at setup. A built-in
  cannot be deleted, so it needs no flag.
- `rename`, `delete` and `set_smart` refuse a built-in
  ([playlists.rs:182](../../../src-tauri/src/db/playlists.rs#L182),
  [:360](../../../src-tauri/src/db/playlists.rs#L360),
  [:376](../../../src-tauri/src/db/playlists.rs#L376)).
- `Playlist` gains `builtIn: "favorites" | "mostPlayed" | "recentlyAdded" | null`
  ([model.rs:835](../../../src-tauri/src/model.rs#L835)). Then run
  `npm run bindings`.
- Plays means `tracks.play_count`. Only `mark_played` moves it, so it counts
  local plays only. Until [136](136-a-lastfm-import-sets-play-counts.md) lands,
  Most Played ignores last.fm history.

**Existing libraries.** The migration claims each seeded row whose name,
`filter_json` and `sort_json` still equal the seed: it sets `built_in` and
raises Recently Added's limit to 1000. A row the user renamed or edited stays
an ordinary smart playlist under Smart Playlists, and `ensure_built_ins` adds
the built-in beside it; the user can delete the old one. A deleted seed is
simply re-created.

## Sidebar

- [PlaylistSidebar.tsx:95-96](../../../src/features/playlists/PlaylistSidebar.tsx#L95-L96)
  filters built-ins out of both sections.
- [LibraryNav.tsx](../../../src/components/ui/LibraryNav.tsx) draws them after
  `VIEWS`. It reads `playlists` and `playlistId` from the stores itself, so
  [App.tsx:330-337](../../../src/App.tsx#L330-L337) gains no subscription.
  `active` is already null while any playlist is open, so one row is still
  highlighted.
- The row menu offers Play and Export… only. No drop target.
- **Decide:** show a count beside them? LIBRARY rows show none today.

## Favorites is always shown

On every build, with or without last.fm. Empty, it says "**Favorites** is
empty. Love a song to add it here." in place of the smart-playlist line at
[App.tsx:397-402](../../../src/App.tsx#L397-L402), derived beside `editable`
with no new subscription.

## Songs, in a fixed order

- `landingTab` sends a smart playlist to `"albums"`
  ([store.ts:1090-1095](../../../src/features/library/store.ts#L1090-L1095)).
  A built-in goes to `"songs"` instead.
- The column layout is the library's. `loadColumns` and `applyColumns`
  ([store.ts:671-714](../../../src/features/library/store.ts#L671-L714)) go
  through `null` for a built-in, never `columns_json`.
- Today every playlist opens in `"position"`
  ([store.ts:378-415](../../../src/features/library/store.ts#L378-L415)). Outside
  a static playlist that falls back to `added_at` asc, so Most Played currently
  opens oldest-added first. `sortForEntry` sees only `entry.playlistId`.
  Recommended: `scope()` carries a built-in's stored sort, and
  `sort_order_by` uses it whatever `query.sort_by` says
  ([query.rs:245-296](../../../src-tauri/src/db/query.rs#L245-L296),
  [:386-415](../../../src-tauri/src/db/query.rs#L386-L415)). The frontend only
  draws it.
- In a built-in, `toggleSort`
  ([store.ts:973](../../../src/features/library/store.ts#L973)) and the header's
  `onSort`
  ([ColumnHeader.tsx:216-229](../../../src/features/library/ColumnHeader.tsx#L216-L229))
  do nothing. The arrow still shows, and the header stays a button because
  column drag needs it.
- `visibleSort` exempts the locked field, as it exempts `relevance` and
  `position` ([columns.ts:156](../../../src/features/library/columns.ts#L156)).
  Plays and Date Added are not in `DEFAULT_COLUMN_IDS`, so otherwise the sort
  falls back to Title.

**Decide:**

- **Search.** `applySearch` switches the sort to relevance
  ([store.ts:1133-1135](../../../src/features/library/store.ts#L1133-L1135)).
  Recommended: the lock holds while searching.
- **Export.** A library export includes every playlist
  ([export/mod.rs:321-326](../../../src-tauri/src/export/mod.rs#L321-L326)).
  Recommended: keep the built-ins, carrying `builtIn`, and note the key in
  `export-schema.md`.

## Tests and docs

- The built-in tests in `playlists.rs` (L1111-1176) are inverted. A built-in
  cannot be renamed, edited or deleted, and a missing one is re-created. Add a
  test for the claim.
- `query.rs`: the locked sort wins over `query.sort_by`.
- `store.test.ts`: a built-in lands on Songs from Releases and from
  Statistics, and `toggleSort` does nothing in one.
- `PlaylistSidebar.test.tsx`: built-ins do not appear in either section.
- e2e: love a song from the row menu, open Favorites, find it there. Runs on
  the keyless CI build.
- Docs: in `data-model.md`, update "Playlists", "Smart playlists" and the
  `playlists.seeded` line. In `frontend.md`, update the landing rule at
  L67-75.

## Verification

- A fresh library shows Favorites, Most Played and Recently Added under
  Statistics, and none of them under Smart Playlists.
- Their row menu has no Rename, Delete or Edit Filter….
- Each opens on Songs, with the library's columns, in its own order. Clicking
  a header does not re-sort. Hiding the sorted column does not re-sort.
- Most Played holds at most 100 played songs, with the most played first.
  Recently Added holds the newest 1000.
- A keyless build shows Favorites, empty with its hint; loving a song from the
  row menu puts it there, in Artist order.
- An upgraded library with untouched seeds shows each playlist once. An edited
  seed stays under Smart Playlists.
