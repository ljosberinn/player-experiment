//! Versioned migrations.
//!
//! Each entry is applied in order inside a transaction, and `PRAGMA
//! user_version` records how far we got. Migrations are append-only: never
//! edit a shipped one, add a new entry instead.

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
    // 3 - the tag-edit undo journal
    //
    // Planned with the original schema but only built now, with the writer
    // that fills it. One row per track per edit; `batch_id` groups the tracks
    // one user action touched, so undo restores all of them together.
    //
    // ON DELETE CASCADE rather than keeping orphans: a track removed from the
    // library has no file left to restore tags to.
    r#"
CREATE TABLE tag_undo (
    id             INTEGER PRIMARY KEY,
    batch_id       INTEGER NOT NULL,
    track_id       INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    prev_tags_json TEXT NOT NULL,
    applied_at     INTEGER NOT NULL
);

CREATE INDEX idx_tag_undo_batch ON tag_undo(batch_id);
"#,
    // 4 - a file that is gone is marked, not deleted
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
    // 5 - the vocabulary a library already uses
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
    // 6 - the colours a cover is made of
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
    // No backfill, unlike migration 5. The rename in phase 32 orphaned every
    // existing data directory, so in practice every install starts with an
    // empty `covers`; a database carried over from before simply has null
    // palettes, and each cover gets one the next time a scan or a tag write
    // sees it. Decoding every cover in a large library inside a migration -
    // which runs in one transaction, before the window is shown - is the wrong
    // trade for artwork the user may never play.
    r#"
ALTER TABLE covers ADD COLUMN palette TEXT;
"#,
];
