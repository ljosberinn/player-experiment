//! Guards the property the whole design rests on: query cost must not grow
//! with library size.
//!
//! These are deliberately loose budgets. They are not a benchmark - they exist
//! to catch the kind of regression that turns a paged query into a full scan
//! (a dropped index, a `LIKE '%x%'` filter, sorting in Rust instead of SQL),
//! which costs orders of magnitude rather than percent.

use std::sync::{PoisonError, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Instant;

use apex_lib::db::{genres, plays, query, stats, synthetic, tag_values, Db};
use apex_lib::model::{
    BrowseFilter, BrowseKind, HistogramField, ListenDimension, ListenQuery, SortDirection,
    SortField, TagValueField, TimeBucket, TimeRange, TrackQuery,
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

/// Held shared by every test, and exclusively by a measurement that is a
/// single sample and so cannot shrug off a neighbour the way `assert_under`
/// does. A single sample over a write the size of the library needs it too,
/// not only the cold resolve: `marking_a_vanished_library` failed on the
/// runner beside a play-log seed without it.
///
/// Every test has to take it, because the one left out is the neighbour: the
/// cold resolve took 78s on the runner beside the library aggregates, where
/// it takes some 8s alone.
static RUNNER: RwLock<()> = RwLock::new(());

/// A panic in one test must not fail the rest through a poisoned lock.
fn alongside_others() -> RwLockReadGuard<'static, ()> {
    RUNNER.read().unwrap_or_else(PoisonError::into_inner)
}

fn alone() -> RwLockWriteGuard<'static, ()> {
    RUNNER.write().unwrap_or_else(PoisonError::into_inner)
}

#[test]
fn a_sorted_page_is_cheap_on_every_sort_column() {
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();

    assert_under("count", 100, || {
        assert_eq!(query::count_tracks(&conn, &q).unwrap(), ROWS as u32);
    });
}

#[test]
fn search_is_cheap_and_uses_the_index() {
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery {
        browse: Some(BrowseFilter {
            kind: BrowseKind::Artists,
            id: Some("Artist042".to_owned()),
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
    let _shared = alongside_others();
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
    let shared = alongside_others();
    // The change phase 16 makes to a scan: what used to be one DELETE per
    // vanished row is now one UPDATE per vanished row. The worst case is every
    // file at once - an unplugged drive - so that is what is measured.
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    drop(shared);

    // Both budgets below are a single sample, so this takes the runner alone
    // for the same reason the cold resolve does: run beside the play-log
    // seeds the first one measured 2449ms against a 2000ms budget.
    let _alone = alone();
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
    let _shared = alongside_others();
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
    let _shared = alongside_others();
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

/// How many plays the log budgets are measured over.
///
/// The library this feature was written against holds 237,572 scrobbles, so
/// the round number just above it is the one worth being sure of.
const PLAYS: u32 = 250_000;

/// `plays::resolve` reads every play on every run, which is the one perf risk
/// the play log takes on, and it is taken on purpose: the alternative is
/// re-resolving only the keys a write touched, which is correct but owes an
/// ordering dependency to every caller.
///
/// **Two budgets, because there are two paths and `assert_under` only ever
/// reports one of them.** It takes the minimum of five calls after a warm-up,
/// and every call after the first writes nothing, so a single budget would
/// silently measure the scan and never the rebuild. Unoptimised on a developer
/// machine the two are 1031ms and 163ms, and that sixfold gap is the guard in
/// the `UPDATE` earning its place.
///
/// **What catches the guard being lost is the count, not the clock.** A warm
/// run that writes nothing writes zero rows on any machine, where a time that
/// separated 163ms from 1031ms would have to sit inside the spread between
/// this machine and the runner. The budgets below are the coarser question -
/// whether the statement still has the shape of one pass over the log.
///
/// **And that spread is what the numbers are set against, because it is
/// wider than this file assumed.** A probe on the runner measured the cold
/// resolve at 7.6s to 7.8s three times over with nothing else running -
/// against the 8000ms it first shipped with, which is a budget that passes on
/// a good day and on no other. The same statement on a runner that was
/// half as fast at everything took 33s. So: 60s cold and 10s warm, which a
/// transaction per row - minutes over a quarter of a million of them - still
/// fails, and a busy runner does not.
#[test]
fn resolving_the_play_log_is_affordable_cold_and_cheap_warm() {
    let shared = alongside_others();
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    synthetic::seed_plays(&mut conn, PLAYS).unwrap();
    drop(shared);

    // Cold: every matched row moves off NULL. This is what runs once after an
    // import and once after a first scan, and it is measured directly rather
    // than through `assert_under`, because by construction no second call does
    // the same work.
    let _alone = alone();
    let start = Instant::now();
    let moved = plays::resolve(&conn).unwrap();
    let elapsed = start.elapsed().as_millis();
    assert!(
        moved > 0,
        "a cold resolve that moved nothing measured nothing"
    );
    assert!(
        elapsed <= 60_000,
        "a first resolve over {PLAYS} plays and {ROWS} tracks took {elapsed}ms, budget is \
         60000ms - it writes every matched row once, and a runner takes some 8s over it"
    );

    // Warm: the shape of every tag edit and every removal. The statement still
    // reads the whole log; the guard is what keeps it from writing it.
    assert_under("plays::resolve over an unchanged library", 10_000, || {
        assert_eq!(plays::resolve(&conn).unwrap(), 0);
    });
}

/// Every Listening aggregate reads the whole log unless a range narrows it,
/// and that is the design rather than a lapse: there are no rollups to keep in
/// step. So each is one pass, and the budget is what catches it becoming more
/// than one - a correlated subquery per group, or grouping in Rust.
///
/// 30ms to 690ms unoptimised on a developer machine, `listen_totals` the
/// dearest with three distinct counts over the same scan. 15s, for the reason
/// the budgets above give: the runner is some eightfold slower on a quiet day
/// and twice that on a busy one, and a budget that only clears the quiet day
/// is a test that reports the weather.
#[test]
fn every_listening_aggregate_is_one_pass_over_the_log() {
    let _shared = alongside_others();
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    synthetic::seed_plays(&mut conn, PLAYS).unwrap();
    plays::resolve(&conn).unwrap();

    let everything = ListenQuery::default();
    let a_year = ListenQuery {
        range: Some(TimeRange {
            from: 1_750_000_000,
            to: 1_750_000_000 + 365 * 86_400,
        }),
        ..ListenQuery::default()
    };
    let a_genre = ListenQuery {
        genre: Some("Genre03".to_owned()),
        ..ListenQuery::default()
    };
    const BUDGET: u128 = 15_000;

    for (label, query) in [
        ("everything", &everything),
        ("a year", &a_year),
        ("a genre", &a_genre),
    ] {
        assert_under(&format!("listen totals over {label}"), BUDGET, || {
            assert!(stats::listen_totals(&conn, query).unwrap().plays > 0);
        });
    }
    for dimension in [
        ListenDimension::Artist,
        ListenDimension::Album,
        ListenDimension::Track,
        ListenDimension::Genre,
    ] {
        assert_under(&format!("top {dimension:?}"), BUDGET, || {
            assert!(!stats::top(&conn, &everything, dimension, 50)
                .unwrap()
                .is_empty());
        });
    }
    for bucket in [TimeBucket::Day, TimeBucket::Month] {
        assert_under(&format!("plays per {bucket:?}"), BUDGET, || {
            assert!(!stats::plays_over_time(&conn, &everything, bucket)
                .unwrap()
                .is_empty());
        });
    }
    assert_under("the week clock", BUDGET, || {
        stats::week_clock(&conn, &everything).unwrap();
    });
    assert_under("new artists in a year", BUDGET, || {
        stats::firsts(&conn, &a_year, TimeBucket::Month).unwrap();
    });
    assert_under("streaks", BUDGET, || {
        assert!(stats::streaks(&conn, &everything, 0).unwrap().longest > 0);
    });

    // The plays table's page, which is on the scroll path rather than the
    // panel one. Newest first reads `idx_plays_started` backwards, so even a
    // page near the far end is a walk along an index and not a sort.
    assert_under("a deep page of plays", 1_000, || {
        let page = stats::recent_plays(&conn, &everything, PLAYS - 100, 100).unwrap();
        assert_eq!(page.len(), 100);
    });
}

/// The Library tab reads `tracks` through `scope`, so these cost what a
/// browse grouping costs. 20ms and under unoptimised on a developer machine,
/// and 2s here for the runner's sake - this catches a scan per group, not a
/// percentage.
#[test]
fn every_library_aggregate_costs_what_a_browse_grouping_does() {
    let _shared = alongside_others();
    let (_dir, db) = seeded_library();
    let conn = db.conn().unwrap();
    let q = TrackQuery::default();
    const BUDGET: u128 = 2_000;

    assert_under("library totals", BUDGET, || {
        assert_eq!(
            stats::library_totals(&conn, &q).unwrap().tracks,
            ROWS as u32
        );
    });
    for field in [
        HistogramField::Bitrate,
        HistogramField::SampleRate,
        HistogramField::Year,
        HistogramField::Duration,
    ] {
        // Non-empty, which is the half the budget cannot state: every one of
        // these columns is filled by the seeder precisely so that the bins
        // are bins rather than the one group a table of NULLs collapses to.
        assert_under(&format!("histogram of {field:?}"), BUDGET, || {
            assert!(!stats::histogram(&conn, &q, field).unwrap().is_empty());
        });
    }
    assert_under("worst albums by bitrate", BUDGET, || {
        assert_eq!(stats::worst_by_bitrate(&conn, &q, 100).unwrap().len(), 100);
    });
    // Includes loading the genre tree, which is the larger half.
    assert_under("the genre breakdown", BUDGET, || {
        assert!(!stats::genre_breakdown(&conn, &q, None)
            .unwrap()
            .slices
            .is_empty());
    });
    assert_under("additions per month", BUDGET, || {
        assert!(
            stats::added_over_time(&conn, &q, TimeBucket::Month)
                .unwrap()
                .len()
                > 1
        );
    });
    assert_under("tag health", BUDGET, || {
        assert_eq!(stats::tag_health(&conn, &q).unwrap().tracks, ROWS as u32);
    });

    // 84d's drill-down, which every panel above pays once. `genres::members`
    // loads the tree and reads every distinct genre, and `tracks.genre` has no
    // index - so this is the one clause in `scope` whose cost is a table scan
    // plus a walk rather than an index seek. 17ms against 10,000 rows on a
    // developer machine, nearly all of it the tree; the budget is what says
    // whether it ever needs the `tag_values` list instead.
    let drilled = TrackQuery {
        genre: Some("Genre03".to_owned()),
        ..TrackQuery::default()
    };
    assert_under("tag health under a genre", BUDGET, || {
        assert!(stats::tag_health(&conn, &drilled).unwrap().tracks > 0);
    });
}
