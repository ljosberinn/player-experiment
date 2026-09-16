# 76 — The play log

One row per play, which this build has never had. `tracks.play_count` and
`tracks.last_played_at` are an aggregate and a single timestamp, and every
drill-down in [plans/statistics.md](../../plans/statistics.md) — the last fifty
songs, an hour-of-day heatmap, which artist you played on a given Tuesday —
needs the rows. `scrobble_queue` is the right shape and the wrong thing: it is a
drain queue, emptied on success.

Depends on nothing. [77](77-the-stats-query-layer.md) and
[78](78-import-the-lastfm-history.md) both stack on it.

## Migration 12

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
    match_key    TEXT NOT NULL,      -- normalized artist + title
    track_id     INTEGER REFERENCES tracks(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX idx_plays_identity ON plays(started_at, match_key);
CREATE INDEX idx_plays_started ON plays(started_at);
CREATE INDEX idx_plays_track   ON plays(track_id, started_at);
```

**The text columns are the play**, for the reason `scrobble_queue` gives: a play
is a fact about a moment, and the row it came from can be retagged or deleted
afterwards. `track_id` is the one derived field, which is why it is the one
thing carrying a foreign key — deleting a file forgets the link and keeps the
play.

**`idx_plays_identity` is the dedupe rule, and it is exact rather than fuzzy.**
`Event::Played` carries the second the track started, recorded at load rather
than derived from `now - position_ms`, which
[engine.rs](../../../src-tauri/src/audio/engine.rs) explains is wrong for any
track that was paused or seeked. The scrobbler sends that integer to last.fm and
last.fm hands it back. 78 is therefore `INSERT OR IGNORE`, and a play made in
this app cannot be counted twice. It follows that `source` means *which writer
got there first*, not where you were listening — a comment at the column,
because it reads like the other thing.

`artist_mbid` and `track_mbid` are written by 78 and read by nothing in this
phase. They are here rather than in 78's migration because they are part of what
a play is, not part of importing one.

**No `loved` column.** Loved is the current state of a track, not a fact about a
moment: under `INSERT OR IGNORE` an imported value would freeze at whatever the
first import saw, and every local row would read `0` forever. A loved set keyed
by `match_key`, from `user.getLovedTracks`, belongs to whichever of
[78](78-import-the-lastfm-history.md) or [84a](84a-what-you-have-heard.md)
first needs it.

**No MBID column on `tracks`.** The matching tier that would use one matches
nothing until 78 lands rows carrying MBIDs, and it is not free: `tracks` has
`release_mbid` and `release_group_mbid` already, the id wanted here is the
*recording* id, and nothing reads `ItemKey::MusicBrainzRecordingId` today — so
it is a `Tags` field, a `tags::read`, an entry in
[write.rs](../../../src-tauri/src/tags/write.rs)'s TXXX preservation list, a
scan ingest and a round-trip test. That work ships with the data that makes it
worth anything, in 78.

**`play_count` and `last_played_at` stay and are not backfilled.** Only the most
recent play is recoverable from them, and manufacturing timestamps for the rest
would put invented data in the table the whole feature reads.

## Writing a play

**Local writes happen whether or not a last.fm account is connected**, on the
same `Event::Played` the scrobbler already listens to — and in the same
transaction as `playback::mark_played`, so the count and the log cannot disagree
about what was played.

The event carries `track_id` and `started_at` only, so the row is snapshotted
from `tracks` at that moment. **The log does not inherit the scrobbler's rules.**
`Service::prepare` refuses a track with no artist and a track too short for
last.fm; those are last.fm's conditions for accepting a scrobble, not this app's
for remembering one.

**A missing tag is an empty string, and an empty `match_key` never resolves.**
`plays.artist` is `NOT NULL` against a nullable `tracks.artist`, and a key built
from nothing would match every untagged file in the library. The play is kept
and stays unmatched: it counts in the time and calendar panels, and 77's
`coverage` is what keeps it from being reported as a genre gap.

## Matching

`match_key` normalization is **deliberately conservative** — lowercase,
collapsed whitespace, a trailing `(feat. …)` or `(with …)` dropped, nothing
else. Folding `(Live)` into the studio cut destroys a distinction the MBIDs
exist to preserve. It runs in Rust: SQLite's `lower()` is ASCII-only and would
leave Motörhead and Sigur Rós unfolded, and `COLLATE NOCASE` has the same limit.

**Resolution is a rebuild, not bookkeeping.** `plays::resolve` recomputes
`track_id` for every row and runs wherever `tag_values::rebuild` already runs —
after a scan, a tag write, an undo, a removal. The argument is the one
[tag_values.rs](../../../src-tauri/src/db/tag_values.rs) makes at length: no
drift to detect, no repair path to write.

**The key is not stored on `tracks`.** It cannot be: normalization is Rust-side,
so a `tracks.match_key` column has to be filled at every site that writes a
track row — the ordering dependency `tag_values` exists to refuse — or
recomputed over the whole library on each rebuild, which costs more than the
thing it was meant to make cheap. Instead `resolve` reads `id, artist, title`,
normalizes in Rust, materializes a temporary `keys(key PRIMARY KEY, track_id)`,
and runs one `UPDATE` over `plays` against it.

**The `UPDATE` is guarded by `WHERE track_id IS NOT (SELECT …)`.** This is what
makes the plan's one perf risk affordable: after a three-track tag edit the
statement still scans `plays`, but writes only the handful of rows whose link
actually moved, instead of rewriting 237k rows to the values they already held.
`IS NOT` rather than `<>` because most of those values are NULL on both sides.

It still gets a budget in `tests/perf.rs` here, before any panel depends on it:
**one full `resolve` over 250k plays and 10k tracks, under 3000ms.** Loose on
purpose, and against the CI runner rather than a developer machine — the spread
[perf.rs](../../../src-tauri/tests/perf.rs) already records is roughly tenfold,
and the budget is there to catch a change of shape. If it misses anyway, the fallback is
to re-resolve only the keys a write touched — correct, but with an ordering
dependency on every caller, which is why it is the fallback and not the design.

`db::synthetic` gains `seed_plays`, which `tests/perf.rs` and 77's budgets both
need: `seed` writes `tracks` and nothing has ever written a play. Keys are
generated so that some hit the seeded library and some cannot, because a seed
that matched everything would make `coverage` untestable and `resolve` look
fast for the wrong reason.

## Testing

`match_key` is table-driven — Motörhead, Sigur Rós, a `(feat. …)` suffix
asserted dropped, a `(Live)` suffix asserted kept, and an empty artist asserted
to produce a key `resolve` skips.

Resolution over a seeded database: a play with no matching file asserted
`track_id IS NULL`, a deleted track asserted to leave its plays standing, a
retag asserted to re-point them, and a second `resolve` over an unchanged
library asserted to write nothing.

The write path: a played track asserted to land one row with the count it was
snapshotted from, an untagged track asserted logged and unmatched, and a play
asserted written with no last.fm account connected.

## Documentation

`docs/plans/statistics.md` numbers the play log migration 10 and the genre tree
9; both are wrong now, and its schema block carries the `loved` and
`tracks.mbid` columns this phase drops. The migration table in
[data-model.md](../../knowledge/data-model.md) gains row 12.
