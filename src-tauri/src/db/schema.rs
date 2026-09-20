//! Versioned migrations.
//!
//! Each entry is applied in order inside a transaction, and `PRAGMA
//! user_version` records how far we got. Migrations are append-only: never
//! edit a shipped one, add a new entry instead.
//!
//! Once, before v1: the tag-edit undo journal was migration 3 and 82a deleted
//! the entry rather than adding one that drops the table, so the numbering
//! shifted under every database in existence and `migrate` refuses them all.
//! That is only survivable while the fix is "delete the file and rescan", so
//! the rule stands and this stays the exception.

pub const MIGRATIONS: &[&str] = &[
    // 1 - initial library schema
    r#"
CREATE TABLE covers (
    hash  TEXT PRIMARY KEY,
    mime  TEXT NOT NULL,
    bytes BLOB NOT NULL
);

CREATE TABLE tracks (
    id             INTEGER PRIMARY KEY,
    path           TEXT NOT NULL UNIQUE,
    mtime          INTEGER NOT NULL,
    size           INTEGER NOT NULL,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    title          TEXT,
    artist         TEXT,
    album          TEXT,
    album_artist   TEXT,
    genre          TEXT,
    year           INTEGER,
    track_no       INTEGER,
    disc_no        INTEGER,
    comment        TEXT,
    bitrate        INTEGER,
    sample_rate    INTEGER,
    cover_hash     TEXT REFERENCES covers(hash),
    added_at       INTEGER NOT NULL,
    play_count     INTEGER NOT NULL DEFAULT 0,
    last_played_at INTEGER
);

CREATE INDEX idx_tracks_album  ON tracks(album_artist, album, disc_no, track_no);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_year   ON tracks(year);
CREATE INDEX idx_tracks_added  ON tracks(added_at);

CREATE TABLE playlists (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('static', 'smart')),
    filter_json  TEXT,
    sort_json    TEXT,
    columns_json TEXT,
    created_at   INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE INDEX idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE watch_folders (
    id    INTEGER PRIMARY KEY,
    path  TEXT NOT NULL UNIQUE
);
"#,
    // 2 - full text search over the columns the search box covers
    r#"
CREATE VIRTUAL TABLE tracks_fts USING fts5(
    title, artist, album, album_artist, genre, comment,
    content='tracks',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER tracks_fts_insert AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre, comment)
    VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;

CREATE TRIGGER tracks_fts_delete AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre, comment)
    VALUES ('delete', old.id, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
END;

CREATE TRIGGER tracks_fts_update AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre, comment)
    VALUES ('delete', old.id, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
    INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre, comment)
    VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;
"#,
    // 3 - a file that is gone is marked, not deleted
    //
    // Until now a scan deleted the rows of files it could not find, which made
    // an unplugged external drive indistinguishable from a deliberate deletion
    // and took every playlist entry pointing at those files with it - beyond
    // recovery, since a later rescan re-adds the file as a new row with a new
    // id. Marking makes that a temporary condition instead.
    //
    // Null means present. The value is when it was first noticed missing, not
    // when it was last seen: a rescan that still cannot find the file leaves
    // the timestamp alone.
    //
    // The index is partial, so it costs one entry per missing file rather than
    // one per track - the "are any missing" question is asked on every stats
    // refresh, and in a healthy library the answer is none.
    r#"
ALTER TABLE tracks ADD COLUMN missing_since INTEGER;

CREATE INDEX idx_tracks_missing ON tracks(missing_since) WHERE missing_since IS NOT NULL;
"#,
    // 4 - the vocabulary a library already uses
    //
    // Autocompletion needs the distinct values of a handful of fields, ranked
    // by how many tracks carry each one. `SELECT DISTINCT artist FROM tracks`
    // over 50k rows on every keystroke is not viable, so the answer gets its
    // own table.
    //
    // `uses` is what makes the suggestions useful rather than merely present:
    // the spelling on 400 tracks outranks the typo made once, and a value that
    // falls to zero tracks is dropped, so a corrected typo stops being offered.
    //
    // WITHOUT ROWID because the primary key *is* the row - there is no payload
    // beyond `uses`, so a separate rowid would be pure overhead.
    //
    // The NOCASE index is what the lookup actually uses: suggestions match
    // case-insensitively, because someone typing "godspeed" wants the band.
    //
    // The table is backfilled here rather than left empty for the next scan to
    // fill. An existing library is exactly the case autocompletion is *for* -
    // it is the one with a vocabulary worth suggesting - and leaving it empty
    // would mean the feature silently does nothing on every machine that
    // already has a library, until someone happens to rescan. These are the
    // same five aggregates `tag_values::rebuild` runs, spelled out because a
    // migration is SQL and must not depend on Rust that can be refactored
    // later.
    r#"
CREATE TABLE tag_values (
    field TEXT    NOT NULL,
    value TEXT    NOT NULL,
    uses  INTEGER NOT NULL,
    PRIMARY KEY (field, value)
) WITHOUT ROWID;

CREATE INDEX idx_tag_values_lookup ON tag_values(field, value COLLATE NOCASE);

INSERT INTO tag_values (field, value, uses)
    SELECT 'artist', CAST(artist AS TEXT), count(*) FROM tracks
    WHERE artist IS NOT NULL AND trim(CAST(artist AS TEXT)) <> ''
    GROUP BY CAST(artist AS TEXT);

INSERT INTO tag_values (field, value, uses)
    SELECT 'album_artist', CAST(album_artist AS TEXT), count(*) FROM tracks
    WHERE album_artist IS NOT NULL AND trim(CAST(album_artist AS TEXT)) <> ''
    GROUP BY CAST(album_artist AS TEXT);

INSERT INTO tag_values (field, value, uses)
    SELECT 'album', CAST(album AS TEXT), count(*) FROM tracks
    WHERE album IS NOT NULL AND trim(CAST(album AS TEXT)) <> ''
    GROUP BY CAST(album AS TEXT);

INSERT INTO tag_values (field, value, uses)
    SELECT 'genre', CAST(genre AS TEXT), count(*) FROM tracks
    WHERE genre IS NOT NULL AND trim(CAST(genre AS TEXT)) <> ''
    GROUP BY CAST(genre AS TEXT);

INSERT INTO tag_values (field, value, uses)
    SELECT 'year', CAST(year AS TEXT), count(*) FROM tracks
    WHERE year IS NOT NULL AND trim(CAST(year AS TEXT)) <> ''
    GROUP BY CAST(year AS TEXT);
"#,
    // 5 - the colours a cover is made of
    //
    // For the background that follows the music: three dominant colours per
    // cover, extracted once when the bytes are stored and read back with the
    // player snapshot. See `crate::palette` for how they are found and
    // `db::covers` for when.
    //
    // JSON rather than three integer columns, or nine. The value is opaque to
    // SQL - nothing filters, sorts or aggregates on a colour - and one text
    // column is one thing to migrate if the palette ever grows a fourth entry.
    //
    // No backfill, unlike migration 4. The rename in phase 32 orphaned every
    // existing data directory, so in practice every install starts with an
    // empty `covers`; a database carried over from before simply has null
    // palettes, and each cover gets one the next time a scan or a tag write
    // sees it. Decoding every cover in a large library inside a migration -
    // which runs in one transaction, before the window is shown - is the wrong
    // trade for artwork the user may never play.
    r#"
ALTER TABLE covers ADD COLUMN palette TEXT;
"#,
    // 6 - plays waiting to reach last.fm
    //
    // The resolved scrobble rather than a track id, on purpose: a play is a
    // historical fact about what was on at a moment, and the row it came from
    // can be retagged or removed from the library before the queue drains.
    // Sending whatever the tags say today would report something that never
    // happened.
    //
    // `next_try_at` is unix seconds, and zero means "now" - a fresh row is due
    // immediately, and only a failed attempt pushes it into the future. The
    // index is on it because draining asks "what is due" and nothing else, and
    // `id` is the tiebreak so a batch goes out oldest first.
    //
    // No foreign key to `tracks`, for the same reason the columns are copied.
    r#"
CREATE TABLE scrobble_queue (
    id          INTEGER PRIMARY KEY,
    artist      TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    album       TEXT,
    duration_ms INTEGER NOT NULL,
    started_at  INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    next_try_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_scrobble_queue_due ON scrobble_queue(next_try_at, id);
"#,
    // 7 - the files the user has said they do not want
    //
    // Removing a row is not enough on its own: `scan::plan` adds every audio
    // file under a watch folder it does not already know, so a removal with no
    // record behind it lasts until the next Rescan. A tombstoned path is
    // skipped by the scan, and File ▸ Forget Removed Songs drops the
    // tombstones so a rescan re-adds them.
    //
    // Keyed on the path rather than on anything about the file, because the
    // row is gone and the path is all that is left - and it is the same string
    // `load_known` matches `tracks.path` on, so case behaves here exactly as
    // it already does there.
    //
    // Only an explicit per-row removal writes one. `remove_missing` does not:
    // a drive coming back should restore what was on it, which is what
    // migration 3 exists for.
    r#"
CREATE TABLE removed_paths (
    path       TEXT PRIMARY KEY,
    removed_at INTEGER NOT NULL
);
"#,
    // 8 - which release a file belongs to
    //
    // Both MusicBrainz identifiers, cached off the tags the same way every
    // other column here is: `tags::read` fills them, so a rescan keeps them
    // in step with the file rather than the writer being their only source.
    //
    // They are two different things and both are needed. The release id is per
    // pressing, which is what a re-lookup and the Cover Art Archive are keyed
    // by; the release group is the album across its pressings, which is what
    // the browse view has to group by or two rips of one album are two tiles.
    //
    // Only the release group is indexed, because only it is grouped on. The
    // release id is read back per row, and an index on a column that is null
    // for most of the library would cost writes to serve no query.
    //
    // No backfill: nothing has ever written these, so every existing row is
    // null by definition and the values arrive as files are read.
    r#"
ALTER TABLE tracks ADD COLUMN release_mbid TEXT;
ALTER TABLE tracks ADD COLUMN release_group_mbid TEXT;

CREATE INDEX idx_tracks_release_group ON tracks(release_group_mbid)
    WHERE release_group_mbid IS NOT NULL;
"#,
    // 9 - what the unattended lookup pass has already been through
    //
    // One row per release key, and three jobs in one table: the review queue,
    // the resume point a pass killed mid-run starts from, and the guard that
    // stops a second pass re-searching 8,044 releases. No row means never
    // attempted; a row is never revisited automatically, because a pass that
    // re-searched every miss on every launch would be the best part of a day
    // that finds nothing, forever.
    //
    // The key is `db::query`'s two grouping expressions, so a release is the
    // same thing here as it is in the grid. A `PRIMARY KEY (album, artist)`
    // will not hold it: SQLite permits NULLs in a rowid table's primary key,
    // so an untagged release would insert twice. The unique index over the
    // coalesced pair is what actually holds, and both sides collate NOCASE
    // because the grid has folded case when grouping since phase 81 - unfolded,
    // a release tagged two ways is one tile and two rows here.
    //
    // `candidates_json` is a cache, not a record: the pass has the search
    // results in hand at the moment it queues a release, and a review dialog
    // opening on them is the difference between a click and a rate-limited
    // second per entry.
    //
    // `release_type` is MusicBrainz's release-group primary type, cached off
    // the tags the way migration 8's two ids are: `tags::read` fills it, so a
    // rescan keeps it in step with the file rather than the writer being its
    // only source. No backfill - nothing has ever written it.
    r#"
ALTER TABLE tracks ADD COLUMN release_type TEXT;

CREATE TABLE release_lookup (
    id              INTEGER PRIMARY KEY,
    album           TEXT,
    artist          TEXT,
    status          TEXT NOT NULL CHECK (status IN ('resolved', 'review', 'none')),
    release_mbid    TEXT,
    score           REAL,
    candidates_json TEXT,
    attempted_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_release_lookup_key ON release_lookup(
    coalesce(album,  '') COLLATE NOCASE,
    coalesce(artist, '') COLLATE NOCASE
);
"#,
    // 10 - a fourth status, for a queued release the user wants left alone
    //
    // Skipping in 82c's review queue means "not now": the entry stays and is
    // offered again. "Leave this alone" is a decision of its own, and a queue
    // that cannot express it is a queue whose count never reaches zero.
    //
    // A whole-table rebuild because the vocabulary is a CHECK constraint and
    // SQLite has no way to widen one in place. Nothing else about the table
    // changes, and no row's status does either.
    r#"
CREATE TABLE release_lookup_new (
    id              INTEGER PRIMARY KEY,
    album           TEXT,
    artist          TEXT,
    status          TEXT NOT NULL CHECK (status IN ('resolved', 'review', 'none', 'aside')),
    release_mbid    TEXT,
    score           REAL,
    candidates_json TEXT,
    attempted_at    INTEGER NOT NULL
);

INSERT INTO release_lookup_new
    (id, album, artist, status, release_mbid, score, candidates_json, attempted_at)
SELECT id, album, artist, status, release_mbid, score, candidates_json, attempted_at
  FROM release_lookup;

DROP TABLE release_lookup;
ALTER TABLE release_lookup_new RENAME TO release_lookup;

CREATE UNIQUE INDEX idx_release_lookup_key ON release_lookup(
    coalesce(album,  '') COLLATE NOCASE,
    coalesce(artist, '') COLLATE NOCASE
);
"#,
    // 11 - the genre tree
    //
    // Black metal -> atmospheric black metal, raw black metal: the hierarchy
    // 84b's donut drills through. From Wikidata, which is the only source with
    // that granularity and a licence that lets it ship; the alternatives are
    // argued out in docs/plans/statistics.md.
    //
    // Everything is a lowercased label rather than a QID, because the thing
    // being resolved is a genre string out of an ID3 tag and there is no QID on
    // that side. `db::genres` normalises a tag the same way before looking it
    // up.
    //
    // The seed data is `concat!`ed in from a generated file rather than typed
    // here: 6,575 genres is not something to maintain by hand, and keeping it
    // out of this file leaves the migration readable. It is still SQL, and
    // still frozen at compile time, so this migration cannot change under a
    // database that has already run it.
    //
    // `genres.parent` is one primary parent for the drill-down to walk;
    // `genre_edges` keeps the whole subclass DAG, because blackened death metal
    // is a child of both black metal and death metal and a donut that puts it
    // under both double-counts. **Which of several parents becomes the primary
    // one is arbitrary** - the generator takes the lexicographically smallest
    // label - and `genre_overrides` is what makes that affordable.
    //
    // No foreign keys between the three seeded tables. `genres.parent` points
    // into `genres` and the rows arrive alphabetically, so a self-referential
    // key would have to be deferred to survive its own seed - a constraint that
    // only holds at commit time, guarding data that arrives correct by
    // construction from a generator. `genre_overrides.parent` does get one:
    // that table is written at runtime, by hand, and a parent nothing knows is
    // a branch the donut cannot draw.
    //
    // WITHOUT ROWID throughout, for the reason `tag_values` has it: the primary
    // key *is* the row here, so a separate rowid is pure overhead.
    concat!(
        r#"
CREATE TABLE genres (
    label  TEXT PRIMARY KEY,
    parent TEXT
) WITHOUT ROWID;

CREATE TABLE genre_edges (
    child  TEXT NOT NULL,
    parent TEXT NOT NULL,
    PRIMARY KEY (child, parent)
) WITHOUT ROWID;

CREATE TABLE genre_aliases (
    alias TEXT PRIMARY KEY,
    label TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE genre_overrides (
    label  TEXT PRIMARY KEY,
    parent TEXT REFERENCES genres(label)
) WITHOUT ROWID;

-- The drill-down's question is "children of this genre", in both directions of
-- the tree: down the primary parent for what the donut draws, and across the
-- DAG for what a genre is also filed under.
CREATE INDEX idx_genres_parent      ON genres(parent);
CREATE INDEX idx_genre_edges_parent ON genre_edges(parent);
"#,
        include_str!("../../data/genres.sql")
    ),
    // 12 - one file is one row, whatever it is spelled like
    //
    // `tracks.path TEXT NOT NULL UNIQUE` compared component bytes, on a
    // filesystem that folds case. The release whose directory is called
    // `The Corpse Of Rebirth` while its tags compute `The Corpse of Rebirth`
    // was two paths here and one directory to NTFS, which is what turned one
    // file into two rows and offered the release to the mover on every sweep,
    // forever. See 82i.
    //
    // NOCASE is ASCII-only, the limit 81 records. `library::layout::same`
    // folds past ASCII since 94 - the filesystem does - so a pair differing by
    // `Ü`/`ü` is one path there and two here. This half only has to agree with
    // itself: it decides which row owns a path, not where a file goes.
    //
    // **The fold and the merge are one migration**: rows that were distinct
    // byte-exact collide under it - in the library this was written against,
    // 492 of them - so the rebuild cannot be applied around them. The survivor
    // is the row whose file is still there, because the other one is what the
    // move left behind. It takes the higher `play_count`, the earlier
    // `added_at` and the playlist places of the row it absorbs, so nothing the
    // user did to either is lost. Rows that collide with nothing are left
    // exactly as they are: a missing row is also an unplugged drive, and no
    // migration may decide that.
    r#"
CREATE INDEX idx_tracks_path_fold ON tracks(path COLLATE NOCASE);

CREATE TABLE tracks_merge (
    absorbed INTEGER PRIMARY KEY,
    keeper   INTEGER NOT NULL
);

INSERT INTO tracks_merge (absorbed, keeper)
SELECT t.id,
       (SELECT k.id FROM tracks k
         WHERE k.path = t.path COLLATE NOCASE
         ORDER BY k.missing_since IS NOT NULL, k.id
         LIMIT 1)
  FROM tracks t;

DELETE FROM tracks_merge WHERE absorbed = keeper;

-- Zero rather than NULL through the comparison: `last_played_at` is unix
-- seconds and never played is the smaller of the two either way.
UPDATE tracks SET
    play_count = max(play_count,
        (SELECT max(a.play_count) FROM tracks a
           JOIN tracks_merge m ON m.absorbed = a.id
          WHERE m.keeper = tracks.id)),
    added_at = min(added_at,
        (SELECT min(a.added_at) FROM tracks a
           JOIN tracks_merge m ON m.absorbed = a.id
          WHERE m.keeper = tracks.id)),
    last_played_at = nullif(max(coalesce(last_played_at, 0),
        coalesce((SELECT max(a.last_played_at) FROM tracks a
                    JOIN tracks_merge m ON m.absorbed = a.id
                   WHERE m.keeper = tracks.id), 0)), 0)
  WHERE id IN (SELECT keeper FROM tracks_merge);

-- OR IGNORE for the playlist that already holds the surviving row: the entry
-- is the same place twice, and the DELETE below takes the one left behind.
UPDATE OR IGNORE playlist_tracks
   SET track_id = (SELECT keeper FROM tracks_merge WHERE absorbed = track_id)
 WHERE track_id IN (SELECT absorbed FROM tracks_merge);

DELETE FROM playlist_tracks WHERE track_id IN (SELECT absorbed FROM tracks_merge);

-- Before the rebuild, so `tracks_fts_delete` is still on the table to take
-- these rows out of the search index.
DELETE FROM tracks WHERE id IN (SELECT absorbed FROM tracks_merge);

DROP TABLE tracks_merge;
DROP INDEX idx_tracks_path_fold;

CREATE TABLE tracks_new (
    id                 INTEGER PRIMARY KEY,
    path               TEXT NOT NULL COLLATE NOCASE UNIQUE,
    mtime              INTEGER NOT NULL,
    size               INTEGER NOT NULL,
    duration_ms        INTEGER NOT NULL DEFAULT 0,
    title              TEXT,
    artist             TEXT,
    album              TEXT,
    album_artist       TEXT,
    genre              TEXT,
    year               INTEGER,
    track_no           INTEGER,
    disc_no            INTEGER,
    comment            TEXT,
    bitrate            INTEGER,
    sample_rate        INTEGER,
    cover_hash         TEXT REFERENCES covers(hash),
    added_at           INTEGER NOT NULL,
    play_count         INTEGER NOT NULL DEFAULT 0,
    last_played_at     INTEGER,
    missing_since      INTEGER,
    release_mbid       TEXT,
    release_group_mbid TEXT,
    release_type       TEXT
);

-- The ids come across unchanged: `tracks_fts` is an external content table
-- keyed by them, and `playlist_tracks` points at them.
INSERT INTO tracks_new
    (id, path, mtime, size, duration_ms, title, artist, album, album_artist, genre, year,
     track_no, disc_no, comment, bitrate, sample_rate, cover_hash, added_at, play_count,
     last_played_at, missing_since, release_mbid, release_group_mbid, release_type)
SELECT id, path, mtime, size, duration_ms, title, artist, album, album_artist, genre, year,
       track_no, disc_no, comment, bitrate, sample_rate, cover_hash, added_at, play_count,
       last_played_at, missing_since, release_mbid, release_group_mbid, release_type
  FROM tracks;

DROP TABLE tracks;
ALTER TABLE tracks_new RENAME TO tracks;

CREATE INDEX idx_tracks_album  ON tracks(album_artist, album, disc_no, track_no);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_year   ON tracks(year);
CREATE INDEX idx_tracks_added  ON tracks(added_at);
CREATE INDEX idx_tracks_missing ON tracks(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX idx_tracks_release_group ON tracks(release_group_mbid)
    WHERE release_group_mbid IS NOT NULL;

CREATE TRIGGER tracks_fts_insert AFTER INSERT ON tracks BEGIN
    INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre, comment)
    VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;

CREATE TRIGGER tracks_fts_delete AFTER DELETE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre, comment)
    VALUES ('delete', old.id, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
END;

CREATE TRIGGER tracks_fts_update AFTER UPDATE ON tracks BEGIN
    INSERT INTO tracks_fts(tracks_fts, rowid, title, artist, album, album_artist, genre, comment)
    VALUES ('delete', old.id, old.title, old.artist, old.album, old.album_artist, old.genre, old.comment);
    INSERT INTO tracks_fts(rowid, title, artist, album, album_artist, genre, comment)
    VALUES (new.id, new.title, new.artist, new.album, new.album_artist, new.genre, new.comment);
END;
"#,
    // 13 - one row per play
    //
    // `tracks.play_count` and `tracks.last_played_at` are an aggregate and one
    // timestamp, and every drill-down in the statistics plan - the last fifty
    // songs, an hour-of-day heatmap, which artist you played on a Tuesday -
    // needs the rows themselves. `scrobble_queue` is the right shape and the
    // wrong thing: it is a drain queue, emptied on success.
    //
    // The text columns are the play, for the reason migration 6 gives about
    // the queue: a play is a fact about a moment, and the row it came from can
    // be retagged or deleted afterwards. `track_id` is the one derived field,
    // which is why it is the one thing carrying a foreign key - deleting a
    // file forgets the link and keeps the play.
    //
    // `source` is which writer got there first, not where you were listening:
    // the import in 78 writes `lastfm` for history this app never saw, and a
    // play it already holds keeps the `local` row it was written with.
    //
    // `idx_plays_identity` is the dedupe rule within one source, and it is
    // exact rather than fuzzy: `started_at` is recorded when the track loads,
    // and the import pages backwards with an inclusive cursor that re-fetches
    // a few rows for the index to eat. It is deliberately *not* the whole
    // cross-source rule - last.fm autocorrects artist and title, so a play
    // this app wrote comes back under a spelling that computes a different
    // `match_key`. That case is `started_at` alone, and it belongs to the
    // import, because within a second this app played exactly one thing.
    //
    // No `loved` column and no MBID column on `tracks`. Loved is the current
    // state of a track rather than a fact about a moment, and a recording id
    // matches nothing until the import lands rows carrying one; both arrive
    // with the data that makes them worth anything.
    //
    // `play_count` and `last_played_at` stay and are not backfilled. Only the
    // most recent play is recoverable from them, and manufacturing timestamps
    // for the rest would put invented data in the table the feature reads.
    r#"
CREATE TABLE plays (
    id           INTEGER PRIMARY KEY,
    started_at   INTEGER NOT NULL,
    source       TEXT NOT NULL CHECK (source IN ('local', 'lastfm')),
    artist       TEXT NOT NULL,
    title        TEXT NOT NULL,
    album        TEXT,
    duration_ms  INTEGER,
    artist_mbid  TEXT,
    track_mbid   TEXT,
    match_key    TEXT NOT NULL,
    track_id     INTEGER REFERENCES tracks(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_plays_identity ON plays(started_at, match_key);
CREATE INDEX idx_plays_started ON plays(started_at);
CREATE INDEX idx_plays_track   ON plays(track_id, started_at);
"#,
    // 14 - the loved set the last.fm import fetches
    //
    // Replaced wholesale on each import: unloving happens, and a merged set
    // could never forget one. Keyed by `match_key` alone because loved is a
    // fact about a song rather than about a play, which is also why it is not
    // a column on `plays` - see 13.
    //
    // No `tracks.recording_mbid`. 78 measured what last.fm's recording ids are
    // worth against a real history: of 7,863 scrobbles, those naming a
    // recording agreed with the file's id 14% of the time and linked nothing
    // the key had missed, because most of them are pre-NGS ids MusicBrainz has
    // since retired. `plays.track_mbid` is still recorded; nothing matches on
    // it.
    r#"
CREATE TABLE lastfm_loved (
    match_key TEXT PRIMARY KEY
) WITHOUT ROWID;
"#,
    // 15 - the MusicBrainz id backfill's flags, retired
    //
    // `scan::read_musicbrainz_tags` reads the release type as well now, under
    // flags of its own, so a library that finished the ids-only pass runs it
    // again. These two would otherwise sit in `settings` naming nothing.
    r#"
DELETE FROM settings WHERE key IN ('tracks.mbidsRead', 'tracks.mbidsReadThrough');
"#,
    // 16 - which album spellings are one album
    //
    // A play keeps the album as it was scrobbled, and streaming services
    // rename releases: `Addicts: Black Meddle Pt. 2`, `… Pt. II`, `…, Pt. II`
    // and `… Part II` are one record heard 1,112 times, drawn as four albums
    // none of which reach the top list where the whole would. Over a real log
    // that is 217 groups and 4,146 plays attributed away from their biggest
    // spelling.
    //
    // A table rather than a column on `plays`: the fold is `plays::album_key`,
    // it will move as its vocabulary grows, and recomputing it means rewriting
    // 13,708 rows here instead of a quarter of a million there. Rust-side for
    // the reason `plays.rs` already gives - `lower()` and `COLLATE NOCASE` are
    // ASCII-only, and the plays behind `Confessions D'Un Voleur D'Ames`
    // against `Confessions d'un Voleur D'âmes` need diacritics folded.
    //
    // `(artist, album)` verbatim, so the join back onto `plays` under the
    // binary collation covers every row: the pass enumerates the spellings as
    // they are stored, and `COLLATE NOCASE` on the join would fold ASCII only
    // anyway.
    //
    // `heading` is a spelling out of the user's own history and never an
    // invented title - MusicBrainz calls this release `Addicts: Black Meddle,
    // Part 2`, a fifth spelling none of the 1,112 plays carry. That is also
    // why it doubles as the group's identity: `ListenQuery::album` stays a
    // title string and `StatsCrumb` does not change.
    //
    // `pinned` is the user's correction, in the shape `genre_overrides` gives
    // it: it survives a pass, and it claims the unpinned rows folding to the
    // same key - otherwise a retitled group would revert the moment a new
    // spelling arrived.
    r#"
CREATE TABLE album_groups (
    artist  TEXT NOT NULL,
    album   TEXT NOT NULL,
    key     TEXT NOT NULL,
    heading TEXT NOT NULL,
    pinned  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (artist, album)
) WITHOUT ROWID;

CREATE INDEX idx_album_groups_key ON album_groups(key);
"#,
];

#[cfg(test)]
mod tests {
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    /// A database as it stood before migration 12, so the merge that migration
    /// runs has two rows to merge. The one case where a test has to stop
    /// short of the latest version.
    fn before_the_fold() -> (tempfile::TempDir, rusqlite::Connection) {
        const BEFORE: usize = 11;
        let dir = tempfile::tempdir().unwrap();
        let conn = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
        for (index, sql) in super::MIGRATIONS.iter().take(BEFORE).enumerate() {
            conn.execute_batch(sql).unwrap();
            conn.pragma_update(None, "user_version", (index + 1) as i64)
                .unwrap();
        }
        (dir, conn)
    }

    fn track(conn: &rusqlite::Connection, path: &str, play_count: i64, added_at: i64) -> i64 {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, added_at, play_count, title)
             VALUES (?1, 0, 0, ?3, ?2, 'Track')",
            rusqlite::params![path, play_count, added_at],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn paths(conn: &rusqlite::Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT path FROM tracks ORDER BY id").unwrap();
        let rows = stmt.query_map([], |row| row.get(0)).unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    }

    const PRESENT: &str = "D:\\Library\\A Forest of Stars\\The Corpse of Rebirth\\01 - God.mp3";
    const ABSORBED: &str = "D:\\Library\\A Forest of Stars\\The Corpse Of Rebirth\\01 - God.mp3";

    /// The loop's last stop: the scanner reads back a spelling the mover did
    /// not write, and byte-exact that is a second row rather than the same one.
    #[test]
    fn a_path_read_back_in_another_casing_is_the_same_row() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO tracks (path, mtime, size, added_at, title)
                      VALUES (?1, 0, 0, 0, ?2)
                      ON CONFLICT(path) DO UPDATE SET title = excluded.title";

        conn.execute(insert, rusqlite::params![PRESENT, "first"])
            .unwrap();
        conn.execute(insert, rusqlite::params![ABSORBED, "second"])
            .unwrap();

        assert_eq!(paths(&conn), [PRESENT], "one file is one row");
        let title: String = conn
            .query_row("SELECT title FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "second", "the second read updated rather than added");
    }

    /// 492 rows in the user's library are a present row's path in another
    /// casing, so the fold cannot be applied without saying what happens to
    /// them.
    #[test]
    fn the_fold_merges_the_missing_row_into_the_present_one() {
        let (_dir, mut conn) = before_the_fold();
        let present = track(&conn, PRESENT, 2, 500);
        let absorbed = track(&conn, ABSORBED, 9, 100);
        conn.execute(
            "UPDATE tracks SET missing_since = 1, last_played_at = 400 WHERE id = ?1",
            [absorbed],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlists (name, kind, created_at) VALUES ('Mix', 'static', 0)",
            [],
        )
        .unwrap();
        let playlist = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, 3)",
            rusqlite::params![playlist, absorbed],
        )
        .unwrap();

        crate::db::migrate(&mut conn).unwrap();

        assert_eq!(paths(&conn), [PRESENT], "the present row is the survivor");
        let (id, plays, added, played): (i64, i64, i64, i64) = conn
            .query_row(
                "SELECT id, play_count, added_at, last_played_at FROM tracks",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(id, present);
        assert_eq!(plays, 9, "the higher play count");
        assert_eq!(added, 100, "the earlier added_at");
        assert_eq!(played, 400, "and the play count's own timestamp with it");
        let owner: i64 = conn
            .query_row("SELECT track_id FROM playlist_tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(owner, present, "the playlist place came across");
    }

    /// The other 1,580 fold onto nothing, so nothing here may decide what they
    /// are - they are indistinguishable from an unplugged drive, and removing
    /// them is the user's gesture.
    #[test]
    fn a_missing_row_that_collides_with_nothing_keeps_its_row() {
        let (_dir, mut conn) = before_the_fold();
        let alone = track(&conn, ABSORBED, 0, 0);
        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = ?1", [alone])
            .unwrap();

        crate::db::migrate(&mut conn).unwrap();

        assert_eq!(paths(&conn), [ABSORBED]);
    }

    /// The rebuild drops and recreates `tracks`, which with foreign keys on
    /// would cascade every playlist entry in the library away.
    #[test]
    fn the_rebuild_keeps_the_playlist_entries_of_rows_that_did_not_collide() {
        let (_dir, mut conn) = before_the_fold();
        let kept = track(&conn, PRESENT, 0, 0);
        conn.execute(
            "INSERT INTO playlists (name, kind, created_at) VALUES ('Mix', 'static', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position)
             VALUES (last_insert_rowid(), ?1, 0)",
            [kept],
        )
        .unwrap();

        crate::db::migrate(&mut conn).unwrap();

        let entries: i64 = conn
            .query_row("SELECT count(*) FROM playlist_tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(entries, 1);
    }

    /// The rebuild carries the search index across with it: the triggers go
    /// with the table they are on, and `tracks_fts` is keyed by a row id the
    /// copy has to preserve.
    #[test]
    fn the_rebuilt_table_is_still_searchable_and_still_indexed() {
        let (_dir, mut conn) = before_the_fold();
        track(&conn, PRESENT, 0, 0);

        crate::db::migrate(&mut conn).unwrap();
        track(&conn, &ABSORBED.replace("01 - God", "02 - Raven"), 0, 0);

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM tracks_fts WHERE tracks_fts MATCH 'Track'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hits, 2, "the trigger survived the rebuild");
    }

    #[test]
    fn a_fresh_database_carries_the_lookup_table_and_the_release_type() {
        let (_dir, conn) = open();

        conn.execute_batch("SELECT release_type FROM tracks WHERE 0")
            .expect("tracks gained a release type");
        conn.execute_batch(
            "SELECT album, artist, status, release_mbid, score, candidates_json, attempted_at
               FROM release_lookup WHERE 0",
        )
        .expect("the lookup table has the columns the pass writes");
    }

    /// The defect the index exists for. A rowid table's PRIMARY KEY permits
    /// NULLs, so an untagged release would insert twice and pay the whole
    /// lookup twice.
    #[test]
    fn an_untagged_release_can_only_be_recorded_once() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO release_lookup (album, artist, status, attempted_at)
                      VALUES (?1, ?2, 'none', 0)";

        conn.execute(insert, rusqlite::params![None::<String>, None::<String>])
            .unwrap();
        conn.execute(insert, rusqlite::params![None::<String>, None::<String>])
            .expect_err("two untagged releases are one release");
    }

    /// The grid has folded case when grouping since 81, and `release_members`
    /// matches `NOCASE`: unfolded, a release tagged two ways is one tile and
    /// one member list but two rows here, and the second row pays the four and
    /// a half hours again.
    #[test]
    fn a_release_tagged_two_ways_is_one_row() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO release_lookup (album, artist, status, attempted_at)
                      VALUES (?1, ?2, 'resolved', 0)";

        conn.execute(insert, rusqlite::params!["Loveless", "My Bloody Valentine"])
            .unwrap();
        conn.execute(insert, rusqlite::params!["loveless", "my bloody valentine"])
            .expect_err("case is folded, so this is the same release");
    }

    /// The grouping the Statistics view folds album spellings with. One row
    /// per distinct `(artist, album)` in `plays`, so the pair is the key.
    #[test]
    fn a_fresh_database_carries_the_album_grouping() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO album_groups (artist, album, key, heading)
                      VALUES (?1, ?2, 'k', 'Addicts: Black Meddle Pt. 2')";

        conn.execute(insert, ["Nachtmystium", "Addicts: Black Meddle Pt. 2"])
            .unwrap();
        conn.execute(insert, ["Nachtmystium", "Addicts: Black Meddle Pt. II"])
            .expect("a second spelling is a second row");
        conn.execute(insert, ["Nachtmystium", "Addicts: Black Meddle Pt. 2"])
            .expect_err("one spelling is one row");

        let pinned: i64 = conn
            .query_row("SELECT pinned FROM album_groups LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(pinned, 0, "a row the fold wrote is not a correction");
    }

    #[test]
    fn a_status_the_pass_does_not_write_is_refused() {
        let (_dir, conn) = open();

        conn.execute(
            "INSERT INTO release_lookup (album, artist, status, attempted_at)
             VALUES ('Loveless', 'MBV', 'maybe', 0)",
            [],
        )
        .expect_err("the four statuses are the whole vocabulary");
    }

    /// Migration 10 rebuilds the table to widen the CHECK. A rebuild that
    /// dropped the index would let an untagged release insert twice again,
    /// and one that dropped a row would lose an attempt the pass paid for.
    #[test]
    fn the_rebuilt_table_keeps_its_key_and_takes_the_fourth_status() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO release_lookup (album, artist, status, attempted_at)
                      VALUES (?1, ?2, ?3, 0)";

        conn.execute(insert, rusqlite::params!["Loveless", "MBV", "aside"])
            .expect("a release can be set aside");
        conn.execute(insert, rusqlite::params!["loveless", "mbv", "review"])
            .expect_err("the unique index survived the rebuild");
    }
}
