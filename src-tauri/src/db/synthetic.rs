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
}
