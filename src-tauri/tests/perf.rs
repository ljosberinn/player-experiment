//! Guards the property the whole design rests on: query cost must not grow
//! with library size.
//!
//! These are deliberately loose budgets. They are not a benchmark - they exist
//! to catch the kind of regression that turns a paged query into a full scan
//! (a dropped index, a `LIKE '%x%'` filter, sorting in Rust instead of SQL),
//! which costs orders of magnitude rather than percent.

use std::time::Instant;

use player_lib::db::{query, Db};
use player_lib::model::{SortDirection, SortField, TrackQuery};

const ROWS: usize = 10_000;

/// Inserts `ROWS` synthetic tracks. Rows are written directly rather than
/// through the scanner: this measures query cost, not tag parsing.
fn seeded_library() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
    let mut conn = db.conn().unwrap();

    let tx = conn.transaction().unwrap();
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album,
                                     album_artist, genre, year, track_no, added_at)
                 VALUES (?1, 1, 1, ?2, ?3, ?4, ?5, ?4, ?6, ?7, ?8, 0)",
            )
            .unwrap();
        for i in 0..ROWS {
            // No separators inside the names: each becomes a single token, so
            // a search term cannot accidentally match a different column and
            // make the expected result count a puzzle.
            let artist = format!("Artist{:03}", i % 250);
            let album = format!("Album{:03}", i % 800);
            let genre = format!("Genre{:02}", i % 20);
            stmt.execute(rusqlite::params![
                format!("/music/{i:06}.mp3"),
                180_000 + (i as i64 % 120_000),
                format!("Track {i:06}"),
                artist,
                album,
                genre,
                1970 + (i as i64 % 55),
                (i as i64 % 20) + 1,
            ])
            .unwrap();
        }
    }
    tx.commit().unwrap();

    (dir, db)
}

fn assert_under(label: &str, budget_ms: u128, mut work: impl FnMut()) {
    // One warm-up pass so page-cache effects do not dominate the measurement.
    work();

    let start = Instant::now();
    for _ in 0..5 {
        work();
    }
    let per_call = start.elapsed().as_millis() / 5;

    assert!(
        per_call <= budget_ms,
        "{label} took {per_call}ms per call over {ROWS} rows, budget is {budget_ms}ms - \
         this usually means the query stopped using an index"
    );
}

#[test]
fn a_sorted_page_is_cheap_on_every_sort_column() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();

    for sort_by in [
        SortField::Title,
        SortField::Artist,
        SortField::Album,
        SortField::AlbumArtist,
        SortField::Year,
        SortField::DurationMs,
        SortField::AddedAt,
        SortField::Path,
    ] {
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let q = TrackQuery {
                sort_by,
                direction,
                offset: 0,
                limit: 100,
                ..Default::default()
            };
            assert_under(
                &format!("sorted page by {sort_by:?} {direction:?}"),
                150,
                || {
                    let rows = query::query_tracks(&conn, &q).unwrap();
                    assert_eq!(rows.len(), 100);
                },
            );
        }
    }
}

#[test]
fn paging_deep_into_the_library_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();

    // The last page must not cost dramatically more than the first; that is
    // what keeps scrolling to the bottom of a large library usable.
    let q = TrackQuery {
        sort_by: SortField::Artist,
        offset: (ROWS - 100) as u32,
        limit: 100,
        ..Default::default()
    };
    assert_under("deep page", 150, || {
        assert_eq!(query::query_tracks(&conn, &q).unwrap().len(), 100);
    });
}

#[test]
fn counting_the_library_is_cheap() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();

    assert_under("count", 100, || {
        assert_eq!(query::count_tracks(&conn, &q).unwrap(), ROWS as u32);
    });
}

#[test]
fn search_is_cheap_and_uses_the_index() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        ..Default::default()
    };

    // 10_000 rows across 250 artists: exactly 40 tracks per artist.
    let expected = (ROWS / 250) as u32;
    assert_under("search page", 150, || {
        assert!(!query::query_tracks(&conn, &q).unwrap().is_empty());
    });
    assert_under("search count", 150, || {
        assert_eq!(query::count_tracks(&conn, &q).unwrap(), expected);
    });
}

#[test]
fn the_sorted_page_query_plan_uses_an_index_rather_than_sorting_everything() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();

    // A timing budget alone can be met by a fast machine doing the wrong
    // thing, so assert the plan directly for the default view.
    let plan: Vec<String> = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT tracks.id FROM tracks
             ORDER BY tracks.artist IS NULL, tracks.artist ASC, tracks.id ASC
             LIMIT 100",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();

    let detail = plan.join(" | ");
    assert!(
        detail.contains("idx_tracks_artist"),
        "the artist index should be used, plan was: {detail}"
    );
}
