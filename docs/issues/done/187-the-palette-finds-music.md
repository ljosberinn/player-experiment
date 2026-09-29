# 187 — The palette finds music

Needs 185. Artists, releases and songs, under the commands.

## Backend

- `palette_search(query, limit)` → `PaletteResults { artists, releases, tracks }`
  (`BrowseGroup[]`, `BrowseGroup[]`, `Track[]`), each capped at `limit` (at most
  50). Off the IPC thread.
- The search box's FTS index, each kind held to its own columns: artists on
  the album artist, or the artist where there is none (`GROUP_ARTIST`'s
  choice); releases on title, artist and album artist; songs on every column.
  All columns for every kind would rank a most-played artist with a song called
  `Sunday` above the artist named Sunn.
- Most played first, then name. Groups are picked by matched tracks and read
  whole through migration 20's index, so a compilation ranks by all its plays.
  Untagged groups and punctuation-only input find nothing.

## Frontend

- `mode="none"`: the palette filters its commands itself, with 185's
  word-by-word `matches`. A `found` group is drawn as given.
- From two characters on, debounced by `SUGGEST_DEBOUNCE_MS` and late-answer
  guarded, as `useGenreSuggestions` is. The last answer stays up while the next
  is coming, and "No matching command." waits for it.
- Groups after the commands: Artists, Releases, Songs, 5 each.
- Artist or release: `showGroup(kind, group)` switches to its tab and drills in,
  leaving any open playlist (`openGroup` works only within the open tab). Song:
  plays it alone.
- An empty or failed search shows no content groups, and no error.

## Tests

- Rust: each kind capped; ranking by plays; untagged groups excluded; songs
  agree with the search box; a compilation artist does not find Various
  Artists; `tests/perf.rs` holds the search to the index.
- Frontend: a late answer does not overwrite a newer one; commands still
  filter while a search is in flight; a hit arriving after the typing runs on
  Enter; an artist hit drills in, a song hit plays.

## Docs

`data-model.md` (the matching), `frontend.md` (the palette), README Keyboard,
bindings regenerated.

## Verification

- Part of an artist's name: the artist first, their releases below.
- A release Enter lands in its drill-in; a song Enter plays it.
- Typing fast on the full library does not stutter the list.
