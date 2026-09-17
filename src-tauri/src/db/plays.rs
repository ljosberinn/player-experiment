//! The play log: one row per play, and the link from a play back to a file.
//!
//! # Why the link is rebuilt rather than maintained
//!
//! A play is a historical fact - the artist and title as they were when it
//! happened - so the only thing about it that can go stale is `track_id`. That
//! makes it derived data, and this module treats it the way
//! [`crate::db::tag_values`] treats the vocabulary: recompute the whole thing
//! whenever the tracks could have changed, rather than adjusting it in step
//! with every write. There is no drift to detect, no repair path to write, and
//! no ordering dependency between a file write and a link.
//!
//! # Why the key is not a column on `tracks`
//!
//! Normalization is Rust-side, because SQLite's `lower()` and `COLLATE NOCASE`
//! are ASCII-only and would leave Motörhead and Sigur Rós unfolded. So a
//! `tracks.match_key` column would have to be filled at every site that writes
//! a track row - the ordering dependency above - or recomputed over the whole
//! library on every rebuild, which costs more than the thing it was meant to
//! make cheap. [`resolve`] materializes it in a temporary table instead.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppResult;

/// Separates artist from title inside a key.
///
/// A character no tag carries, so `("ab", "c")` and `("a", "bc")` cannot
/// collide into one key.
const SEPARATOR: char = '\u{1f}';

/// The identity two spellings of one song share, or empty for a play nothing
/// can be matched to.
///
/// **Deliberately conservative**: lowercase, collapsed whitespace, and a
/// trailing `(feat. …)` or `(with …)` dropped. Nothing else. Folding `(Live)`
/// into the studio cut would destroy a distinction the MBIDs exist to
/// preserve, and a key that matched too much is worse than one that matches
/// nothing - it attributes plays to a song the user never heard.
///
/// **Either side missing empties the whole key.** A key built from nothing
/// would match every untagged file in the library, so a play with no artist is
/// kept and stays unmatched rather than being attached to whatever happens to
/// be as blank as it is.
pub fn match_key(artist: &str, title: &str) -> String {
    let artist = normalize(artist);
    let title = normalize(title);
    if artist.is_empty() || title.is_empty() {
        return String::new();
    }
    format!("{artist}{SEPARATOR}{title}")
}

/// One side of a key.
fn normalize(value: &str) -> String {
    let lowered = value.to_lowercase();
    let trimmed = without_featuring(lowered.trim());
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `value` without a trailing parenthesised credit.
///
/// The one suffix worth dropping: the same song is tagged `Song`,
/// `Song (feat. Guest)` and `Song (with Guest)` across a library, and they are
/// one song. Only at the end, and only these openers - `(Live)`,
/// `(Remastered)` and `(Radio Edit)` name different recordings and stay.
fn without_featuring(value: &str) -> &str {
    const OPENERS: &[&str] = &["feat.", "feat ", "featuring ", "ft.", "ft ", "with "];

    let Some(rest) = value.strip_suffix(')') else {
        return value;
    };
    let Some(open) = rest.rfind('(') else {
        return value;
    };
    let inside = &rest[open + 1..];
    if OPENERS.iter().any(|opener| inside.starts_with(opener)) {
        rest[..open].trim_end()
    } else {
        value
    }
}

/// Writes down that a track was played, snapshotting its tags as they are now.
///
/// **The log does not inherit the scrobbler's rules.** `lastfm::rules` refuses
/// a track with no artist and a track shorter than thirty seconds; those are
/// last.fm's conditions for accepting a scrobble, not this app's for
/// remembering a play.
///
/// `OR IGNORE` rather than a plain insert, and that is about the transaction
/// this shares with [`crate::db::playback::mark_played`] rather than about
/// duplicates: a constraint violation here would roll back the `play_count`
/// increment with it, trading a missing log row for a wrong play count.
///
/// The initial `track_id` is the track that played, which is what [`resolve`]
/// will compute for it unless the library holds the same song twice - the
/// album copy and the compilation copy - in which case the next rebuild moves
/// the play to whichever of them that function picks. `resolve` is
/// authoritative; this is what keeps the row linked until one runs.
pub fn record(conn: &Connection, track_id: i64, started_at: i64) -> AppResult<()> {
    let snapshot = conn
        .query_row(
            "SELECT artist, title, album, duration_ms FROM tracks WHERE id = ?1",
            [track_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?;
    // A track removed between the play threshold and this write. Nothing to
    // record, and nothing worth failing playback over.
    let Some((artist, title, album, duration_ms)) = snapshot else {
        return Ok(());
    };

    let artist = artist.unwrap_or_default().trim().to_owned();
    let title = title.unwrap_or_default().trim().to_owned();
    let key = match_key(&artist, &title);
    let link = (!key.is_empty()).then_some(track_id);

    conn.execute(
        "INSERT OR IGNORE INTO plays
            (started_at, source, artist, title, album, duration_ms, match_key, track_id)
         VALUES (?1, 'local', ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![started_at, artist, title, album, duration_ms, key, link],
    )?;
    Ok(())
}

/// Recomputes `plays.track_id` for the whole log, returning how many links
/// moved.
///
/// Runs wherever [`crate::db::tag_values::rebuild`] runs - the end of a scan,
/// a tag write, and both removals - for the reason that module gives at
/// length. The count is what the tests assert idempotence with; no caller
/// needs it.
pub fn resolve(conn: &Connection) -> AppResult<u32> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.play_keys;
         CREATE TEMP TABLE play_keys (
             key      TEXT PRIMARY KEY,
             track_id INTEGER NOT NULL
         ) WITHOUT ROWID;",
    )?;

    {
        // **Which track wins a key is fixed rather than incidental.** The same
        // song on its album and on a compilation is two rows and one key, and
        // a library has hundreds of those. Present beats unplugged and the
        // older id beats the newer, which is migration 12's tiebreak for the
        // same reason it was chosen there: without one the winner follows scan
        // order, this function stops being idempotent, and the guarded UPDATE
        // below rewrites the whole table on every run.
        let mut tracks = conn.prepare(
            "SELECT id, artist, title FROM tracks ORDER BY missing_since IS NOT NULL, id",
        )?;
        let mut insert =
            conn.prepare("INSERT OR IGNORE INTO temp.play_keys (key, track_id) VALUES (?1, ?2)")?;

        let mut rows = tracks.query([])?;
        while let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let artist: Option<String> = row.get(1)?;
            let title: Option<String> = row.get(2)?;
            let key = match_key(
                artist.as_deref().unwrap_or_default(),
                title.as_deref().unwrap_or_default(),
            );
            if key.is_empty() {
                continue;
            }
            insert.execute(rusqlite::params![key, id])?;
        }
    }

    // **The guard is what makes the full scan affordable.** After a three-track
    // tag edit the statement still reads every play, but it writes only the
    // handful whose link actually moved, instead of rewriting a quarter of a
    // million rows to the values they already held.
    //
    // `IS NOT` rather than `<>` because most of those values are NULL on both
    // sides, and `<>` is NULL there rather than false.
    let moved = conn.execute(
        "UPDATE plays
            SET track_id = (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key)
          WHERE match_key <> ''
            AND track_id IS NOT
                (SELECT k.track_id FROM temp.play_keys k WHERE k.key = plays.match_key)",
        [],
    )?;

    conn.execute_batch("DROP TABLE temp.play_keys;")?;
    Ok(moved as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{playback, Db};

    fn open() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        (dir, conn)
    }

    fn add_track(conn: &Connection, id: i64, artist: Option<&str>, title: Option<&str>) {
        conn.execute(
            "INSERT INTO tracks (id, path, mtime, size, duration_ms, artist, title, added_at)
             VALUES (?1, ?2, 0, 0, 240000, ?3, ?4, 0)",
            rusqlite::params![id, format!("C:\\music\\{id}.mp3"), artist, title],
        )
        .unwrap();
    }

    fn linked(conn: &Connection, started_at: i64) -> Option<i64> {
        conn.query_row(
            "SELECT track_id FROM plays WHERE started_at = ?1",
            [started_at],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn a_key_folds_only_what_it_is_meant_to() {
        let cases = [
            // Case folds past ASCII, which is the whole reason this is not
            // `lower()` in SQL.
            (
                ("Motörhead", "Ace of Spades"),
                ("MOTÖRHEAD", "ACE OF SPADES"),
            ),
            (
                ("Sigur Rós", "Svefn-g-englar"),
                ("SIGUR RÓS", "Svefn-G-Englar"),
            ),
            // Whitespace a tag editor leaves behind.
            (
                ("Boards of Canada", "Roygbiv"),
                ("  Boards   of Canada ", "Roygbiv\t"),
            ),
            // The one suffix that names the same song.
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (feat. Daft Punk)"),
            ),
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (with Daft Punk)"),
            ),
            (
                ("Kanye West", "Stronger"),
                ("Kanye West", "Stronger (ft. Daft Punk)"),
            ),
        ];
        for (left, right) in cases {
            assert_eq!(
                match_key(left.0, left.1),
                match_key(right.0, right.1),
                "{left:?} and {right:?} are one song"
            );
        }

        // A different recording is a different song, and the MBIDs exist to
        // keep the distinction.
        assert_ne!(
            match_key("Talk Talk", "Ascension Day"),
            match_key("Talk Talk", "Ascension Day (Live)")
        );
        assert_ne!(
            match_key("Talk Talk", "Ascension Day"),
            match_key("Talk Talk", "Ascension Day (Remastered)")
        );

        // The separator is doing its job.
        assert_ne!(match_key("ab", "c"), match_key("a", "bc"));
    }

    #[test]
    fn a_key_built_from_nothing_is_empty_rather_than_broad() {
        for (artist, title) in [
            ("", "Roygbiv"),
            ("Boards of Canada", ""),
            ("", ""),
            ("  ", "\t"),
        ] {
            assert_eq!(match_key(artist, title), "");
        }
    }

    #[test]
    fn a_play_lands_with_the_tags_it_was_played_under() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));

        record(&conn, 1, 1_700_000_000).unwrap();

        let (artist, title, source, duration_ms, track_id): (
            String,
            String,
            String,
            i64,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT artist, title, source, duration_ms, track_id FROM plays",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            (
                artist.as_str(),
                title.as_str(),
                source.as_str(),
                duration_ms,
                track_id
            ),
            ("Blue Room", "Harbour", "local", 240_000, Some(1))
        );
    }

    /// The rules the scrobbler applies are last.fm's conditions for accepting
    /// a scrobble, not this app's for remembering a play.
    #[test]
    fn an_untagged_track_is_logged_and_left_unmatched() {
        let (_dir, conn) = open();
        add_track(&conn, 1, None, None);

        record(&conn, 1, 1_700_000_000).unwrap();
        resolve(&conn).unwrap();

        let (artist, key) = conn
            .query_row("SELECT artist, match_key FROM plays", [], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap();
        assert_eq!((artist.as_str(), key.as_str()), ("", ""));
        assert_eq!(linked(&conn, 1_700_000_000), None);
    }

    /// The failure this guards against is a lost play count, not a lost row:
    /// the insert shares a transaction with `mark_played`, so a constraint
    /// violation would take the increment with it.
    #[test]
    fn a_second_play_of_the_same_second_is_ignored_rather_than_an_error() {
        let (_dir, mut conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));

        let tx = conn.transaction().unwrap();
        playback::mark_played(&tx, 1, 1_700_000_500).unwrap();
        record(&tx, 1, 1_700_000_000).unwrap();
        playback::mark_played(&tx, 1, 1_700_000_500).unwrap();
        record(&tx, 1, 1_700_000_000).unwrap();
        tx.commit().unwrap();

        let plays: i64 = conn
            .query_row("SELECT count(*) FROM plays", [], |r| r.get(0))
            .unwrap();
        let count: i64 = conn
            .query_row("SELECT play_count FROM tracks WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!((plays, count), (1, 2));
    }

    #[test]
    fn a_play_with_no_matching_file_stays_unmatched() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (1, 'lastfm', 'Nobody', 'Nothing', ?1)",
            [match_key("Nobody", "Nothing")],
        )
        .unwrap();

        resolve(&conn).unwrap();

        assert_eq!(linked(&conn, 1), None);
    }

    #[test]
    fn deleting_a_file_forgets_the_link_and_keeps_the_play() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        record(&conn, 1, 1_700_000_000).unwrap();

        conn.execute("DELETE FROM tracks WHERE id = 1", []).unwrap();

        // `ON DELETE SET NULL` gets there before any rebuild does, which is
        // what keeps the log readable between one and the next.
        assert_eq!(linked(&conn, 1_700_000_000), None);
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM plays", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn retagging_a_file_re_points_the_plays_that_name_it() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 2, Some("Nobody"), Some("Nothing"));
        record(&conn, 1, 1_700_000_000).unwrap();

        conn.execute(
            "UPDATE tracks SET artist = 'Nobody', title = 'Nothing' WHERE id = 1",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE tracks SET artist = 'Blue Room', title = 'Harbour' WHERE id = 2",
            [],
        )
        .unwrap();
        resolve(&conn).unwrap();

        assert_eq!(linked(&conn, 1_700_000_000), Some(2));
    }

    /// The album copy and the compilation copy of one song. Which one a play
    /// lands on has to be the same answer every time, or `resolve` writes the
    /// whole table on every run.
    #[test]
    fn one_key_over_two_files_picks_the_present_one_then_the_older_id() {
        let (_dir, conn) = open();
        add_track(&conn, 7, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 9, Some("Blue Room"), Some("Harbour"));
        record(&conn, 9, 1_700_000_000).unwrap();

        resolve(&conn).unwrap();
        assert_eq!(linked(&conn, 1_700_000_000), Some(7), "the older id wins");

        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = 7", [])
            .unwrap();
        resolve(&conn).unwrap();
        assert_eq!(
            linked(&conn, 1_700_000_000),
            Some(9),
            "a present file beats an unplugged one"
        );
    }

    #[test]
    fn a_rebuild_over_an_unchanged_library_writes_nothing() {
        let (_dir, conn) = open();
        add_track(&conn, 1, Some("Blue Room"), Some("Harbour"));
        add_track(&conn, 2, None, None);
        record(&conn, 1, 1_700_000_000).unwrap();
        record(&conn, 2, 1_700_000_100).unwrap();
        resolve(&conn).unwrap();

        assert_eq!(resolve(&conn).unwrap(), 0);
    }
}
