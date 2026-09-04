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

    #[test]
    fn a_fresh_database_carries_the_lookup_table_and_the_release_type() {
        let (_dir, conn) = open();

        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            9
        );
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

    #[test]
    fn a_status_the_pass_does_not_write_is_refused() {
        let (_dir, conn) = open();

        conn.execute(
            "INSERT INTO release_lookup (album, artist, status, attempted_at)
             VALUES ('Loveless', 'MBV', 'maybe', 0)",
            [],
        )
        .expect_err("the three statuses are the whole vocabulary");
    }
}
