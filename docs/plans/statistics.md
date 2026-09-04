# Statistics — plan

The sidebar has shipped a dimmed **Statistics** item since phase 36, as the
design draws it. What it shows was the undecided part; this is that decision.

Two tabs, because the two questions have nothing in common but a chart library:

- **Listening** — what you have heard, last.fm as the model. Needs a per-play
  log, which this build does not have.
- **Library** — what you own. Static data over `tracks`, which this build has
  all of.

Both filter, and the filters differ by tab because the subjects do.

## What is missing today

`tracks.play_count` and `tracks.last_played_at` are the only record of
listening, and they are an aggregate and a single timestamp. Every drill-down
worth having — the last fifty songs, which artist you played on a given
Tuesday, an hour-of-day heatmap — needs one row per play. `scrobble_queue` is
the right *shape* and the wrong thing: it is a drain queue, emptied on success.

So the foundation is a play log, and the history that predates this app comes
from last.fm. For the library this plan is measured against, that is **237,572
scrobbles**.

## Decisions

**One `plays` table, both sources.** Local plays are written whether or not a
last.fm account is connected, and the import writes into the same table with
`source = 'lastfm'`. Stats never ask where a row came from. The history then
survives disconnecting, a revoked session key, or last.fm going away — none of
which should cost you the record of what you listened to.

**A play with no matching file counts everywhere**, marked as not in the
library. Scrobbles contain plenty you have never owned as a file, and
discarding those at import would make history a function of whichever files
happened to be scanned that day. Artist, track, time-of-day and calendar panels
take every play. Genre and quality panels can only take matched ones and say so
on the panel — "genre known for 84% of plays" — rather than quietly reporting a
subset as the whole. The residue is a feature: a **heard, never owned** table is
a shopping list.

**Charts are ours; only the maths is borrowed.** `d3-scale` and `d3-shape` are
pure functions with no DOM and no React, and they cover the tedious half
(ticks, arc and area path generators). Every element and every colour is then
ours, which is what the design and `e2e/contrast.ts` both require. Recharts
would have been faster to a first panel and would have fought the tokens for
the rest of the project, and it has no heatmap.

**Clicks drill inside Statistics.** A donut slice narrows to its children, an
artist bar opens that artist's page, a breadcrumb walks back, and Back/Forward
work because the path registers with `history.ts`. Leaving for the Songs table
is a separate, explicit action — "Show these 412 songs" — so the first click
cannot end the exploration.

**The import takes MBIDs and the loved flag.** `extended=1` costs no extra
requests. With a nullable `tracks.mbid` filled from the MusicBrainz frames many
rips carry, matching is exact where both sides have an id and falls back to
string matching otherwise — which is the difference between telling two bands
of the same name apart and not.

## Shape

### Migration 10 — the play log

```sql
CREATE TABLE plays (
    id           INTEGER PRIMARY KEY,
    started_at   INTEGER NOT NULL,   -- unix seconds, when the track started
    source       TEXT NOT NULL CHECK (source IN ('local', 'lastfm')),
    artist       TEXT NOT NULL,      -- the historical fact, as heard
    title        TEXT NOT NULL,
    album        TEXT,
    duration_ms  INTEGER,
    artist_mbid  TEXT,
    track_mbid   TEXT,
    loved        INTEGER NOT NULL DEFAULT 0,
    match_key    TEXT NOT NULL,      -- normalized artist + title
    track_id     INTEGER REFERENCES tracks(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_plays_identity ON plays(started_at, match_key);
CREATE INDEX idx_plays_started ON plays(started_at);
CREATE INDEX idx_plays_track   ON plays(track_id, started_at);

ALTER TABLE tracks ADD COLUMN mbid TEXT;
ALTER TABLE tracks ADD COLUMN match_key TEXT;
CREATE INDEX idx_tracks_mbid ON tracks(mbid);
CREATE INDEX idx_tracks_key  ON tracks(match_key);
```

**The text columns are the play, for the reason `scrobble_queue` gives**: a play
is a historical fact about a moment, and the row it came from can be retagged or
deleted afterwards. `track_id` is the one derived field, which is why it is the
one thing carrying a foreign key — deleting a file forgets the link and keeps
the play.

**`idx_plays_identity` is the dedupe rule, and it is exact rather than fuzzy.**
`Event::Played` carries the second the track *started* (derived from
`now - position_ms`, because anything else is wrong after a pause or a seek);
the scrobbler sends that same integer to last.fm; last.fm hands it back. An
import is therefore `INSERT OR IGNORE` and a play made in this app cannot be
counted twice. It follows that `source` means *which writer got there first*,
not where you were listening — worth a comment at the column, because it reads
like the other thing.

**`play_count` and `last_played_at` stay and are not backfilled.** Only the most
recent play is recoverable from them; manufacturing timestamps for the rest
would put invented data in the table the whole feature reads. The import covers
that history properly.

### Migration 9 — the genre tree

```sql
CREATE TABLE genres          (label TEXT PRIMARY KEY, parent TEXT);
CREATE TABLE genre_edges     (child TEXT NOT NULL, parent TEXT NOT NULL,
                              PRIMARY KEY (child, parent));
CREATE TABLE genre_aliases   (alias TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE genre_overrides (label TEXT PRIMARY KEY, parent TEXT);
```

All lowercased. `genres` and `genre_edges` are seeded from a committed data
file; `genre_overrides` is the user's to edit from the panel and is the only one
the app writes at runtime.

## Matching and resolution

Two tiers: exact on MBID where both sides have one, then `match_key`.

Normalization is **deliberately conservative** — lowercase, collapsed
whitespace, a trailing `(feat. …)` or `(with …)` dropped, and nothing else.
Folding `(Live)` into the studio cut would destroy a distinction the MBIDs are
there to preserve. It runs in Rust: SQLite's `lower()` is ASCII-only and would
leave Motörhead and Sigur Rós unfolded, and `COLLATE NOCASE` has the same limit.

**Resolution is a rebuild, not bookkeeping.** `plays::resolve` recomputes
`track_id` for every row from two indexed `UPDATE`s, and runs wherever
`tag_values::rebuild` already runs — after a scan, a tag write, an undo, a
removal. The argument is the one
[tag_values.rs](../../src-tauri/src/db/tag_values.rs) makes at length: there is
no drift to detect and no repair path to write.

**This is the plan's one perf risk.** 237k plays re-resolved after a three-track
tag edit is a cost `tag_values::rebuild` does not pay. It gets a budget in
`tests/perf.rs` from the first phase, before any panel depends on it. If it
misses, the fallback is to re-resolve only rows whose `match_key` belongs to a
changed track — correct but with a repair path, which is why it is the fallback
and not the design.

## The genre tree, and where it comes from

The drill-down asked for is Black Metal → Atmospheric Black Metal, Raw Black
Metal. That granularity rules out most sources.

| Source | Verdict |
| --- | --- |
| **Wikidata** | **Taken.** 6,628 items are music genres (`P31/P279* → Q188451`) and 8,384 `subclass of` edges run between them. `Q65937017` *atmospheric black metal* → P279 → `Q132438` *black metal*, referenced to RateYourMusic. Black metal has 27 direct children, among them raw, depressive, atmospheric, symphonic, dissonant, pagan, post-, unblack and war metal. The data is CC0, so it ships with no attribution burden. |
| Metal Archives | Rejected. No official API, no dump, no published licence, and `enmet`, the maintained wrapper, states it is not for building your own database. Nothing here is redistributable. |
| MusicBrainz | Fallback. Has genre-genre `subgenres` / `subgenre of` relationships (type `9d61bc67-fa39-4719-8025-ea056a5bd7e6`), but the web API exposes relationships for every entity type *except* genres, so using it means processing a full database dump. |
| Discogs, AcousticBrainz | Rejected. Two levels. They have "Black Metal", never "Raw Black Metal". |
| Wikipedia prose | Rejected. The same data as Wikidata, unparseable by comparison. |

`scripts/genres.mjs` runs one SPARQL query and writes a committed data file
which its own migration seeds — **the runtime never touches the network**, which the
offline-first rule and the CSP both require. Labels and `skos:altLabel` aliases
both come down, so "DSBM" resolves to depressive black metal.

A library genre string resolves in three layers: **Wikidata label or alias →
suffix derivation → override.** Suffix derivation covers what Wikidata lacks by
treating a genre as a child of any shorter genre its name ends with, longest
match winning; it is guesswork and is labelled as such in the panel, so a wrong
guess is something you can see and fix rather than something you have to trust.

**Multi-parent genres are the wrinkle.** Blackened death metal is a child of
both black metal and death metal, and a donut that puts it under both
double-counts. `genre_edges` keeps the whole DAG so nothing is lost;
`genres.parent` holds one primary parent, picked at generation time as the
lexicographically smallest parent label. That rule is arbitrary and is written
down as arbitrary — nothing makes black metal more the parent than death metal
is — which is what `genre_overrides` exists to correct.

## API facts that shape the import

- **`user.getRecentTracks` needs the `api_key` only**, no session key, and takes
  any username. History import therefore works before an account is connected,
  and for accounts that are not the user's.
- **`limit` caps at 200.** 237,572 scrobbles is **1,188 requests**. Throttled to
  4/s, inside last.fm's 5-per-second average, that is five to six minutes.
- **Page backwards by `to=`, never by `page=`.** Page numbers reorder under a
  long import the moment a new scrobble lands. A descending timestamp cursor is
  stable, and persisted in `settings` it makes the import resumable: killed at
  page 900, it restarts at page 900.
- **`to = oldest_in_page`, inclusive.** The overlap re-fetches a few rows and
  `idx_plays_identity` eats them; the exclusive form silently loses scrobbles
  that share a second.
- **The `nowplaying` entry has no `date`** and is not a play. Skipped.
- `@attr total` and `totalPages` from the first response drive progress.
- **`extended=1`** adds the loved flag and the MBIDs at no extra request cost.

Mechanically it is the shape the codebase already has: a dedicated worker thread
behind `lastfm::transport::Transport`, one transaction per page, progress on
`stats://import` the way a scan reports on `scan://progress`, and bounded,
resumable failure like the scrobble queue's attempt cap. Nothing blocks a
command handler or the scrobbler thread. A new progress channel is consistent
with phase 61 rather than a breach of it: that phase collapsed the *frontend's*
error and notice slots into `useStatusStore`, which is where a failed import
reports, and left each long write its own `…//progress` event.

The surface goes in
[LastfmSettings.tsx](../../src/features/lastfm/LastfmSettings.tsx): username
defaulting to the connected account, Import, progress, the last imported
timestamp, and Re-import from scratch.

## Query layer

`src-tauri/src/db/stats.rs`. Two query types, holding to the smart-playlist
discipline — typed structs and whitelisted fields, never user text concatenated
into SQL.

```rust
pub struct ListenQuery {
    pub range: Option<(i64, i64)>,
    pub artist: Option<String>,
    pub genre: Option<String>,   // the genre and its descendants
    pub album: Option<String>,
    pub owned: Option<bool>,
    pub loved: Option<bool>,
}
```

Library panels take the existing `TrackQuery` instead, so every aggregate goes
through `scope()` and can be scoped to a view or a playlist rather than only to
the whole library.

Aggregates are small independent functions returning small `Vec`s:
`recent_plays`, `top(dimension)`, `plays_over_time(bucket)`, `clock`,
`week_clock`, `streaks`, `firsts`, `coverage`; `quality_histogram`,
`worst_by_bitrate`, `genre_breakdown(parent)`, `added_over_time`,
`untagged_report`.

**No rollup tables.** 237k rows is one indexed `GROUP BY`; a materialized
aggregate would buy nothing and would owe an invalidation path.

**Bucketing is local time** — `datetime(started_at, 'unixepoch', 'localtime')`.
Under UTC, listening at 23:00 lands on tomorrow's Tuesday, which ruins the
hour-of-day panel specifically. DST leaves two irregular days a year;
documented, not corrected.

`sum()` over no rows is NULL, so every aggregate is `coalesce`d — the same trap
`library_stats` already names.

## The view

**`ViewTab` gains `"stats"`.** Statistics becomes a sidebar item like Songs —
the same act, the same highlight — and the placeholder in
[LibraryNav.tsx](../../src/components/ui/LibraryNav.tsx) loses its `disabled`.

Drill state does not fit `HistoryEntry`'s `browse: BrowseFilter | null`, so the
entry gains a field:

```ts
export interface HistoryEntry {
  readonly tab: ViewTab;
  readonly browse: BrowseFilter | null;
  readonly playlistId: number | null;
  readonly stats: StatsPath | null;
}
```

`sameView` compares the path element-wise, so Back and Forward walk a genre
drill-down for free and `record`'s dedupe stops a re-click pushing a duplicate —
the treatment `browse` already gets.

**Filter state lives in its own `statsStore`.** In the library store, a range
change would wake every library subscriber; the App.tsx rule in
[CLAUDE.md](../../CLAUDE.md) says as much. `App` branches on `tab === "stats"`
and renders `StatisticsView`; ranges, facets and loaded aggregates are
subscribed inside the panels that draw them, which is the lesson
[frontend.md](../knowledge/frontend.md) already paid for with `positionMs` and
`selection`.

The filter bar's contents follow the tab:

| Listening | Library |
| --- | --- |
| Range: all time / this year / last 12 months / this month / last 7 days / custom | Scope: whole library / current view / a playlist |
| Facet chips pushed by the drill-down (artist, genre, album) | Genre facet |
| Owned · Loved toggles | — |

The range persists in `settings`, the way a column layout does. The drill path
does not — that is what history is for.

**A plays table is not a `SongTable`.** Its rows are plays, and it needs no
selection, no drag, no column config and no row menu. Separate, small,
virtualized. Rule of three is nowhere near met.

## Chart primitives

```
src/components/charts/
  scales.ts       -- the only file importing d3-scale / d3-shape
  ChartFrame.tsx  -- ResizeObserver measure, axes, empty and loading states
  Bar.tsx  Line.tsx  Donut.tsx  Heatmap.tsx  Sparkline.tsx  StatTile.tsx
  Tooltip.tsx
```

`Heatmap` serves the weekday-by-hour grid and the calendar year alike — one
component, two domains. Colours are tokens only, so the contrast rule holds by
construction rather than by inspection. Charts are pure functions of their props
and hold no virtualizer, so unlike `SongTable` and `BrowseView` they compile
clean and want no `"use no memo"`.

Measurement follows `BrowseView`'s hard-won rule: **measure the `<section>`, not
the scroll container**, and measure into state through a `ResizeObserver` rather
than reading a ref during render.

## Panels

**Listening.** Tiles: plays, distinct artists / albums / tracks, listening days,
time spent, share owned. Then recent plays; top artists, albums, tracks and
genres as bar lists with share; plays over time, bucket chosen from the range;
hour-of-day bars; a weekday-by-hour heatmap; a calendar year heatmap; new
artists per month; current and longest streak; and **heard, never owned**,
exportable. An artist bar drills to that artist's page — first heard, total
plays, top tracks, plays over time, albums.

**Library.** Tiles: tracks, artists, albums, bytes, duration, missing. Then a
bitrate histogram; a sample-rate breakdown; **albums by mean bitrate ascending,
exportable to CSV**, which is the re-download list; the genre donut with
drill-down and override editing; release years and decades; library growth over
time; a duration distribution; and tag health as per-field missing counts, each
row a link into the filtered Songs table.

## Testing

- `plays::match_key` and the three-layer genre resolution are pure functions
  with tables of cases — the Motörhead, `(feat. …)` and DSBM examples above are
  the tests.
- The import is tested against a mocked `Transport`, as every last.fm phase
  already is: a resumed cursor, a duplicated boundary page, a `nowplaying`
  entry, a mid-import failure, and a page whose oldest rows share a second.
- `tests/perf.rs` gets budgets for `plays::resolve` and for each aggregate at
  237k rows, seeded synthetically like the existing 150k-row fixtures.
- Charts assert geometry — `path` commands and `rect` extents — never pixels.
- Panels get `role="img"` with a generated summary label, and a show-as-table
  toggle where the numbers matter more than the shape.
- e2e screenshots for both tabs, a drilled genre donut and the weekday heatmap.

## Steps

**Migration numbers are not reserved here.** Migrations are append-only and
numbered by the order they land, and 9 has since gone to
[79a](../issues/done/79a-per-track-edits-and-the-release-mbid.md) with 10 and 11
spoken for by [82b](../issues/done/82b-the-unattended-lookup-pass.md) and
[83a](../issues/upcoming/83a-where-a-file-goes.md). Each phase below takes
whatever number is next when it lands.

These phases interleave with the issues in
[upcoming/](../issues/upcoming/), which share one order: dependencies first,
then simplest first. The gaps below are those issues.

| # | Phase | Depends on |
| --- | --- | --- |
| 70 | Chart primitives and `scales.ts` | — |
| 75 | Genre tree — `scripts/genres.mjs`, its migration, overrides | — |
| 76 | Play log — its migration, local writes, matching, `plays::resolve`, perf budget | — |
| 77 | Query layer — `db/stats.rs`, `ListenQuery`, IPC types | 76 |
| 78 | last.fm history import — worker, cursor, progress, settings surface | 76 |
| 80 | Statistics shell — sidebar, tabs, filter bar, `StatsPath` history, CSV export | 70, 77 |
| 84a | Listening panels | 78, 80 |
| 84b | Library panels | 75, 80 |

70, 75 and 76 are independent and belong in parallel worktrees. 77 and 78 both
stack on 76; 80 waits on 70 and 77. **84 split into a phase per tab when the
issues were written**, which is the split this document expected, and the two
halves turn out to share only the chart primitives — the library tab needs
neither the play log nor the import.

## Open, and deliberately so

- **Which panels earn their place** is answered by using them, not by this
  document. 84a and 84b are both expected to drop some of the list above.
- **CSV export mechanics** — whether the panels' row exports reuse `export/`'s
  generator and `export://progress` or get a smaller path of their own — is
  decided in 80, when there is a first export to shape it.
- **The primary-parent rule** may not survive contact with a real library. It is
  one column, generated by one script, and `genre_overrides` covers the gap in
  the meantime.
