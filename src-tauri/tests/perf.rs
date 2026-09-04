//! Guards the property the whole design rests on: query cost must not grow
//! with library size.
//!
//! These are deliberately loose budgets. They are not a benchmark - they exist
//! to catch the kind of regression that turns a paged query into a full scan
//! (a dropped index, a `LIKE '%x%'` filter, sorting in Rust instead of SQL),
//! which costs orders of magnitude rather than percent.

use std::time::Instant;

use apex_lib::db::{genres, query, synthetic, tag_values, Db};
use apex_lib::model::{
    BrowseFilter, BrowseKind, SortDirection, SortField, TagValueField, TrackQuery,
};
use apex_lib::scan;

const ROWS: usize = 10_000;

/// A library of `ROWS` synthetic tracks.
///
/// The rows come from `db::synthetic`, which the e2e virtualization spec also
/// uses - written directly rather than through the scanner, because what these
/// measure is query cost rather than tag parsing.
fn seeded_library() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
    let mut conn = db.conn().unwrap();
    synthetic::seed(&mut conn, ROWS as u32).unwrap();
    (dir, db)
}

/// The fastest of five calls, not their mean: on a shared CI runner any one
/// call can be stalled by something that has nothing to do with the query, and
/// a mean carries that stall into the number the budget is compared against.
/// A query that lost its index is slow on every call, so the minimum moves
/// when the thing this guards against happens, and stays put when the machine
/// merely had a bad moment.
fn assert_under(label: &str, budget_ms: u128, mut work: impl FnMut()) {
    // One warm-up pass so page-cache effects do not dominate the measurement.
    work();

    let per_call = (0..5)
        .map(|_| {
            let start = Instant::now();
            work();
            start.elapsed().as_millis()
        })
        .min()
        .expect("five samples");

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
fn the_sorted_page_query_plan_reads_an_index_in_order_rather_than_sorting_everything() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();

    // A timing budget alone can be met by a fast machine doing the wrong
    // thing, so assert the plan directly - and on the statement the app
    // actually runs. A hand-written copy of it is what let a plan that sorts
    // the whole library on every page pass this guard for a release: the
    // index it names was being read, as a covering scan, while the ordering
    // still went through a temp b-tree.
    for sort_by in [
        SortField::Artist,
        SortField::AlbumArtist,
        SortField::Year,
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
            let detail = query::explain_query_tracks(&conn, &q).unwrap().join(" | ");
            assert!(
                !detail.contains("USE TEMP B-TREE FOR ORDER BY"),
                "sorting by {sort_by:?} {direction:?} should read an index in order, plan was: {detail}"
            );
        }
    }
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

#[test]
fn asking_how_many_files_are_missing_is_free() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();

    // Phase 16 put the missing count inside `library_stats`, which is on the
    // hot path - every keystroke past the debounce, every sort, every playlist
    // switch. It rides along in the same scan as the other three totals, so
    // this shares their budget; needing its own would mean it had become a
    // second pass over the table.
    assert_under("totals with the missing count", 60, || {
        let stats = query::library_stats(&conn, &q).unwrap();
        assert_eq!(stats.tracks, ROWS as u32);
        assert_eq!(stats.missing, 0);
    });
}

#[test]
fn marking_a_vanished_library_is_no_dearer_than_deleting_it_was() {
    // The change phase 16 makes to a scan: what used to be one DELETE per
    // vanished row is now one UPDATE per vanished row. The worst case is every
    // file at once - an unplugged drive - so that is what is measured.
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();

    let start = Instant::now();
    // No watch folders are configured, so every row is a file the walk cannot
    // find, which is exactly the unplugged-drive shape.
    let summary = scan::scan(&mut conn, |_| {}).unwrap();
    let elapsed = start.elapsed().as_millis();

    assert_eq!(summary.missing, ROWS as u32);
    // Deliberately loose, and looser than it first shipped: 400ms passed on
    // this machine and took 675ms on the CI runner, which is the slower and
    // therefore the honest reference. What this catches is the shape being
    // wrong - a transaction per row, or an UPDATE that cannot use the primary
    // key - which costs tens of seconds here, not a few hundred milliseconds.
    // It is also the rarest write in the app: the whole library at once.
    assert!(
        elapsed <= 2_000,
        "marking {ROWS} rows missing took {elapsed}ms, budget is 2000ms - a per-row \
         transaction, or an UPDATE that cannot use the primary key, is the usual cause"
    );

    // And the second scan, which has nothing new to say, must not pay for the
    // rows again: already-marked files are skipped before any write.
    let start = Instant::now();
    let again = scan::scan(&mut conn, |_| {}).unwrap();
    let elapsed = start.elapsed().as_millis();

    assert_eq!(again.missing, 0);
    assert!(
        elapsed <= 1_000,
        "a rescan over {ROWS} already-marked rows took {elapsed}ms, budget is 1000ms - \
         it reads every row and writes none, so it must stay well under the first scan"
    );
}

#[test]
fn a_suggestion_lookup_is_cheap_and_the_rebuild_that_feeds_it_is_affordable() {
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();

    // The rebuild is the cost of *not* keeping running counts in step with
    // every write. It runs after a scan and after a tag edit, so it is allowed
    // to be a whole-table pass - but it must stay in the range of the scan it
    // follows rather than doubling it.
    let start = Instant::now();
    tag_values::rebuild(&conn).unwrap();
    let elapsed = start.elapsed().as_millis();
    assert!(
        elapsed <= 1_000,
        "rebuilding the vocabulary over {ROWS} rows took {elapsed}ms, budget is 1000ms - \
         five grouped aggregates, so a regression here means an index was dropped"
    );

    // The lookup is the one that runs while someone is typing, so it is the one
    // that has to be genuinely fast. It reads `tag_values`, which holds one row
    // per distinct value rather than one per track, so its cost should not
    // track the library at all.
    for field in [
        TagValueField::Artist,
        TagValueField::Album,
        TagValueField::Genre,
        TagValueField::Year,
    ] {
        assert_under(&format!("suggesting {field:?}"), 10, || {
            tag_values::suggest(&conn, field, "0", 8).unwrap();
        });
    }

    // An empty query is the "show me the vocabulary" case an `is` filter opens
    // with, and it must not turn into a sort of the whole table.
    assert_under("suggesting with no query typed yet", 10, || {
        let found = tag_values::suggest(&conn, TagValueField::Artist, "", 8).unwrap();
        assert_eq!(found.len(), 8);
    });
}

/// The genre tree's two fixed costs, which every test in the workspace pays.
///
/// Migration 11 seeds 6,575 genres, 8,200 edges and 8,004 aliases from 871KB of
/// generated SQL, so a fresh database is no longer nearly free to create - and
/// `Db::open` runs in every test that touches one. `Tree::load` is what 84b
/// pays once per panel refresh. Neither scales with the library; both scale
/// with a data file that a regeneration could quietly multiply.
#[test]
fn the_genre_tree_is_cheap_to_seed_and_to_load() {
    let dir = tempfile::tempdir().unwrap();

    let start = Instant::now();
    let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
    let seeded = start.elapsed().as_millis();

    // 68ms unoptimised on a developer machine and 637ms on the CI runner, which
    // is the slower and therefore the honest reference - the same spread the
    // budget below `marking_a_vanished_library` records. 2000ms, because what
    // this catches is the seed being reshaped into something linear in
    // statements rather than in rows - one INSERT per genre instead of one per
    // 250 - which costs over a second locally and is paid by every test in the
    // workspace.
    assert!(
        seeded <= 2_000,
        "creating a database took {seeded}ms, budget is 2000ms - the genre seed is the \
         only large thing a migration does, so suspect its statement count first"
    );

    let conn = db.conn().unwrap();
    let start = Instant::now();
    let tree = genres::Tree::load(&conn).unwrap();
    let loaded = start.elapsed().as_millis();

    // 15ms locally, and the runner's figure is unknown because the assertion
    // above aborted before it the first time this ran. Loose by the same factor
    // the seed needed: three unfiltered reads either grow with the data file or
    // become a query per genre, and neither is a percentage.
    assert!(
        loaded <= 500,
        "loading the genre tree took {loaded}ms, budget is 500ms - it is three unfiltered \
         reads of tables that never change, so a query per genre is the usual cause"
    );
    assert_eq!(
        tree.resolve("atmospheric black metal").parent.as_deref(),
        Some("black metal")
    );
}
