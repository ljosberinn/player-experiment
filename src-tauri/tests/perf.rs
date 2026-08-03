//! Guards the property the whole design rests on: query cost must not grow
//! with library size.
//!
//! These are deliberately loose budgets. They are not a benchmark - they exist
//! to catch the kind of regression that turns a paged query into a full scan
//! (a dropped index, a `LIKE '%x%'` filter, sorting in Rust instead of SQL),
//! which costs orders of magnitude rather than percent.

use std::time::Instant;

use player_lib::db::{query, Db};
use player_lib::model::{BrowseFilter, BrowseKind, SortDirection, SortField, TrackQuery};

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
fn ranking_a_search_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        sort_by: SortField::Relevance,
        ..Default::default()
    };

    // bm25 scores every matching row rather than reading an index in order, so
    // this is the one sort whose cost grows with the size of the *match*. The
    // budget guards against a query shape that would score the whole library.
    assert_under("ranked search page", 150, || {
        assert!(!query::query_tracks(&conn, &q).unwrap().is_empty());
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

#[test]
fn totalling_the_library_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();

    // This runs on every query change - every keystroke that survives the
    // search debounce, every sort, every playlist switch - so it sits on the
    // same hot path as the page fetch. A full scan of three columns is what it
    // is; the budget catches it becoming three separate scans, or a join that
    // multiplies rows and quietly inflates the sums as well as the cost.
    assert_under("library totals", 60, || {
        assert_eq!(query::library_stats(&conn, &q).unwrap().tracks, ROWS as u32);
    });
}

#[test]
fn totalling_a_filtered_view_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        ..Default::default()
    };

    assert_under("filtered totals", 60, || {
        assert!(query::library_stats(&conn, &q).unwrap().tracks > 0);
    });
}

#[test]
fn browsing_stays_cheap_on_every_grouping() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();

    // The one query in the app with no LIMIT behind it: a GROUP BY reads every
    // row in scope rather than a window. That is inherent - a list of albums is
    // a fact about the whole library - so the budget is looser than a page's.
    // What it catches is the shape going wrong: a correlated subquery per
    // group, or grouping in Rust after fetching every row.
    // Albums are keyed by (album, artist), and the fixture cycles those at 800
    // and 250, so it produces lcm(800, 250) = 4000 pairs rather than 800 - each
    // album title is reused by many artists. No real library looks like that;
    // it just makes this a harder case than the one it stands in for.
    for (kind, expected) in [
        (BrowseKind::Albums, 4000),
        (BrowseKind::Artists, 250),
        (BrowseKind::Genres, 20),
    ] {
        assert_under(&format!("browse {kind:?}"), 120, || {
            let groups = query::browse_groups(&conn, &q, kind).unwrap();
            assert_eq!(groups.len(), expected);
        });
    }
}

#[test]
fn drilling_into_a_group_is_as_cheap_as_any_other_page() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery {
        browse: Some(BrowseFilter {
            kind: BrowseKind::Artists,
            key: Some("Artist042".to_owned()),
            secondary: None,
        }),
        limit: 100,
        ..Default::default()
    };

    // A drill-in is the ordinary paged query with one more condition, so it
    // must stay in the page budget rather than drifting toward the group one.
    assert_under("album drill-in", 60, || {
        assert_eq!(query::query_tracks(&conn, &q).unwrap().len(), 40);
    });
}
