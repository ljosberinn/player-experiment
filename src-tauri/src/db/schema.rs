//! Versioned migrations.
//!
//! Each entry is applied in order inside a transaction, and `PRAGMA
//! user_version` records how far we got. The first creates the whole schema
//! and stamps [`FIRST_VERSION`]; each later one stamps one more. Migrations
//! are append-only: never edit a shipped one, add a new entry instead.

/// What the first entry stamps. A database at a version below it and above
/// zero is refused: 0.20.0 is the build that brings one up to it.
pub const FIRST_VERSION: usize = 20;

pub const MIGRATIONS: &[&str] = &[concat!(
    // `palette` is the three dominant colours behind the background that
    // follows the music, extracted once when the bytes are stored; see
    // `crate::palette` for how and `db::covers` for when. JSON rather than
    // columns, because nothing in SQL filters, sorts or aggregates on a
    // colour. NULL for a cover that would not decode.
    r#"
CREATE TABLE covers (
    hash    TEXT PRIMARY KEY,
    mime    TEXT NOT NULL,
    bytes   BLOB NOT NULL,
    palette TEXT
);
"#,
    // `path` collates NOCASE because the filesystem folds case: byte-exact,
    // a directory spelled `The Corpse Of Rebirth` where the tags compute
    // `The Corpse of Rebirth` is two rows for one file. NOCASE is ASCII-only
    // where `library::layout::same` folds past it; this side only decides
    // which row owns a path, not where a file goes.
    //
    // `missing_since` marks a file that is gone rather than deleting its row,
    // because an unplugged drive and a deliberate deletion look the same to a
    // scan and a deleted row takes its playlist entries with it. NULL means
    // present; the value is when it was first noticed missing. The index is
    // partial, so a healthy library pays nothing for the "are any missing"
    // question every stats refresh asks.
    //
    // `release_mbid` is per pressing, which a re-lookup and the Cover Art
    // Archive key on; `release_group_mbid` is the album across pressings,
    // which a browse view groups by. Only the group is indexed, because only
    // it is grouped on. `release_type` is the release group's primary type.
    // All three are read off the tags, so a rescan keeps them in step with
    // the file.
    //
    // `match_key` is `plays::track_key`, the bridge from a play or a love to
    // a row. NULL until `plays::refold` fills it, because the fold is Rust.
    //
    // The three `group` indexes are each `BrowseKind::identity_sql` spelled
    // out: SQLite uses an expression index only for the same expression under
    // the same collation, so change one and a drill-in scans the library
    // again, which `tests/perf.rs` catches.
    r#"
CREATE TABLE tracks (
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
    release_type       TEXT,
    match_key          TEXT
);

CREATE INDEX idx_tracks_album   ON tracks(album_artist, album, disc_no, track_no);
CREATE INDEX idx_tracks_artist  ON tracks(artist);
CREATE INDEX idx_tracks_year    ON tracks(year);
CREATE INDEX idx_tracks_added   ON tracks(added_at);
CREATE INDEX idx_tracks_missing ON tracks(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX idx_tracks_release_group ON tracks(release_group_mbid)
    WHERE release_group_mbid IS NOT NULL;
CREATE INDEX idx_tracks_match_key ON tracks(match_key);
CREATE INDEX idx_tracks_group_artist ON tracks(
    coalesce(nullif(album_artist, ''), nullif(artist, '')) COLLATE NOCASE
);
CREATE INDEX idx_tracks_group_release ON tracks(
    coalesce(release_group_mbid,
             coalesce(nullif(album, ''), '') || char(31)
             || coalesce(coalesce(nullif(album_artist, ''), nullif(artist, '')), ''))
    COLLATE NOCASE
);
CREATE INDEX idx_tracks_group_genre ON tracks(nullif(genre, '') COLLATE NOCASE);
"#,
    // Full text search over the columns the search box covers, kept current
    // by triggers. External content keyed by `tracks.id`.
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
    // `built_in` names a playlist the app keeps: `ensure_built_ins` upserts
    // on it, and the partial unique index is what that upsert conflicts on.
    r#"
CREATE TABLE playlists (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('static', 'smart')),
    filter_json  TEXT,
    sort_json    TEXT,
    columns_json TEXT,
    created_at   INTEGER NOT NULL,
    built_in     TEXT
);

CREATE UNIQUE INDEX idx_playlists_built_in ON playlists(built_in) WHERE built_in IS NOT NULL;

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
    // The files the user has said they do not want. `scan::plan` adds every
    // audio file under a watch folder it does not already know, so a removed
    // row with no record behind it lasts until the next Rescan. Keyed on the
    // path, because the row is gone and the path is all that is left.
    //
    // Only an explicit per-row removal writes one: `remove_missing` does not,
    // because a drive coming back should restore what was on it.
    r#"
CREATE TABLE removed_paths (
    path       TEXT PRIMARY KEY,
    removed_at INTEGER NOT NULL
);
"#,
    // The distinct values of the autocompleted fields, ranked by how many
    // tracks carry each, because `SELECT DISTINCT` over 50k rows per keystroke
    // is not viable. `uses` lets the spelling on 400 tracks outrank a typo
    // made once, and a value that falls to zero is dropped. The NOCASE index
    // is what the lookup uses: someone typing "godspeed" wants the band.
    //
    // WITHOUT ROWID here and below wherever the primary key is the whole row,
    // since a separate rowid would be pure overhead.
    r#"
CREATE TABLE tag_values (
    field TEXT    NOT NULL,
    value TEXT    NOT NULL,
    uses  INTEGER NOT NULL,
    PRIMARY KEY (field, value)
) WITHOUT ROWID;

CREATE INDEX idx_tag_values_lookup ON tag_values(field, value COLLATE NOCASE);
"#,
    // Plays waiting to reach last.fm, as the resolved scrobble rather than a
    // track id: a play is a fact about a moment, and the row it came from can
    // be retagged or removed before the queue drains. So no foreign key
    // either.
    //
    // `next_try_at` is unix seconds and zero means now, so a fresh row is due
    // at once. Draining asks only "what is due", oldest first.
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
    // What the unattended lookup pass has been through: the review queue, the
    // point a killed pass resumes from, and the guard against re-searching
    // thousands of releases. No row means never attempted, and a row is never
    // revisited automatically.
    //
    // The key is `db::query`'s two grouping expressions, so a release is the
    // same thing here as in the grid. A `PRIMARY KEY (album, artist)` will not
    // hold it: a rowid table's primary key permits NULLs, so an untagged
    // release would insert twice. The unique index over the coalesced pair
    // does, under NOCASE because the grid folds case when grouping.
    //
    // `aside` is a queued release the user wants left alone; `unwritable` is
    // one matched with certainty that the files would not take. A CHECK
    // cannot be widened in place, so a sixth status is a table rebuild.
    //
    // `candidates_json` is a cache of the search results the pass had in hand
    // when it queued the release, so reviewing it costs no second request.
    r#"
CREATE TABLE release_lookup (
    id              INTEGER PRIMARY KEY,
    album           TEXT,
    artist          TEXT,
    status          TEXT NOT NULL CHECK (status IN ('resolved', 'review', 'none', 'aside', 'unwritable')),
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
    // One row per play. The text columns are the play as it was heard, for
    // the scrobble queue's reason; `track_id` is the one derived field, which
    // is why it is the one foreign key - deleting a file forgets the link and
    // keeps the play.
    //
    // `source` is which writer got there first: the last.fm import writes
    // `lastfm` for history this app never saw, and a play it already holds
    // keeps its `local` row.
    //
    // `idx_plays_identity` is the dedupe rule within one source. It is not the
    // cross-source rule: last.fm autocorrects artist and title, so a play this
    // app wrote comes back under a different `match_key`. That case is
    // `started_at` alone, and belongs to the import.
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
    // The loved set, keyed by `match_key` alone because loved is a fact about
    // a song rather than about a play or a file. `remote` is whether last.fm
    // reported the key: a refresh removes only those, because a love made here
    // that last.fm stores under an autocorrected spelling never comes back
    // under this one.
    //
    // `love_queue` holds the latest intent per song, not a history: loving
    // and unloving twice offline sends one call.
    r#"
CREATE TABLE loved (
    match_key TEXT PRIMARY KEY,
    remote    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE love_queue (
    match_key   TEXT PRIMARY KEY,
    artist      TEXT NOT NULL,
    title       TEXT NOT NULL,
    loved       INTEGER NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    next_try_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
"#,
    // Which album spellings in the play log are one album. A table rather
    // than a column on `plays`: the fold is `plays::album_key` and moves as
    // its vocabulary grows, and recomputing it rewrites one row per spelling
    // here instead of one per play there.
    //
    // `(artist, album)` verbatim, so the join back onto `plays` under the
    // binary collation covers every row. `heading` is a spelling out of the
    // user's own history, never an invented title, which is why it doubles as
    // the group's identity. `pinned` is the user's correction: it survives a
    // pass, and claims the unpinned rows folding to the same key.
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
    // The genre tree: black metal -> atmospheric black metal, raw black metal.
    // From Wikidata, the only source with that granularity and a licence that
    // lets it ship; the alternatives are argued out in
    // docs/plans/statistics.md. Every key is a lowercased label rather than a
    // QID, because what is being resolved is a genre string out of a tag.
    //
    // `genres.parent` is one primary parent for the drill-down to walk;
    // `genre_edges` keeps the whole subclass DAG. Which of several parents is
    // primary is arbitrary - the generator takes the smallest label - and
    // `genre_overrides` is what makes that affordable.
    //
    // No foreign keys between the three seeded tables: the rows arrive
    // alphabetically, so a self-referential key would have to be deferred to
    // survive its own seed. `genre_overrides.parent` has one, because that
    // table is written by hand at runtime.
    //
    // The seed is generated by `scripts/genres.mjs` and fixed at compile time,
    // so a regenerated file reaches fresh databases only; an existing one
    // needs an entry of its own.
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

-- The drill-down asks for the children of a genre, down the primary parent
-- for what the donut draws and across the DAG for what it is also filed under.
CREATE INDEX idx_genres_parent      ON genres(parent);
CREATE INDEX idx_genre_edges_parent ON genre_edges(parent);
"#,
    include_str!("../../data/genres.sql")
)];

#[cfg(test)]
mod tests {
    use crate::db::Db;

    fn open() -> (tempfile::TempDir, rusqlite::Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn paths(conn: &rusqlite::Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT path FROM tracks ORDER BY id").unwrap();
        let rows = stmt.query_map([], |row| row.get(0)).unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    }

    const ASKED: &str = "D:\\Library\\A Forest of Stars\\The Corpse of Rebirth\\01 - God.mp3";
    const ON_DISK: &str = "D:\\Library\\A Forest of Stars\\The Corpse Of Rebirth\\01 - God.mp3";

    /// The scanner reads back a spelling the mover did not write, and
    /// byte-exact that would be a second row rather than the same one.
    #[test]
    fn a_path_read_back_in_another_casing_is_the_same_row() {
        let (_dir, conn) = open();
        let insert = "INSERT INTO tracks (path, mtime, size, added_at, title)
                      VALUES (?1, 0, 0, 0, ?2)
                      ON CONFLICT(path) DO UPDATE SET title = excluded.title";

        conn.execute(insert, rusqlite::params![ASKED, "first"])
            .unwrap();
        conn.execute(insert, rusqlite::params![ON_DISK, "second"])
            .unwrap();

        assert_eq!(paths(&conn), [ASKED], "one file is one row");
        let title: String = conn
            .query_row("SELECT title FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "second", "the second read updated rather than added");
    }

    #[test]
    fn a_fresh_database_carries_the_lookup_table_and_the_release_type() {
        let (_dir, conn) = open();

        conn.execute_batch("SELECT release_type FROM tracks WHERE 0")
            .expect("tracks carries a release type");
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

    /// The grid folds case when grouping, and `release_members`
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
        .expect_err("the five statuses are the whole vocabulary");
    }

    #[test]
    fn every_status_the_pass_writes_is_accepted() {
        let (_dir, conn) = open();

        for status in ["resolved", "review", "none", "aside", "unwritable"] {
            conn.execute(
                "INSERT INTO release_lookup (album, artist, status, attempted_at)
                 VALUES (?1, 'MBV', ?1, 0)",
                [status],
            )
            .expect(status);
        }
    }
}
