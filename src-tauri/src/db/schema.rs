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
];
