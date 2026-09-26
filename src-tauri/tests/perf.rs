//! Guards the property the whole design rests on: query cost must not grow
//! with library size.
//!
//! **Cost is what SQLite counts, not what a clock reads.** These were timing
//! budgets once, and on the CI runner the same genre seed took 637ms on one
//! run and 56,715ms on another; a regroup that held the runner to itself
//! overran a budget of a minute all the same. No budget is both tight enough
//! to catch a regression and loose enough to pass that, so every one of them
//! failed now and then without anything having changed. The
//! counters below are the same on every machine and every run: a budget fails
//! when the work changes, and only then.
//!
//! What they exist to catch costs orders of magnitude rather than percent, and
//! each regression moves a counter of its own:
//!
//! - a dropped index or a `LIKE '%x%'` filter reads the whole table: `scanned`;
//! - an `ORDER BY` an index no longer serves sorts the rows instead: `sorts`;
//! - a statement or a transaction per row: `statements`, `commits`;
//! - grouping or sorting in Rust still fetches every row first, and a
//!   correlated subquery multiplies the rows it visits: `steps`.
//!
//! Budgets sit at two to three times what this fixture measures, so a SQLite
//! upgrade that reshuffles its opcodes passes and a change of shape - which
//! moves a counter by the size of the library - does not. **What none of them
//! see is Rust spending its time on rows already fetched.**

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use apex_lib::db::{genres, plays, query, stats, synthetic, tag_values, Db};
use apex_lib::model::{
    BrowseFilter, BrowseKind, HistogramField, ListenDimension, ListenQuery, SortDirection,
    SortField, TagValueField, TimeBucket, TimeRange, TrackQuery,
};
use apex_lib::scan;
use rusqlite::trace::{StmtRef, TraceEvent, TraceEventCodes};
use rusqlite::{Connection, StatementStatus};

const ROWS: usize = 10_000;
const R: u64 = ROWS as u64;

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

/// What SQLite did on one connection while a closure ran.
///
/// Doubles as a budget: [`assert_within`] holds every field to a maximum.
#[derive(Debug, Default, Clone, Copy)]
struct Work {
    /// Statement runs, including those FTS5 prepares for itself.
    statements: u64,
    /// Virtual machine instructions - the nearest thing SQLite has to a cost.
    steps: u64,
    /// Rows stepped over by a full scan of a table or an index.
    scanned: u64,
    /// Sorts through a temporary b-tree.
    sorts: u64,
    /// Write transactions, implicit ones included.
    commits: u64,
}

thread_local! {
    /// The status counters of each statement as it started. SQLite keeps them
    /// for the life of the statement, so one run is the difference between
    /// its start and its end; a statement executed once per row would
    /// otherwise count every earlier run again.
    static STARTED: RefCell<HashMap<String, [u64; 3]>> = RefCell::new(HashMap::new());
    static DONE: Cell<Work> = Cell::new(Work::default());
}

fn status(stmt: &StmtRef<'_>) -> [u64; 3] {
    [
        StatementStatus::VmStep,
        StatementStatus::FullscanStep,
        StatementStatus::Sort,
    ]
    .map(|counter| stmt.get_status(counter) as u64)
}

/// Keyed by SQL text: `StmtRef` does not expose the statement, and nothing
/// measured here runs one statement inside another of the same text.
fn observe(event: TraceEvent<'_>) {
    match event {
        // Also raised at the start of each trigger program, which is why the
        // first sighting wins.
        TraceEvent::Stmt(stmt, _) => STARTED.with_borrow_mut(|started| {
            started
                .entry(stmt.sql().into_owned())
                .or_insert_with(|| status(&stmt));
        }),
        TraceEvent::Profile(stmt, _) => {
            let before = STARTED
                .with_borrow_mut(|started| started.remove(stmt.sql().as_ref()))
                .unwrap_or_default();
            let [steps, scanned, sorts] = status(&stmt);
            let mut work = DONE.get();
            work.statements += 1;
            work.steps += steps.saturating_sub(before[0]);
            work.scanned += scanned.saturating_sub(before[1]);
            work.sorts += sorts.saturating_sub(before[2]);
            DONE.set(work);
        }
        _ => {}
    }
}

/// A connection to `db` that reports to [`work_of`].
fn counted(db: &Db) -> Connection {
    let conn = db.conn().unwrap();
    count_on(&conn);
    conn
}

fn count_on(conn: &Connection) {
    conn.trace_v2(
        TraceEventCodes::SQLITE_TRACE_STMT | TraceEventCodes::SQLITE_TRACE_PROFILE,
        Some(observe),
    );
    conn.commit_hook(Some(|| {
        DONE.with(|done| {
            let mut work = done.get();
            work.commits += 1;
            done.set(work);
        });
        false
    }))
    .unwrap();
}

/// What `run` cost on every connection this thread passed to [`count_on`].
fn work_of<T>(run: impl FnOnce() -> T) -> (Work, T) {
    STARTED.with_borrow_mut(HashMap::clear);
    DONE.set(Work::default());
    let out = run();
    (DONE.take(), out)
}

impl Work {
    fn counters(self) -> [u64; 5] {
        [
            self.statements,
            self.steps,
            self.scanned,
            self.sorts,
            self.commits,
        ]
    }
}

/// Each counter's name, and the regression that most often moves it.
const SUSPECTS: [(&str, &str); 5] = [
    ("statements", "a statement per row"),
    ("steps", "more rows visited than the shape allows"),
    ("scanned", "a table read an index used to serve"),
    ("sorts", "a sort an index used to make unnecessary"),
    ("commits", "a transaction per row"),
];

fn assert_within(label: &str, budget: Work, work: Work) {
    let over: Vec<String> = SUSPECTS
        .iter()
        .zip(work.counters().into_iter().zip(budget.counters()))
        .filter(|(_, (spent, max))| spent > max)
        .map(|((name, cause), (spent, max))| format!("{name} {spent} over {max} - {cause}?"))
        .collect();

    assert!(over.is_empty(), "{label}: {} ({work:?})", over.join("; "));
}

/// A page read off an index: the rows it returns and what it took to find
/// them, however large the library. Some 2,700 steps here, where the same
/// page sorted out of the whole table costs 74,000 and grows with it.
///
/// The sorts are allowed because they are small: an index that serves only
/// the leading column of an `ORDER BY` sorts each run of rows sharing it.
const PAGE: Work = Work {
    statements: 1,
    steps: 10_000,
    scanned: 1_000,
    sorts: 5,
    commits: 0,
};

/// One read of the table and nothing else. For work that is a fact about the
/// whole library, where what could go wrong is a second pass or a scan per
/// group rather than the first pass.
const fn one_pass(steps_per_row: u64, sorts: u64) -> Work {
    Work {
        statements: 1,
        steps: steps_per_row * R,
        scanned: R,
        sorts,
        commits: 0,
    }
}

#[test]
fn a_sorted_page_is_cheap_on_every_sort_column() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    // Title, album and length lead no index, so a page of them
    // is a top-hundred sort over one pass - linear, and the budget says so.
    // Everything else reads an index in order and costs a page.
    let top_hundred = one_pass(60, 1);
    for (sort_by, budget) in [
        (SortField::Title, top_hundred),
        (SortField::Artist, PAGE),
        (SortField::Album, top_hundred),
        (SortField::AlbumArtist, PAGE),
        (SortField::Year, PAGE),
        (SortField::DurationMs, top_hundred),
        (SortField::AddedAt, PAGE),
        (SortField::Path, PAGE),
    ] {
        for direction in [SortDirection::Asc, SortDirection::Desc] {
            let q = TrackQuery {
                sort_by,
                direction,
                offset: 0,
                limit: 100,
                ..Default::default()
            };
            let (work, rows) = work_of(|| query::query_tracks(&conn, &q).unwrap());
            assert_eq!(rows.len(), 100);
            assert_within(
                &format!("sorted page by {sort_by:?} {direction:?}"),
                budget,
                work,
            );
        }
    }
}

#[test]
fn paging_deep_into_the_library_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    // `OFFSET` walks the index up to the page, so the last page costs a pass
    // over the index where the first costs a page - that is what an offset
    // is. What keeps scrolling to the bottom usable is that it stays a walk:
    // no sort, and a few steps per row skipped rather than a row read.
    let q = TrackQuery {
        sort_by: SortField::Artist,
        offset: (ROWS - 100) as u32,
        limit: 100,
        ..Default::default()
    };
    let (work, rows) = work_of(|| query::query_tracks(&conn, &q).unwrap());
    assert_eq!(rows.len(), 100);
    assert_within("deep page", one_pass(10, 0), work);
}

#[test]
fn counting_the_library_is_cheap() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    let (work, count) = work_of(|| query::count_tracks(&conn, &TrackQuery::default()).unwrap());
    assert_eq!(count, ROWS as u32);
    assert_within("count", one_pass(16, 0), work);
}

/// A search goes through FTS5, which runs statements of its own against its
/// index - hence more than one - and never reads `tracks` whole.
const SEARCHED: Work = Work {
    statements: 30,
    steps: 10_000,
    scanned: 0,
    sorts: 1,
    commits: 0,
};

#[test]
fn search_is_cheap_and_uses_the_index() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        ..Default::default()
    };

    let (work, rows) = work_of(|| query::query_tracks(&conn, &q).unwrap());
    assert!(!rows.is_empty());
    assert_within("search page", SEARCHED, work);

    // 10_000 rows across 250 artists: exactly 40 tracks per artist.
    let (work, count) = work_of(|| query::count_tracks(&conn, &q).unwrap());
    assert_eq!(count, (ROWS / 250) as u32);
    assert_within("search count", SEARCHED, work);
}

#[test]
fn ranking_a_search_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        sort_by: SortField::Relevance,
        ..Default::default()
    };

    // bm25 scores every matching row rather than reading an index in order, so
    // this is the one sort whose cost grows with the size of the *match* - by
    // a statement per match, which is FTS5 reading each row's term counts. The
    // budget guards against a query shape that would score the whole library.
    let (work, rows) = work_of(|| query::query_tracks(&conn, &q).unwrap());
    assert!(!rows.is_empty());
    assert_within(
        "ranked search page",
        Work {
            statements: 150,
            ..SEARCHED
        },
        work,
    );
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
    let conn = counted(&db);

    // This runs on every query change - every keystroke that survives the
    // search debounce, every sort, every playlist switch - so it sits on the
    // same hot path as the page fetch. A full scan of three columns is what it
    // is; the budget catches it becoming three separate scans, or a join that
    // multiplies rows and quietly inflates the sums as well as the cost.
    let (work, stats) = work_of(|| query::library_stats(&conn, &TrackQuery::default()).unwrap());
    assert_eq!(stats.tracks, ROWS as u32);
    assert_within("library totals", one_pass(16, 0), work);
}

#[test]
fn totalling_a_filtered_view_stays_cheap() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);
    let q = TrackQuery {
        search: Some("Artist042".to_owned()),
        ..Default::default()
    };

    let (work, stats) = work_of(|| query::library_stats(&conn, &q).unwrap());
    assert!(stats.tracks > 0);
    assert_within("filtered totals", SEARCHED, work);
}

#[test]
fn browsing_stays_cheap_on_every_grouping() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);
    let q = TrackQuery::default();

    // The one query in the app with no LIMIT behind it: a GROUP BY reads every
    // row in scope rather than a window. That is inherent - a list of albums is
    // a fact about the whole library - so it is budgeted a pass. What it
    // catches is the shape going wrong: a correlated subquery per group, or
    // grouping in Rust after fetching every row.
    // Albums are keyed by (album, artist), and the fixture cycles those at 800
    // and 250, so it produces lcm(800, 250) = 4000 pairs rather than 800 - each
    // album title is reused by many artists. No real library looks like that;
    // it just makes this a harder case than the one it stands in for.
    for (kind, expected) in [
        (BrowseKind::Albums, 4000),
        (BrowseKind::Artists, 250),
        (BrowseKind::Genres, 20),
    ] {
        let (work, groups) = work_of(|| query::browse_groups(&conn, &q, kind).unwrap());
        assert_eq!(groups.len(), expected);
        assert_within(&format!("browse {kind:?}"), one_pass(200, 2), work);
    }
}

/// A drill-in reads its group through an expression index, so everything it
/// runs costs the group rather than the library. Per row of the group rather
/// than per page: the release ordering is a window over the whole drill-in,
/// which sorts all of it to cut the first page.
const fn drilled(rows: u64) -> Work {
    Work {
        statements: 1,
        steps: 500 * rows,
        scanned: 0,
        sorts: 2,
        commits: 0,
    }
}

#[test]
fn drilling_into_a_group_reads_only_the_group() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    // The fixture cycles 250 artists, 20 genres and lcm(800, 250) = 4000
    // (album, artist) pairs. A genre is the worst case the view has: a
    // twentieth of the library, grouped into 200 releases. The artist is
    // lower-cased because the index has to serve the NOCASE fold too.
    for (kind, id, rows) in [
        (BrowseKind::Artists, "artist042", R / 250),
        (BrowseKind::Albums, "Album042\u{1f}Artist042", 3),
        (BrowseKind::Genres, "Genre07", R / 20),
    ] {
        let q = TrackQuery {
            browse: Some(BrowseFilter {
                kind,
                id: Some(id.to_owned()),
            }),
            limit: 100,
            ..Default::default()
        };
        let budget = drilled(rows);

        let (work, page) = work_of(|| query::query_tracks(&conn, &q).unwrap());
        assert_eq!(page.len() as u64, rows.min(100), "{kind:?} page");
        assert_within(&format!("{kind:?} drill-in page"), budget, work);

        let (work, stats) = work_of(|| query::library_stats(&conn, &q).unwrap());
        assert_eq!(u64::from(stats.tracks), rows, "{kind:?} totals");
        assert_within(&format!("{kind:?} drill-in totals"), budget, work);

        let (work, releases) = work_of(|| query::release_groups(&conn, &q).unwrap());
        assert!(!releases.is_empty());
        assert_within(&format!("{kind:?} drill-in releases"), budget, work);
    }
}

#[test]
fn asking_how_many_files_are_missing_is_free() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    // Phase 16 put the missing count inside `library_stats`, which is on the
    // hot path - every keystroke past the debounce, every sort, every playlist
    // switch. It rides along in the same scan as the other three totals, so
    // this shares their budget; needing its own would mean it had become a
    // second pass over the table.
    let (work, stats) = work_of(|| query::library_stats(&conn, &TrackQuery::default()).unwrap());
    assert_eq!(stats.tracks, ROWS as u32);
    assert_eq!(stats.missing, 0);
    assert_within("totals with the missing count", one_pass(16, 0), work);
}

#[test]
fn marking_a_vanished_library_is_no_dearer_than_deleting_it_was() {
    // The change phase 16 makes to a scan: what used to be one DELETE per
    // vanished row is now one UPDATE per vanished row. The worst case is every
    // file at once - an unplugged drive - so that is what is measured.
    let (_dir, db) = seeded_library();
    let mut conn = counted(&db);

    // No watch folders are configured, so every row is a file the walk cannot
    // find, which is exactly the unplugged-drive shape. A statement per row is
    // the design - FTS5 adds several of its own to each - inside the one
    // transaction; an UPDATE that cannot use the primary key reads the table
    // once per row, which is `scanned` squared. The scan ends in
    // `plays::resolve`, and the commits are its, a track each - issue 166.
    let (work, summary) = work_of(|| scan::scan(&mut conn, |_| {}).unwrap());
    assert_eq!(summary.missing, ROWS as u32);
    assert_within(
        "marking every row missing",
        Work {
            statements: 25 * R,
            steps: 800 * R,
            scanned: 10 * R,
            sorts: 20,
            commits: 2 * R,
        },
        work,
    );

    // And the second scan, which has nothing new to say, must not pay for the
    // rows again: already-marked files are skipped before any write.
    let (work, again) = work_of(|| scan::scan(&mut conn, |_| {}).unwrap());
    assert_eq!(again.missing, 0);
    assert_within(
        "a rescan over already-marked rows",
        Work {
            statements: 3 * R,
            steps: 300 * R,
            scanned: 10 * R,
            sorts: 20,
            commits: 2 * R,
        },
        work,
    );
}

#[test]
fn a_suggestion_lookup_is_cheap_and_the_rebuild_that_feeds_it_is_affordable() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);

    // The rebuild is the cost of *not* keeping running counts in step with
    // every write. It runs after a scan and after a tag edit, so it is allowed
    // to be a whole-table pass per vocabulary - five grouped aggregates - but
    // no more than that.
    let (work, ()) = work_of(|| tag_values::rebuild(&conn).unwrap());
    assert_within(
        "rebuilding the vocabulary",
        Work {
            statements: 10,
            steps: 250 * R,
            scanned: 5 * R,
            sorts: 10,
            commits: 10,
        },
        work,
    );

    // The lookup is the one that runs while someone is typing, so it is the one
    // that has to be genuinely fast. It reads `tag_values`, which holds one row
    // per distinct value rather than one per track, so its cost should not
    // track the library at all.
    const LOOKUP: Work = Work {
        statements: 1,
        steps: 10_000,
        scanned: 1_000,
        sorts: 1,
        commits: 0,
    };
    for field in [
        TagValueField::Artist,
        TagValueField::Album,
        TagValueField::Genre,
        TagValueField::Year,
    ] {
        let (work, _) = work_of(|| tag_values::suggest(&conn, field, "0", 8).unwrap());
        assert_within(&format!("suggesting {field:?}"), LOOKUP, work);
    }

    // An empty query is the "show me the vocabulary" case an `is` filter opens
    // with, and it must not turn into a sort of the whole table.
    let (work, found) =
        work_of(|| tag_values::suggest(&conn, TagValueField::Artist, "", 8).unwrap());
    assert_eq!(found.len(), 8);
    assert_within("suggesting with no query typed yet", LOOKUP, work);
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
    let mut conn = Connection::open(dir.path().join("library.sqlite3")).unwrap();
    count_on(&conn);

    // Every migration, of which the genre seed is nearly all. Its INSERTs
    // carry 250 rows each; reshaped into one per genre, the statement count
    // goes from hundreds to over twenty thousand.
    let (work, ()) = work_of(|| apex_lib::db::migrate(&mut conn).unwrap());
    assert_within(
        "creating a database",
        Work {
            statements: 1_000,
            steps: 1_000_000,
            scanned: 5_000,
            sorts: 100,
            commits: 50,
        },
        work,
    );

    // Three unfiltered reads of tables that never change: a query per genre
    // is thousands of statements, and a data file grown past what it was
    // generated from is more rows read.
    let (work, tree) = work_of(|| genres::Tree::load(&conn).unwrap());
    assert_within(
        "loading the genre tree",
        Work {
            statements: 3,
            steps: 150_000,
            scanned: 30_000,
            sorts: 0,
            commits: 0,
        },
        work,
    );
    assert_eq!(
        tree.resolve("atmospheric black metal").parent.as_deref(),
        Some("black metal")
    );
}

/// How many plays the log budgets are measured over.
///
/// Every budget below is per play, and a counter is exact at any size, so the
/// log only has to be long enough to span the year `a_year` narrows to. It
/// was a quarter of a million - the round number above the library this was
/// written against - while a clock needed the work large enough to stand out
/// from the runner's noise.
const PLAYS: u32 = 100_000;
const P: u64 = PLAYS as u64;

/// `plays::resolve` reads every play on every run, which is the one perf risk
/// the play log takes on, and it is taken on purpose: the alternative is
/// re-resolving only the keys a write touched, which is correct but owes an
/// ordering dependency to every caller.
///
/// It inserts a key per track into a temporary table, a statement each, then
/// reads the log twice: once for the plays no key names, once in the guarded
/// `UPDATE`. **What catches the guard being lost is the count, not a budget**:
/// a warm run writes zero rows on any machine. The budgets are the coarser
/// question - whether it is still one pass over the log per read, and a
/// statement per track rather than per play. Those statements run outside a
/// transaction and commit one by one - issue 166.
#[test]
fn resolving_the_play_log_is_affordable_cold_and_cheap_warm() {
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    synthetic::seed_plays(&mut conn, PLAYS).unwrap();
    count_on(&conn);

    let budget = Work {
        statements: 2 * R,
        steps: 150 * (P + R),
        scanned: 3 * (P + R),
        sorts: 5,
        commits: 2 * R,
    };

    // Cold: every matched row moves off NULL. This is what runs once after an
    // import and once after a first scan.
    let (work, moved) = work_of(|| plays::resolve(&conn).unwrap());
    assert!(
        moved > 0,
        "a cold resolve that moved nothing measured nothing"
    );
    assert_within("a first resolve", budget, work);

    // Warm: the shape of every tag edit and every removal. The statement still
    // reads the whole log; the guard is what keeps it from writing it.
    let (work, moved) = work_of(|| plays::resolve(&conn).unwrap());
    assert_eq!(moved, 0);
    assert_within("resolve over an unchanged library", budget, work);
}

/// `plays::regroup` reads the whole log too, and the claim the design rests
/// on is that it is cheap anyway: the plays are some thirteen thousand
/// distinct `(artist, album)` pairs, so the `GROUP BY` is what it costs and
/// the fold runs once per pair rather than once per play. A statement per
/// pair on a cold run is the upsert; per play would be the fold moved.
#[test]
fn grouping_the_album_spellings_is_affordable_cold_and_cheap_warm() {
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    synthetic::seed_plays(&mut conn, PLAYS).unwrap();
    count_on(&conn);

    let (work, written) = work_of(|| plays::regroup(&conn).unwrap());
    assert!(
        written > 0,
        "a cold regroup that wrote nothing measured nothing"
    );
    assert_within(
        "a first regroup",
        Work {
            statements: P / 4,
            steps: 50 * P,
            scanned: 2 * P,
            sorts: 5,
            commits: 1,
        },
        work,
    );

    // Warm: nothing moved, so nothing is written - which is what keeps the
    // pass after every import from rewriting the whole table.
    let (work, written) = work_of(|| plays::regroup(&conn).unwrap());
    assert_eq!(written, 0);
    assert_within(
        "regroup over an unchanged log",
        Work {
            statements: 10,
            steps: 50 * P,
            scanned: 2 * P,
            sorts: 5,
            commits: 0,
        },
        work,
    );
}

/// Every Listening aggregate reads the whole log unless a range narrows it,
/// and that is the design rather than a lapse: there are no rollups to keep in
/// step. So each is one pass, and the budget is what catches it becoming more
/// than one - a correlated subquery per group, or grouping in Rust.
#[test]
fn every_listening_aggregate_is_one_pass_over_the_log() {
    let (_dir, db) = seeded_library();
    let mut conn = db.conn().unwrap();
    synthetic::seed_plays(&mut conn, PLAYS).unwrap();
    plays::resolve(&conn).unwrap();
    count_on(&conn);

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
    let pass = Work {
        statements: 10,
        steps: 200 * P,
        scanned: 2 * P,
        sorts: 5,
        commits: 0,
    };

    for (label, query) in [
        ("everything", &everything),
        ("a year", &a_year),
        ("a genre", &a_genre),
    ] {
        let (work, totals) = work_of(|| stats::listen_totals(&conn, query).unwrap());
        assert!(totals.plays > 0);
        assert_within(&format!("listen totals over {label}"), pass, work);
    }
    for dimension in [
        ListenDimension::Artist,
        ListenDimension::Album,
        ListenDimension::Track,
        ListenDimension::Genre,
    ] {
        let (work, top) = work_of(|| stats::top(&conn, &everything, dimension, 50).unwrap());
        assert!(!top.is_empty());
        assert_within(&format!("top {dimension:?}"), pass, work);
    }
    for bucket in [TimeBucket::Day, TimeBucket::Month] {
        let (work, series) =
            work_of(|| stats::plays_over_time(&conn, &everything, bucket).unwrap());
        assert!(!series.is_empty());
        assert_within(&format!("plays per {bucket:?}"), pass, work);
    }
    let (work, _) = work_of(|| stats::week_clock(&conn, &everything).unwrap());
    assert_within("the week clock", pass, work);
    let (work, _) = work_of(|| stats::firsts(&conn, &a_year, TimeBucket::Month).unwrap());
    assert_within("new artists in a year", pass, work);
    // All time, because `seed_plays` hears every artist first in its opening
    // week and a year's page would be empty.
    let (work, page) = work_of(|| stats::new_artists(&conn, &everything, 300, 100).unwrap());
    assert_eq!(page.len(), 100);
    assert_within("new artists, a page", pass, work);
    let (work, streaks) = work_of(|| stats::streaks(&conn, &everything, 0).unwrap());
    assert!(streaks.longest > 0);
    assert_within("streaks", pass, work);

    // The plays table's page, which is on the scroll path rather than the
    // panel one. Newest first reads `idx_plays_started` backwards, so even a
    // page near the far end is a walk along an index and not a sort.
    let (work, page) =
        work_of(|| stats::recent_plays(&conn, &everything, PLAYS - 100, 100).unwrap());
    assert_eq!(page.len(), 100);
    assert_within(
        "a deep page of plays",
        Work {
            statements: 1,
            steps: 8 * P,
            scanned: P,
            sorts: 0,
            commits: 0,
        },
        work,
    );
}

/// The Library tab reads `tracks` through `scope`, so these cost what a
/// browse grouping costs: a pass, and what catches a scan per group.
#[test]
fn every_library_aggregate_costs_what_a_browse_grouping_does() {
    let (_dir, db) = seeded_library();
    let conn = counted(&db);
    let q = TrackQuery::default();
    let pass = one_pass(200, 2);

    let (work, totals) = work_of(|| stats::library_totals(&conn, &q).unwrap());
    assert_eq!(totals.tracks, ROWS as u32);
    assert_within("library totals", pass, work);
    for field in [
        HistogramField::Bitrate,
        HistogramField::SampleRate,
        HistogramField::Year,
        HistogramField::Duration,
    ] {
        // Non-empty, which is the half the budget cannot state: every one of
        // these columns is filled by the seeder precisely so that the bins
        // are bins rather than the one group a table of NULLs collapses to.
        let (work, bins) = work_of(|| stats::histogram(&conn, &q, field).unwrap());
        assert!(!bins.is_empty());
        assert_within(&format!("histogram of {field:?}"), pass, work);
    }
    let (work, worst) = work_of(|| stats::worst_by_bitrate(&conn, &q, 100).unwrap());
    assert_eq!(worst.len(), 100);
    assert_within("worst albums by bitrate", pass, work);

    // Includes loading the genre tree, which is three more reads.
    let tree = Work {
        statements: 10,
        scanned: 5 * R,
        ..pass
    };
    let (work, breakdown) = work_of(|| stats::genre_breakdown(&conn, &q, None).unwrap());
    assert!(!breakdown.slices.is_empty());
    assert_within("the genre breakdown", tree, work);

    let (work, added) = work_of(|| stats::added_over_time(&conn, &q, TimeBucket::Month).unwrap());
    assert!(added.len() > 1);
    assert_within("additions per month", pass, work);
    let (work, health) = work_of(|| stats::tag_health(&conn, &q).unwrap());
    assert_eq!(health.tracks, ROWS as u32);
    assert_within("tag health", pass, work);

    // 84d's drill-down, which every panel above pays once. `genres::members`
    // loads the tree and reads every distinct genre, and `tracks.genre` has no
    // index - so this is the one clause in `scope` whose cost is a table scan
    // plus a walk rather than an index seek.
    let drilled = TrackQuery {
        genre: Some("Genre03".to_owned()),
        ..TrackQuery::default()
    };
    let (work, health) = work_of(|| stats::tag_health(&conn, &drilled).unwrap());
    assert!(health.tracks > 0);
    assert_within("tag health under a genre", tree, work);
}
