# 76 — The play log

One row per play, which this build has never had. `tracks.play_count` and
`tracks.last_played_at` are an aggregate and a single timestamp, and every
drill-down in [plans/statistics.md](../../plans/statistics.md) — the last fifty
songs, an hour-of-day heatmap, which artist you played on a given Tuesday —
needs the rows. `scrobble_queue` is the right shape and the wrong thing: it is a
drain queue, emptied on success.

Depends on nothing. [77](77-the-stats-query-layer.md) and
[78](78-import-the-lastfm-history.md) both stack on it.

## The migration

Next free number when it lands.

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

**The text columns are the play**, for the reason `scrobble_queue` gives: a play
is a fact about a moment, and the row it came from can be retagged or deleted
afterwards. `track_id` is the one derived field, which is why it is the one
thing carrying a foreign key — deleting a file forgets the link and keeps the
play.

**`idx_plays_identity` is the dedupe rule, and it is exact rather than fuzzy.**
`Event::Played` carries the second the track *started*, derived from
`now - position_ms` because anything else is wrong after a pause or a seek; the
scrobbler sends that integer to last.fm and last.fm hands it back. 78 is
therefore `INSERT OR IGNORE`, and a play made in this app cannot be counted
twice. It follows that `source` means *which writer got there first*, not where
you were listening — a comment at the column, because it reads like the other
thing.

`tracks.mbid` fills from the MusicBrainz frames many rips carry, on the existing
`tags::read` path.

**Local writes happen whether or not a last.fm account is connected**, on the
same `Event::Played` the scrobbler already listens to. The history then survives
disconnecting, a revoked session key, or last.fm going away.

**`play_count` and `last_played_at` stay and are not backfilled.** Only the most
recent play is recoverable from them, and manufacturing timestamps for the rest
would put invented data in the table the whole feature reads.

## Matching

Two tiers: exact on MBID where both sides have one, then `match_key`.

Normalization is **deliberately conservative** — lowercase, collapsed
whitespace, a trailing `(feat. …)` or `(with …)` dropped, nothing else. Folding
`(Live)` into the studio cut destroys a distinction the MBIDs exist to preserve.
It runs in Rust: SQLite's `lower()` is ASCII-only and would leave Motörhead and
Sigur Rós unfolded, and `COLLATE NOCASE` has the same limit.

**Resolution is a rebuild, not bookkeeping.** `plays::resolve` recomputes
`track_id` for every row from two indexed `UPDATE`s and runs wherever
`tag_values::rebuild` already runs — after a scan, a tag write, an undo, a
removal. The argument is the one [tag_values.rs](../../../src-tauri/src/db/tag_values.rs)
makes at length: no drift to detect, no repair path to write.

**This is the plan's one perf risk**, and the reason it is answered in this
phase rather than a later one. 237k plays re-resolved after a three-track tag
edit is a cost `tag_values::rebuild` does not pay. It gets a budget in
`tests/perf.rs` here, before any panel depends on it. If it misses, the fallback
is to re-resolve only rows whose `match_key` belongs to a changed track —
correct, but with a repair path, which is why it is the fallback and not the
design.

Testing: `match_key` is table-driven — Motörhead, Sigur Rós, a `(feat. …)`
suffix asserted dropped and a `(Live)` suffix asserted kept. Resolution over a
seeded database: an MBID hit preferred over a key hit, a play with no matching
file asserted `track_id IS NULL`, a deleted track asserted to leave its plays
standing, a retag asserted to re-point them. `tests/perf.rs` gets the
`plays::resolve` budget at 237k rows, seeded through `db::synthetic`.
