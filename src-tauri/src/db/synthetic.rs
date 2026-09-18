//! Synthetic library rows, for measuring things a real library is too small
//! or too slow to measure.
//!
//! Rows are written straight into `tracks` rather than through the scanner:
//! what these exist to exercise is query cost and what the table does with a
//! hundred and fifty thousand rows, not tag parsing, and generating that many
//! real mp3 files would cost gigabytes and minutes to produce a worse test.
//!
//! Two callers, and they are why this lives in the crate rather than beside
//! one of them: the Rust perf tests (`tests/perf.rs`) and the e2e
//! virtualization spec, which reaches it through a command that refuses to run
//! outside a test build.

use rusqlite::Connection;

use crate::error::AppResult;

/// Inserts `count` synthetic tracks in one transaction.
///
/// Returns how many were inserted. Paths are unique per index and prefixed so
/// they cannot collide with a real library sharing the database - which, in
/// the e2e suite, is exactly what happens.
///
/// The generated values repeat on deliberately coprime-ish cycles so that
/// grouping, sorting and filtering all have something to do: 250 artists, 800
/// albums, 20 genres, 55 years. Names carry no spaces or punctuation, so each
/// is a single FTS token and a search term cannot half-match a different
/// column.
pub fn seed(conn: &mut Connection, count: u32) -> AppResult<u32> {
    let existing: u32 = conn.query_row(
        "SELECT count(*) FROM tracks WHERE path LIKE 'synthetic://%'",
        [],
        |row| row.get(0),
    )?;

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album,
                                 album_artist, genre, year, track_no, added_at)
             VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, 0)",
        )?;

        for index in existing..existing + count {
            stmt.execute(rusqlite::params![
                format!("synthetic://{index:08}.mp3"),
                180_000 + i64::from(index % 120_000),
                format!("Track{index:08}"),
                format!("Artist{:03}", index % 250),
                format!("Album{:03}", index % 800),
                format!("Genre{:02}", index % 20),
                1970 + i64::from(index % 55),
                i64::from(index % 20) + 1,
            ])?;
        }
    }
    tx.commit()?;

    Ok(count)
}

/// Inserts `count` synthetic plays in one transaction.
///
/// Returns how many were inserted. `seed` writes `tracks` and nothing has ever
/// written a play, so the stats budgets need their own seeder.
///
/// Timestamps are one second apart from a fixed epoch, which makes every row a
/// distinct identity under `idx_plays_identity` and keeps a re-seed from
/// silently inserting nothing.
///
/// **One play in three cannot match anything.** A seed that resolved
/// completely would make 77's `coverage` untestable and would make [`resolve`]
/// look fast for the wrong reason - the guarded `UPDATE` only pays for the
/// rows it writes. The rest name a track `seed` wrote, so the proportion that
/// resolves is a property of the data rather than of the library it is run
/// against.
///
/// `track_id` is left null on purpose: it is what `resolve` computes, and a
/// seed that pre-filled it would leave that function nothing to measure.
///
/// [`resolve`]: crate::db::plays::resolve
pub fn seed_plays(conn: &mut Connection, count: u32) -> AppResult<u32> {
    /// 2023-11-14, far enough from zero that local-time bucketing has a real
    /// date to work with.
    const EPOCH: i64 = 1_700_000_000;

    let tracks: u32 = conn.query_row(
        "SELECT count(*) FROM tracks WHERE path LIKE 'synthetic://%'",
        [],
        |row| row.get(0),
    )?;
    let existing: u32 = conn.query_row("SELECT count(*) FROM plays", [], |row| row.get(0))?;

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT OR IGNORE INTO plays
                (started_at, source, artist, title, album, duration_ms, match_key)
             VALUES (?1, 'lastfm', ?2, ?3, ?4, 240000, ?5)",
        )?;

        for index in existing..existing + count {
            let hit = tracks > 0 && !index.is_multiple_of(3);
            let (artist, title, album) = if hit {
                let track = index % tracks;
                (
                    format!("Artist{:03}", track % 250),
                    format!("Track{track:08}"),
                    format!("Album{:03}", track % 800),
                )
            } else {
                (
                    format!("Nobody{:03}", index % 250),
                    format!("Unheard{index:08}"),
                    format!("Elsewhere{:03}", index % 800),
                )
            };
            stmt.execute(rusqlite::params![
                EPOCH + i64::from(index),
                artist,
                title,
                album,
                crate::db::plays::match_key(&artist, &title),
            ])?;
        }
    }
    tx.commit()?;

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn temp_db() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = Db::open(dir.path().join("library.sqlite3")).expect("open");
        (dir, db)
    }

    #[test]
    fn seeding_twice_adds_twice_and_collides_never() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();

        seed(&mut conn, 10).unwrap();
        // The second call is the one that would fail on the UNIQUE path index
        // if the numbering restarted, which is what makes re-seeding a
        // database that already has rows safe.
        seed(&mut conn, 10).unwrap();

        let rows: u32 = conn
            .query_row("SELECT count(*) FROM tracks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 20);
    }

    #[test]
    fn the_rows_are_varied_enough_to_sort_and_group_by() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        seed(&mut conn, 1_000).unwrap();

        let distinct = |column: &str| -> u32 {
            conn.query_row(
                &format!("SELECT count(DISTINCT {column}) FROM tracks"),
                [],
                |r| r.get(0),
            )
            .unwrap()
        };

        // A seed that produced one artist would let a grouping query look fast
        // for the wrong reason.
        assert_eq!(distinct("artist"), 250);
        assert_eq!(distinct("genre"), 20);
        assert_eq!(distinct("title"), 1_000, "titles must be unique per row");
    }

    #[test]
    fn seeded_plays_land_partly_inside_the_library_and_partly_outside() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        seed(&mut conn, 100).unwrap();
        seed_plays(&mut conn, 300).unwrap();

        crate::db::plays::resolve(&conn).unwrap();

        let matched: u32 = conn
            .query_row(
                "SELECT count(*) FROM plays WHERE track_id IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        // Two in three by construction. A seed that matched everything would
        // make `coverage` untestable and `resolve` look fast for the wrong
        // reason.
        assert_eq!(matched, 200);
    }

    #[test]
    fn seeding_plays_twice_adds_twice() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        seed(&mut conn, 10).unwrap();

        seed_plays(&mut conn, 50).unwrap();
        // The second call is the one that would insert nothing if the
        // timestamps restarted, because they are the identity.
        seed_plays(&mut conn, 50).unwrap();

        let rows: u32 = conn
            .query_row("SELECT count(*) FROM plays", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 100);
    }
}
