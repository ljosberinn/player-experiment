//! End-to-end exercise of the ingest path: real mp3 files on disk, through
//! the scanner, into SQLite, back out through the paged query API.

mod fixture;

use std::path::Path;

use apex_lib::db::{query, Db};
use apex_lib::model::{SortField, TrackQuery};
use apex_lib::scan;
use rusqlite::Connection;

struct Harness {
    _dir: tempfile::TempDir,
    music: std::path::PathBuf,
    db: Db,
}

fn harness() -> Harness {
    let dir = tempfile::tempdir().expect("tempdir");
    let music = dir.path().join("music");
    std::fs::create_dir_all(&music).unwrap();
    let db = Db::open(dir.path().join("library.sqlite3")).expect("open db");

    let conn = db.conn().unwrap();
    scan::add_watch_folder(&conn, &music).expect("add watch folder");

    Harness {
        _dir: dir,
        music,
        db,
    }
}

fn scan_now(db: &Db) -> apex_lib::model::ScanSummary {
    let mut conn = db.conn().unwrap();
    scan::scan(&mut conn, |_| {}).expect("scan")
}

fn all_tracks(conn: &Connection) -> Vec<apex_lib::model::Track> {
    query::query_tracks(
        conn,
        &TrackQuery {
            sort_by: SortField::Path,
            limit: 500,
            ..Default::default()
        },
    )
    .unwrap()
}

#[test]
fn ingests_a_library_and_reads_it_back() {
    let h = harness();
    fixture::library(&h.music);

    let summary = scan_now(&h.db);

    assert_eq!(summary.added, 5, "five mp3s, ignoring the jpg and txt");
    assert_eq!(summary.updated, 0);
    assert_eq!(summary.missing, 0);

    let conn = h.db.conn().unwrap();
    let tracks = all_tracks(&conn);
    assert_eq!(tracks.len(), 5);

    let maki = tracks
        .iter()
        .find(|t| t.path.ends_with("01 Maki.mp3"))
        .expect("Maki");
    assert_eq!(maki.title.as_deref(), Some("Maki"));
    assert_eq!(maki.artist.as_deref(), Some("Guitar"));
    assert_eq!(maki.album.as_deref(), Some("Tokyo"));
    assert_eq!(maki.album_artist.as_deref(), Some("Guitar"));
    assert_eq!(maki.genre.as_deref(), Some("Post Shoegaze"));
    assert_eq!(maki.year, Some(2012));
    assert_eq!(maki.track_no, Some(1));
    assert_eq!(maki.comment.as_deref(), Some("first"));
    assert!(
        maki.duration_ms > 0,
        "duration should come from the audio properties"
    );
    assert!(maki.cover_hash.is_some());

    // A date-shaped year tag still yields a plain year.
    let ute = tracks
        .iter()
        .find(|t| t.path.ends_with("01 Sleeping Ute.mp3"))
        .unwrap();
    assert_eq!(ute.year, Some(2012), "2012-09-18 should read as 2012");

    // The untagged file is ingested rather than skipped.
    let untagged = tracks
        .iter()
        .find(|t| t.path.ends_with("untagged.mp3"))
        .unwrap();
    assert_eq!(untagged.title, None);
    assert_eq!(untagged.artist, None);
    assert!(untagged.duration_ms > 0);
}

#[test]
fn identical_cover_art_is_stored_once() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let covers: i64 = conn
        .query_row("SELECT count(*) FROM covers", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        covers, 2,
        "two distinct images across three tracks that carry art"
    );

    let tracks = all_tracks(&conn);
    let tokyo: Vec<_> = tracks
        .iter()
        .filter(|t| t.album.as_deref() == Some("Tokyo"))
        .filter_map(|t| t.cover_hash.clone())
        .collect();
    assert_eq!(tokyo.len(), 2);
    assert_eq!(tokyo[0], tokyo[1], "same image must share one hash");
}

#[test]
fn cover_bytes_round_trip_for_the_protocol_handler() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let hash = all_tracks(&conn)
        .into_iter()
        .find_map(|t| t.cover_hash)
        .expect("a cover");

    let (mime, bytes) = query::cover_bytes(&conn, &hash)
        .unwrap()
        .expect("cover row");
    assert_eq!(mime, "image/jpeg");
    assert!(!bytes.is_empty());

    assert!(query::cover_bytes(&conn, "does-not-exist")
        .unwrap()
        .is_none());
}

#[test]
fn a_second_scan_finds_nothing_to_do() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let summary = scan_now(&h.db);

    assert_eq!(summary.added, 0);
    assert_eq!(summary.updated, 0);
    assert_eq!(summary.missing, 0);
    assert_eq!(
        summary.unchanged, 5,
        "unchanged files must not be re-parsed"
    );
}

#[test]
fn rescan_picks_up_additions_edits_and_deletions() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let before = all_tracks(&conn);
    let maki = before
        .iter()
        .find(|t| t.path.ends_with("01 Maki.mp3"))
        .unwrap()
        .clone();

    // Add one file.
    fixture::write_mp3(
        &h.music.join("Guitar/Tokyo/03 Akiko.mp3"),
        45,
        &fixture::Meta {
            title: Some("Akiko"),
            artist: Some("Guitar"),
            album: Some("Tokyo"),
            ..Default::default()
        },
    );
    // Retag an existing one.
    fixture::write_mp3(
        &h.music.join("Guitar/Tokyo/01 Maki.mp3"),
        40,
        &fixture::Meta {
            title: Some("Maki (Remastered)"),
            artist: Some("Guitar"),
            album: Some("Tokyo"),
            ..Default::default()
        },
    );
    // Delete one.
    std::fs::remove_file(h.music.join("loose/untagged.mp3")).unwrap();

    let summary = scan_now(&h.db);

    assert_eq!(summary.added, 1);
    assert_eq!(summary.updated, 1);
    assert_eq!(summary.missing, 1);

    let conn = h.db.conn().unwrap();
    let after = all_tracks(&conn);
    // Six, not five: the deleted file's row is marked, not dropped. Losing it
    // would take every playlist entry pointing at it, beyond recovery.
    assert_eq!(after.len(), 6);

    let retagged = after
        .iter()
        .find(|t| t.path.ends_with("01 Maki.mp3"))
        .unwrap();
    assert_eq!(retagged.title.as_deref(), Some("Maki (Remastered)"));
    assert_eq!(
        retagged.id, maki.id,
        "a retag must update the row, not replace it"
    );
    assert_eq!(
        retagged.added_at, maki.added_at,
        "re-tagging a file must not look like re-adding it"
    );

    let gone = after
        .iter()
        .find(|t| t.path.ends_with("untagged.mp3"))
        .expect("the deleted file keeps its row");
    assert!(gone.missing_since.is_some(), "and is marked as gone");
}

#[test]
fn a_file_that_comes_back_is_unmarked() {
    // The unplugged-drive case, which is the whole argument for marking.
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let path = h.music.join("Grizzly Bear/Shields/01 Sleeping Ute.mp3");
    let bytes = std::fs::read(&path).unwrap();
    std::fs::remove_file(&path).unwrap();
    assert_eq!(scan_now(&h.db).missing, 1);

    std::fs::write(&path, &bytes).unwrap();
    let summary = scan_now(&h.db);

    assert_eq!(summary.returned, 1);
    assert_eq!(summary.added, 0, "it is the same row, not a new one");
    let conn = h.db.conn().unwrap();
    let back = all_tracks(&conn)
        .into_iter()
        .find(|t| t.path.ends_with("01 Sleeping Ute.mp3"))
        .expect("Sleeping Ute");
    assert!(back.missing_since.is_none());
}

#[test]
fn a_rescan_does_not_move_the_moment_a_file_went_missing() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    std::fs::remove_file(h.music.join("Guitar/Tokyo/01 Maki.mp3")).unwrap();
    assert_eq!(scan_now(&h.db).missing, 1);
    let first = missing_since(&h.db, "01 Maki.mp3");

    // Still gone, so still marked - but the timestamp says when it went, not
    // when it was last looked for, and a second scan reports nothing new.
    let again = scan_now(&h.db);

    assert_eq!(again.missing, 0, "already-marked files are not news");
    assert_eq!(missing_since(&h.db, "01 Maki.mp3"), first);
}

#[test]
fn playing_a_marked_file_that_opens_clears_the_mark() {
    // The other way a mark goes away, and the one that needs no scan: the
    // player reports every successful load, and a file that opens is a file
    // that is there. Reported from a real build - a drive came back, the song
    // played, and the row kept its exclamation mark until the next rescan.
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let id = all_tracks(&conn)
        .into_iter()
        .find(|t| t.path.ends_with("01 Maki.mp3"))
        .expect("Maki")
        .id;

    scan::mark_missing(&conn, id).unwrap();
    assert!(missing_since(&h.db, "01 Maki.mp3").is_some());

    // True: something changed, which is what tells the view to reload.
    assert!(scan::clear_missing(&conn, id).unwrap());
    assert!(missing_since(&h.db, "01 Maki.mp3").is_none());

    // False the second time, and on every ordinary track. The player emits a
    // load event per song; reloading the whole view each time would be waste.
    assert!(!scan::clear_missing(&conn, id).unwrap());
}

#[test]
fn removing_missing_tracks_is_the_only_thing_that_deletes_rows() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    std::fs::remove_file(h.music.join("Guitar/Tokyo/01 Maki.mp3")).unwrap();
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    assert_eq!(all_tracks(&conn).len(), 5, "still there, just marked");

    assert_eq!(scan::remove_missing(&conn).unwrap(), 1);

    let left = all_tracks(&conn);
    assert_eq!(left.len(), 4);
    assert!(!left.iter().any(|t| t.path.ends_with("01 Maki.mp3")));
    // And it stays gone on the next scan rather than coming back as an
    // addition - the file is not on disk either.
    assert_eq!(scan_now(&h.db).added, 0);
}

/// When the named track was first noticed missing.
fn missing_since(db: &Db, suffix: &str) -> Option<i64> {
    let conn = db.conn().unwrap();
    all_tracks(&conn)
        .into_iter()
        .find(|t| t.path.ends_with(suffix))
        .expect("track")
        .missing_since
}

#[test]
fn deleting_a_track_leaves_no_orphan_in_the_search_index() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    std::fs::remove_file(h.music.join("Grizzly Bear/Shields/01 Sleeping Ute.mp3")).unwrap();
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let query = TrackQuery {
        search: Some("Sleeping".to_owned()),
        ..Default::default()
    };
    // A marked track is still in the library, so it is still findable - the
    // row and its index entry stay in step.
    assert_eq!(query::count_tracks(&conn, &query).unwrap(), 1);

    // It is the deletion that has to leave the index clean, and deletion is
    // now only ever this.
    scan::remove_missing(&conn).unwrap();

    assert_eq!(query::count_tracks(&conn, &query).unwrap(), 0);
}

#[test]
fn search_finds_tracks_ingested_from_disk() {
    let h = harness();
    fixture::library(&h.music);
    scan_now(&h.db);

    let conn = h.db.conn().unwrap();
    let count = |term: &str| {
        query::count_tracks(
            &conn,
            &TrackQuery {
                search: Some(term.to_owned()),
                ..Default::default()
            },
        )
        .unwrap()
    };

    assert_eq!(count("Grizzly"), 2);
    assert_eq!(count("Tokyo"), 2);
    assert_eq!(count("Shoegaze"), 2, "genre is searchable");
    assert_eq!(count("Saku"), 1, "prefix search");
}

#[test]
fn progress_reports_reach_completion() {
    let h = harness();
    fixture::library(&h.music);

    let mut events = Vec::new();
    let mut conn = h.db.conn().unwrap();
    scan::scan(&mut conn, |progress| events.push(progress)).unwrap();

    assert!(
        events.len() >= 2,
        "expected at least a start and a finish: {events:?}"
    );
    let first = events.first().unwrap();
    assert_eq!(first.scanned, 0);
    assert_eq!(first.total, 5);

    let last = events.last().unwrap();
    assert!(last.done, "the final event must be marked done");
    assert_eq!(last.added, 5);
    assert_eq!(last.scanned, last.total);
}

#[test]
fn a_corrupt_file_does_not_abort_the_scan() {
    let h = harness();
    fixture::library(&h.music);
    std::fs::write(h.music.join("broken.mp3"), b"definitely not an mp3").unwrap();

    let summary = scan_now(&h.db);

    assert_eq!(summary.added, 5, "the five valid files still land");

    let conn = h.db.conn().unwrap();
    assert!(
        !all_tracks(&conn)
            .iter()
            .any(|t| t.path.ends_with("broken.mp3")),
        "the unreadable file must not produce a row"
    );
}

#[test]
fn adding_a_watch_folder_rejects_a_path_that_is_not_a_directory() {
    let h = harness();
    let file = h.music.join("not-a-dir.mp3");
    std::fs::write(&file, b"x").unwrap();

    let conn = h.db.conn().unwrap();
    assert!(scan::add_watch_folder(&conn, &file).is_err());
    assert!(scan::add_watch_folder(&conn, Path::new("/nope/missing")).is_err());
}

#[test]
fn watch_folders_are_not_duplicated() {
    let h = harness();
    let conn = h.db.conn().unwrap();

    scan::add_watch_folder(&conn, &h.music).unwrap();
    scan::add_watch_folder(&conn, &h.music).unwrap();

    assert_eq!(scan::watch_folders(&conn).unwrap().len(), 1);
}
