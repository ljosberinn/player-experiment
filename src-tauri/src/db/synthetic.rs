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
/// albums, 20 genres, 55 years, 7 bitrates, 3 sample rates. Names carry no
/// spaces or punctuation, so each is a single FTS token and a search term
/// cannot half-match a different column.
///
/// **The quality columns and `added_at` are filled for the reason the
/// timestamps in [`seed_plays`] are spread**: left at NULL and at zero, the
/// two bitrate aggregates and `added_over_time` were one-group scans, and the
/// budgets in `tests/perf.rs` measured the NULL rather than the query.
pub fn seed(conn: &mut Connection, count: u32) -> AppResult<u32> {
    /// The bitrates a library actually holds, in the order they turn up, so a
    /// 32 kbps histogram bin has more than one occupant and an album's mean
    /// is a mean rather than a constant.
    const BITRATES: [i64; 7] = [96, 128, 160, 192, 224, 256, 320];
    const SAMPLE_RATES: [i64; 3] = [44_100, 48_000, 96_000];
    /// 2020-09-13, and fifteen minutes between additions: 150k rows then span
    /// a little over four years and fall in some fifty month buckets, all of
    /// them in the past.
    const ADDED_FROM: i64 = 1_600_000_000;
    const ADDED_SPACING: i64 = 900;

    let existing: u32 = conn.query_row(
        "SELECT count(*) FROM tracks WHERE path LIKE 'synthetic://%'",
        [],
        |row| row.get(0),
    )?;

    let tx = conn.transaction()?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album,
                                 album_artist, genre, year, track_no, bitrate, sample_rate,
                                 added_at)
             VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, ?9, ?10, ?11)",
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
                BITRATES[index as usize % BITRATES.len()],
                SAMPLE_RATES[index as usize % SAMPLE_RATES.len()],
                ADDED_FROM + i64::from(index) * ADDED_SPACING,
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
/// Timestamps are distinct per index from a fixed epoch, which makes every row
/// a distinct identity under `idx_plays_identity` and keeps a re-seed from
/// silently inserting nothing. **They are spread over years**, not packed a
/// second apart: a quarter of a million plays inside three days would measure
/// the day buckets and the streak walk at a cardinality no history has.
///
/// **And they have a weekly shape**: quiet nights, busy evenings, weekends
/// busier than weekdays. Evenly spaced, every hour of the week held the same
/// count, and the week clock the e2e suite photographs was a flat field.
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
    /// Monday 2023-11-13, 00:00 UTC, far enough from zero that local-time
    /// bucketing has a real date to work with. A Monday so that cell 0 of
    /// [`week_cells`] is one, in UTC at least.
    const EPOCH: i64 = 1_699_833_600;
    /// 250,000 plays then span nearly five years.
    const PER_WEEK: u32 = 1_000;
    const WEEK: i64 = 7 * 86_400;

    let cells = week_cells(PER_WEEK);

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
                EPOCH + i64::from(index / PER_WEEK) * WEEK + cells(index % PER_WEEK),
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

/// Where in its week the `slot`th of `per_week` plays falls, in seconds from
/// Monday 00:00.
///
/// The week is 168 hour cells, Monday first, each given a share of the plays
/// by a fixed weight. A cell's plays are spread evenly across its hour, so no
/// two slots share a second as long as no cell holds more than 3,600 of them.
fn week_cells(per_week: u32) -> impl Fn(u32) -> i64 {
    /// Midnight first. Nothing between two and seven, most in the evening.
    const HOURS: [u32; 24] = [
        3, 1, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 4, 4, 3, 3, 4, 5, 6, 8, 9, 9, 7, 5,
    ];
    /// Monday first. Friday and the weekend busier than the working week.
    const DAYS: [u32; 7] = [2, 2, 2, 2, 3, 4, 3];

    let weights: Vec<u64> = DAYS
        .iter()
        .flat_map(|day| HOURS.iter().map(move |hour| u64::from(day * hour)))
        .collect();
    let total: u64 = weights.iter().sum();
    // `starts[c]` is the first slot in cell `c`; an unweighted cell starts
    // where the next one does and is never picked.
    let starts: Vec<u32> = weights
        .iter()
        .scan(0_u64, |seen, weight| {
            let start = *seen * u64::from(per_week) / total;
            *seen += weight;
            Some(start as u32)
        })
        .chain(std::iter::once(per_week))
        .collect();

    move |slot| {
        let cell = starts.partition_point(|&start| start <= slot) - 1;
        let first = starts[cell];
        let held = starts[cell + 1] - first;
        cell as i64 * 3_600 + i64::from(slot - first) * 3_600 / i64::from(held)
    }
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
    fn seeded_plays_have_a_weekly_shape() {
        let (_dir, db) = temp_db();
        let mut conn = db.conn().unwrap();
        seed_plays(&mut conn, 7_000).unwrap();

        // In UTC, where the seed is laid out; the local-time week clock sees
        // the same shape shifted by the offset.
        let hour = |hour: u32| -> u32 {
            conn.query_row(
                "SELECT count(*) FROM plays
                 WHERE CAST(strftime('%H', started_at, 'unixepoch') AS INTEGER) = ?",
                [hour],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(hour(4), 0, "the small hours are empty");
        assert!(hour(20) > hour(12) * 2, "evenings outweigh middays");

        let weekday = |day: &str| -> u32 {
            conn.query_row(
                "SELECT count(*) FROM plays WHERE strftime('%w', started_at, 'unixepoch') = ?",
                [day],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(weekday("6") > weekday("1"), "Saturday outweighs Monday");
    }

    #[test]
    fn a_weeks_slots_fill_its_hours_without_sharing_a_second() {
        let at = week_cells(1_000);
        let seconds: Vec<i64> = (0..1_000).map(&at).collect();

        assert!(seconds.windows(2).all(|pair| pair[0] < pair[1]));
        assert!(seconds
            .iter()
            .all(|&second| (0..7 * 86_400).contains(&second)));
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
