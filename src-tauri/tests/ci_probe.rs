//! Temporary. Measures on the runner what cannot be reproduced locally: why
//! the cold `plays::resolve` budget went from passing to 13.7s and then 33s.
//! Reports by failing, because `cargo test` captures a passing test's output.

use std::time::Instant;

use apex_lib::db::{plays, synthetic, Db};
use rusqlite::Connection;

fn ms(work: impl FnOnce()) -> u128 {
    let start = Instant::now();
    work();
    start.elapsed().as_millis()
}

/// Seeds plays directly, so the spacing between timestamps is this probe's to
/// choose rather than `synthetic::seed_plays`'.
fn seed_plays_spaced(conn: &mut Connection, count: u32, spacing: i64) {
    const EPOCH: i64 = 1_700_000_000;
    let tracks: u32 = conn
        .query_row(
            "SELECT count(*) FROM tracks WHERE path LIKE 'synthetic://%'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    let tx = conn.transaction().unwrap();
    {
        let mut stmt = tx
            .prepare(
                "INSERT OR IGNORE INTO plays
                    (started_at, source, artist, title, album, duration_ms, match_key)
                 VALUES (?1, 'lastfm', ?2, ?3, ?4, 240000, ?5)",
            )
            .unwrap();
        for index in 0..count {
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
                EPOCH + i64::from(index) * spacing,
                artist,
                title,
                album,
                plays::match_key(&artist, &title),
            ])
            .unwrap();
        }
    }
    tx.commit().unwrap();
}

fn measure(report: &mut Vec<String>, label: &str, spacing: i64) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.sqlite3");

    let open = ms(|| {
        Db::open(&path).unwrap();
    });
    let db = Db::open(&path).unwrap();
    let mut conn = db.conn().unwrap();

    let tracks = ms(|| {
        synthetic::seed(&mut conn, 10_000).unwrap();
    });
    let seed = ms(|| seed_plays_spaced(&mut conn, 250_000, spacing));

    // Three cold runs: every link is put back to NULL between them, so each
    // one writes every matched row again. If only the first is slow, the cost
    // is first-touch disk rather than the statement.
    let mut cold = Vec::new();
    for _ in 0..3 {
        cold.push(ms(|| {
            plays::resolve(&conn).unwrap();
        }));
        conn.execute("UPDATE plays SET track_id = NULL", [])
            .unwrap();
    }
    let warm = ms(|| {
        plays::resolve(&conn).unwrap();
    });

    let size = std::fs::metadata(&path).map(|m| m.len() >> 20).unwrap_or(0);
    report.push(format!(
        "{label}: open={open}ms seed_tracks={tracks}ms seed_plays={seed}ms \
         cold={cold:?}ms warm_after_reset={warm}ms db={size}MB"
    ));
}

#[test]
fn probe() {
    let mut report = vec![String::new()];
    report.push(format!(
        "TZ={:?} threads={:?}",
        std::env::var("TZ"),
        std::thread::available_parallelism()
    ));
    measure(&mut report, "spacing 613s (this branch)", 613);
    measure(&mut report, "spacing 1s (as 76 had it)", 1);
    measure(&mut report, "spacing 613s again", 613);
    panic!("{}", report.join("\n"));
}
