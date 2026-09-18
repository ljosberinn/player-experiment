# Data model

SQLite via `rusqlite` (bundled), migrations in `src-tauri/src/db/schema.rs`.
`PRAGMA user_version` records progress. **Migrations are append-only** — never
edit a shipped one.

| # | Adds |
| --- | --- |
| 1 | `covers`, `tracks`, `playlists`, `playlist_tracks`, `settings`, `watch_folders` |
| 2 | `tracks_fts` (FTS5 external-content over title/artist/album/album_artist/genre/comment, kept current by triggers) |
| 3 | `tracks.missing_since` + a **partial** index |
| 4 | `tag_values` — the distinct values a library uses, for autocompletion |
| 5 | `covers.palette` — the dominant colours of a cover |
| 6 | `scrobble_queue` — plays recorded but not yet accepted by last.fm |
| 7 | `removed_paths` — files an explicit removal took out, so a rescan does not add them back |
| 8 | `tracks.release_mbid` + `tracks.release_group_mbid` — which MusicBrainz release a file belongs to, and which release group across its pressings; the group is indexed because it is what a browse view groups by |
| 9 | `release_lookup` — what the unattended lookup pass has been through — plus `tracks.release_type`, MusicBrainz's release-group primary type, read off the file the way the two ids above are |
| 10 | a fourth `release_lookup.status`, `aside` — a queued release the user has said to leave alone. A whole-table rebuild, because the vocabulary is a CHECK constraint and SQLite cannot widen one in place |
| 11 | `genres`, `genre_edges`, `genre_aliases`, `genre_overrides` — the genre hierarchy, seeded from a generated data file `concat!`ed into the migration |
| 12 | `tracks.path` collates `NOCASE` — one file is one row whatever it is spelled like. A whole-table rebuild, because the constraint is on the column, and a merge in the same migration for the rows that collide under the fold |
| 13 | `plays` — one row per play, with the artist and title as they were heard. `track_id` is the one derived column and the one foreign key; `idx_plays_identity` over `(started_at, match_key)` is the dedupe rule within a source |
| 14 | `lastfm_loved` — the loved set the last import fetched |

**Migrations run with `PRAGMA foreign_keys=OFF`.** `db::migrate` sets it
around the whole run and back on afterwards, which is SQLite's own procedure
for a migration that rebuilds a table: with enforcement on, `DROP TABLE tracks`
is an implicit `DELETE FROM` and `playlist_tracks`' `ON DELETE CASCADE` takes
every playlist in the library with it. The pragma is a no-op inside a
transaction, so it cannot be set by the migration that needs it.

**The rule has been broken once, before v1.** The tag-edit undo journal was
migration 3, and 82a deleted the entry rather than adding one that drops the
table: the numbering above shifted under every database in existence, so
`migrate` refuses them all and the fix is to delete `library.sqlite3` and
rescan. Only a pre-v1 schema can be treated that way; the rule stands.

## One query, narrowed

Everything the table shows comes from one statement built by `db::query`'s
`scope()`. A search, an open playlist, a browse drill-in and a smart playlist's
cutoff are all **clauses on the same query**, not queries of their own — which
is why paging, sorting, search-within, "select all", the play queue, export and
`library_stats` work in every view with no second code path.

- **Placeholders are anonymous `?` bound in order**, so a clause can be added or
  dropped without renumbering its neighbours.
- **Relevance and position are `SortField`s**, not flags: valid only when a
  search or a playlist is joined in, and falling back to a real column
  otherwise, so a stored sort is harmless in a view that cannot honour it.
- **Sorting is `ORDER BY col <dir> NULLS LAST, tracks.id <dir>`.** NULLs last so
  untagged files do not head up an ascending view, and the id tie-break so a
  page boundary does not move between two queries. `NULLS LAST` rather than a
  leading `col IS NULL`: the two order rows identically, but an expression as
  the first ORDER BY term matches no index, so it costs a temp-b-tree sort of
  the whole library on every page. `tests/perf.rs` asserts the plan of the real
  statement — the columns with an index behind them must sort without one.
- **`bm25` is weighted** so a title hit outranks one buried in a comment, and it
  ignores sort direction — there is no useful "worst match first".
- **Row count is a separate `COUNT(*)`**, so the scrollbar is right without
  loading rows. `count_tracks` is a thin wrapper over `library_stats`, so the
  footer and the scrollbar cannot describe different views.
- **`sum()` of no rows is NULL in SQLite**, not 0 — every aggregate is
  `coalesce`d or an empty library fails to decode.
- **`all_track_ids`** exists because "select all" needs ids, not rows; routing
  it through the paged query would silently cap a 50k selection at the page
  size.

## Playlists

- `playlist_tracks` is keyed on `(playlist_id, track_id)`: **a playlist holds
  each track at most once.** A drop reports "added 6 of 10, 4 already there".
- **`position` is gapped by 1024**, so a drop is one UPDATE per moved row. When
  a gap runs out the playlist is renumbered once, with a gap wide enough that
  the retry cannot fail for the same reason.
- **Reordering is offered only in a playlist's own order.** Sorted by a column
  the arrangement is derived and a drop would have nothing to persist.
- A deleted playlist reads as an **empty view**, not an error — dropping the
  clause instead would show the whole library.
- Per-playlist columns live in `playlists.columns_json`; the library view keeps
  its own row in `settings`. `None` stays distinguishable from "configured to
  show nothing" — a playlist with no layout inherits the library's.

## Cover art

- **`covers.hash` is the hash of the file's bytes, not of the row's.**
  `db::covers::store` re-encodes what it stores; hashing the result instead
  would mean decoding before knowing whether the row already exists, which is
  55,781 decodes on a first scan rather than 5,799, inside the serial write
  transactions.
- **Normalizing an existing library is a thread, not a migration** — the
  reasoning migration 5 already settled. `covers.normalized` marks it done in
  the shape of `playlists.seeded`, and `covers.normalizedThrough` holds the
  last hash finished, so a quit part-way through resumes. No schema change, so
  the migration table above is unchanged.

**The MusicBrainz release ids are backfilled the same way.** Migration 8
assumed nothing had written them, but Picard had: about 9% of the measured
library carries a release and release group id, and a scan never re-reads an
unchanged file, so none of them had reached the rows — which left the lookup
pass searching, and overwriting, releases whose files already named them.
`scan::read_musicbrainz_ids` reads both off every file once, holding the scan
lock a chunk at a time, and fills **only empty columns** so an id the lookup
wrote stays. `release_type` is left out: Picard writes it lowercase and with
secondary types, and it names the folder the mover files into.
`tracks.mbidsRead` marks the pass done and `tracks.mbidsReadThrough` holds the
last track id finished.

## The Library folder

Two keys in `settings` and no table: `library.organize`, and `library.root` for
the folder itself. **Neither is exportable** — a root names a path on this
machine — and both have to be set for anything to happen, because organize-on
with no root is not a state the dialog can reach and a hand-edited row must not
make it one.

**There is no resume table for the filing, and no migration.** A release whose
files all sit at the target `library::layout` computes is filed; one whose files
do not is not. The state is derived from `tracks.path` on every sweep, which is
what makes it survive a quit, a kill, and the switch being turned off and on
again. `library::survey` and `library::mover` compute that target through the
same builders, because two answers to where a file goes is the defect: the
harmless direction is a release the survey calls filed and the mover would have
moved, and the other is a release offered to a mover that does nothing with it,
every sweep, forever.

**A ` (n)` collision marker is where a file goes only while another row holds
the plain name.** Two releases sanitizing to one name earn the number; the
marker a filing loop left behind does not, and accepting every marker left 819
files wearing one that nothing justified. `survey::placed` asks
`mover::free_target` — the mover's own function, with an empty `taken` where the
mover passes the release's in-flight one — so the answer can only be the same or
higher, and the file is offered until the number comes off. A row marked missing
holds the name too: `owned_by_other` counts it because `UPDATE tracks SET path`
would otherwise collide with it when the drive comes back, so those markers
stay until the user removes the rows.

**A path is compared with case folded, everywhere it is compared.** NTFS
treats `The Corpse of Rebirth` and `The Corpse Of Rebirth` as one directory;
the ideal path is built from the tags and the actual one is what the directory
is really called, so byte-exact the release was unfiled on every sweep,
forever, and the scanner read the mover's own writes back as new files. The one
answer is `library::layout::same` and its `fold`, used by `survey::placed`,
the mover's collision search and `scan::plan`; in SQL it is the `NOCASE`
collation on `tracks.path`, and `COLLATE NOCASE` on the two statements that
compare a path to a stored one. **ASCII-only**, which is what `NOCASE` is — a
path differing by `Ä`/`ä` stays two paths, the limit 81 already records for
release keys.

**A row records the spelling the filesystem has, not the one that was asked
for.** `create_dir_all` will not re-case a directory that already exists, so a
file computed into `The Corpse of Rebirth` lands in `The Corpse Of Rebirth`
with the rename reporting success; `insert_track`'s `ON CONFLICT` updates every
column but `path`, so a row that took the asked-for spelling would keep it
forever. `library::mover` reads each target back with `canonicalize` and stores
the part below the library folder, joined onto the folder as it was configured —
the answer resolves short names and junctions too, and a row that no longer
starts with the folder the user named is a release `survey::placed` can never
accept.

**The root is a `watch_folders` row for as long as the switch is on.**
`scan::plan` marks missing every known row it did not walk, so a library filed
into a folder nobody watches is marked missing in full on the next scan;
`scan::remove_watch_folder` refuses the root until the switch goes off. The
previous root stays watched after a change — it is where the files came from.

## The release lookup

`release_lookup` is one row per release the unattended pass has attempted, and
three things at once: the queue of releases a person still has to decide,
the point a pass killed mid-run resumes from, and the guard that stops a second
pass re-searching eight thousand releases. **No row means never attempted**, and
nothing clears a row — a pass that re-searched every miss on every launch would
be the best part of a day that finds nothing, forever.

- **The key is `db::query`'s two grouping expressions**, so a release is the
  same thing here as it is in the browse grid, and so retagging invalidates by
  itself: change the album or the artist and the key changes.
- **A `PRIMARY KEY (album, artist)` would not hold it.** SQLite permits NULLs in
  a rowid table's primary key, so an untagged release inserts twice; a UNIQUE
  index over `coalesce(album, ''), coalesce(artist, '')` is what does. Both
  sides collate `NOCASE`, because the grid folds case when grouping — unfolded,
  a release tagged two ways is one tile and two rows.
- **`candidates_json` is a cache, not a record.** The pass has the search
  results in hand at the moment it queues a release, and reviewing one later
  should not cost another rate-limited second.
- **A release whose files already agree on a release MBID is resolved without a
  call**, so a re-install or a rescan of an already-tagged library pays nothing.
  Files that name two different pressings are left pending — that disagreement
  is what the lookup is for.

### The four statuses, and what leaves the queue

`resolved`, `review`, `none` and — since migration 10 — `aside`. Only `review`
is counted beside the sidebar's row and offered in the dialog.

- **Skipping in the review dialog writes nothing.** It means "not now": the
  entry stays and is offered again the next time the queue is opened. `aside` is
  the other decision, "leave this alone", and it is a separate action because a
  queue that can only say the first is a queue whose count never reaches zero.
  Every set-aside release comes back at once, from the sidebar row — one way
  back rather than a second queue to manage.
- **A confirmed apply records the key it wrote as `resolved`.** Applying a
  lookup usually rewrites the album or the artist, so the row that queued the
  release is about to be orphaned under its old key; without this the count
  would never come down. It is also right for a lookup nobody queued — a
  release somebody has just tagged by hand is not one to search for later.
- **Opening the queue prunes what is no longer in it.** Retagging or removing
  songs orphans a `review` or `aside` row, which would otherwise sit in the
  count for good. Rows in the other two statuses are left alone: an orphaned
  `resolved` row is a tombstone, and deleting it would buy nothing but a search
  already paid for. The count itself is a cheap `count(*)` over the small table,
  so it can read one ahead of the queue between a retag and the next open.

## The scrobble queue

`scrobble_queue` holds the **resolved** play — artist, title, album, duration,
the second it started — rather than a track id. A play is a historical fact
about what was on at a moment, and the row it came from can be retagged or
removed before the queue drains; sending what the tags say today would report
something that never happened. So there is no foreign key either.

- **Every play goes through it**, online or off, so there is one code path
  rather than two. `next_try_at` is zero for a fresh row, which means due now.
- **A play made with no account connected is not queued at all** — keeping it
  would mean that connecting an account later posted listening the user never
  offered.
- **Bounded by age and by attempts**: last.fm refuses a play over two weeks old
  (ignore code 3), so nothing is kept past that, and twelve failures drops a row
  regardless. No size cap is needed.
- **Only ignore code 5, the daily cap, is deferred.** Codes 1–4 are permanent,
  so those rows are dropped exactly like accepted ones.

## The play log

`plays` is one row per play, and the same argument the scrobble queue makes
about what a play is: the artist, title, album and duration are stored as they
were heard, and the row they were read off can be retagged or deleted
afterwards. `track_id` is the one derived column, which is why it is the one
foreign key — `ON DELETE SET NULL` forgets the link and keeps the play.

- **A local play is written whether or not an account is connected**, in the
  same transaction as `playback::mark_played`, so the count and the log cannot
  disagree about what was played. Not about when: the count records the moment
  the play counted, the log the moment the track started.
- **The log does not inherit the scrobbler's rules.** No artist and shorter
  than thirty seconds are last.fm's conditions for accepting a scrobble, not
  this app's for remembering a play.
- **`match_key` is normalized in Rust** — lowercase, collapsed whitespace, a
  trailing `(feat. …)` dropped, nothing else. `lower()` and `COLLATE NOCASE`
  are ASCII-only and would leave Motörhead unfolded, and folding `(Live)` into
  the studio cut would destroy a distinction worth keeping. A key with an empty
  side is empty, because one built from nothing matches every untagged file.
- **`plays::resolve` rebuilds `track_id` for the whole log**, wherever
  `tag_values::rebuild` runs, for the reason that module gives at length. One
  key names several tracks routinely — the album copy and the compilation copy
  — so the winner is fixed rather than incidental: present before unplugged,
  then the lower id, which is migration 12's tiebreak. Without it the function
  is not idempotent and its guarded `UPDATE` rewrites the log on every run.
- **`idx_plays_identity` is the dedupe rule within one source, not across
  them.** last.fm autocorrects artist and title, so a play this app wrote comes
  back from the import under a spelling that computes a different key. That
  case is `started_at` alone, and it belongs to the import: within a second
  this app played exactly one thing.
- **`artist_mbid` and `track_mbid` are recorded, and nothing matches on
  them.** 78 measured last.fm's own recording ids against the ones in the
  files over 7,863 scrobbles: where both sides named a recording they agreed
  14% of the time, and not one play the key had failed to link was linked by an
  id. Most of last.fm's are pre-NGS ids MusicBrainz has since retired, and
  probing a sample of them returned 404 for every entity type. So the columns
  stay as part of what a play was, and `resolve` is the key alone.

## The last.fm import

`lastfm::import` pages `user.getRecentTracks` backwards by a `to=` cursor, never
by page number, with one transaction per page. Where it stands is one JSON value
in `settings` under `lastfm.import`: the username, the cursor while a run is
under way, the newest scrobble that run has seen, and the floor a finished run
leaves for the next one's `from=`. It is not exportable.

- **Rows land `source = 'lastfm'` with `OR IGNORE`**, so a re-fetched page is
  free, and a row is skipped when its second already holds a `local` play.
- **Re-import from scratch deletes the `lastfm` rows** in the same transaction
  that resets the state. That is how a scrobble deleted on last.fm leaves.
- **`lastfm_loved` is replaced, never merged.** It is fetched in full only after
  the history finishes, then swapped in one transaction, so a failed fetch keeps
  the old set. `ListenQuery.loved` filters on `plays.match_key` against it.

## Statistics

`db::stats` reads, never writes. Listening aggregates take a `ListenQuery` over
`plays`; library ones take the `TrackQuery` every view uses, through `scope`.

- **No rollups.** Every aggregate is one pass, budgeted in `tests/perf.rs` at
  250k plays. A materialized total would owe an invalidation path.
- **Buckets are local time**, named by their first local day, weeks from
  Monday. CI pins `TZ` to a zone west of UTC, because on the UTC runner local
  and UTC bucketing agree and the test cannot tell them apart.
- **A play with no file counts everywhere but genre.** `listen_totals` carries
  how many plays have a genre and a duration, so a panel can say what share it
  covers.
- **How the view was last filtered is one `settings` key**, `stats.filters`,
  opaque JSON like `sidebar.sections`: which filters exist is the frontend's
  business, and it is not exportable for that key's reason.
- **The genre filter and `genre_breakdown` walk `Tree::lineage`** — the primary
  parent and the overrides, the tree the donut draws — never `genre_edges`.

## Smart playlists

A persisted filter **tree**, never SQL. `smart/compile.rs` turns it into a
parameterized `WHERE` plus a bind vector, and `playlists.sort_json` carries the
optional sort and limit.

```ts
type Rule  = { field: TrackField; op: Op; value: FilterValue };
type Group = { combinator: "and" | "or"; children: (Rule | Group)[] };
```

- The compiler whitelists fields **and** sort fields — both are concatenated
  into SQL, so neither can ever be user text.
- **`FilterValue` is typed.** A rule whose value does not match its field is
  refused at save time, not coerced.
- **Exclusion rules spell out the NULL case.** `NULL <> 'Guitar'` is NULL, so
  `IsNot` and friends read `(col IS NULL OR …)` or every untagged file silently
  disappears.
- **`LIKE` patterns escape `%`, `_` and the escape character** — otherwise "50%"
  matches every title starting with 50.
- **Depth and rule count are capped** (10 and 200): compilation recurses.
- **An empty filter matches everything** — a new smart playlist shows the
  library to narrow down.
- **`now` is passed into the compiler**, so "added in the last 7 days" is
  testable without waiting a week.
- **A limit decides membership, not display order**: it lives in `scope()` as
  `tracks.id IN (SELECT id … ORDER BY … LIMIT ?)`. Appended to the page query
  instead, sorting the open playlist would change which songs it holds and a
  search inside it would search the whole library.
- The backend validates every filter by compiling it before storing.

## The genre tree

An ID3 genre frame is free text, and the drill-down 84b wants is black metal →
atmospheric black metal, raw black metal. Migration 11 carries the hierarchy
that makes that possible, and `db::genres` turns one tag string into a genre and
a parent.

| Table | Holds |
| --- | --- |
| `genres` | every genre label, with **one** primary parent |
| `genre_edges` | the whole `subclass of` DAG |
| `genre_aliases` | alias → label, so "DSBM" reaches depressive black metal |
| `genre_overrides` | the user's corrections — the only one written at runtime |

- **From Wikidata, and committed.** `scripts/genres.mjs` (`npm run genres`) runs
  three SPARQL queries and writes `src-tauri/data/genres.sql`, which the
  migration `concat!`s in. It is CC0, so it ships with no attribution burden,
  and it is the only source with both the granularity and the licence — the
  alternatives are argued out in [plans/statistics.md](../plans/statistics.md).
  **The runtime never touches the network**; offline-first and the CSP both
  require it. Run the script by hand, not from CI: the file is a snapshot of a
  wiki other people edit, so there is nothing for a drift check to be right
  about.
- **Everything is a lowercased label, never a QID**, because the thing being
  resolved comes out of a tag and has no QID. `db::genres::normalize` and the
  script's `normalize` must stay in lockstep — Rust's `to_lowercase`, not
  SQLite's ASCII-only `lower()`.
- **Resolution is three layers: Wikidata label or alias → suffix derivation →
  override.** The suffix layer treats a genre as a child of any shorter genre
  its name ends with **at a word boundary**, longest match winning, and is
  reported as `ParentSource::Derived` so 84b can label a guess as a guess.
- **The primary parent is arbitrary where a genre has several.** Blackened death
  metal is a child of both black metal and death metal; the generator takes the
  lexicographically smallest label, `genre_edges` keeps both, and
  `genre_overrides` is what makes an arbitrary rule affordable.
- **`genres.parent` is a forest, not a graph.** P279 in the wild is not acyclic
  and a parent chain that loops is a drill-down that never terminates, so the
  generator skips any candidate that would close a cycle.
- **The tree is loaded whole, then resolution is pure.** A panel resolves every
  distinct genre in the library at once, and the suffix layer needs the entire
  label set to answer even one string. `tests/perf.rs` budgets both the seed and
  the load — the seed is paid by every test that opens a database.
