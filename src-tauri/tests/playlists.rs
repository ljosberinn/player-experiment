//! Playlists over a real scanned library, exercised the way the UI does it:
//! build the list from track ids, then read it back through the ordinary
//! paged query with `playlist_id` set.

mod fixture;

use apex_lib::db::{playlists, query, Db};
use apex_lib::model::{SortField, TrackQuery};
use apex_lib::scan;

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
    fixture::library(&music);

    let mut conn = db.conn().unwrap();
    scan::scan(&mut conn, |_| {}).expect("scan");

    Harness {
        _dir: dir,
        music,
        db,
    }
}

/// Track ids in title order, so the tests can name tracks rather than ids.
fn id_of(db: &Db, title: &str) -> i64 {
    let conn = db.conn().unwrap();
    conn.query_row("SELECT id FROM tracks WHERE title = ?1", [title], |row| {
        row.get(0)
    })
    .unwrap_or_else(|e| panic!("no track titled {title:?}: {e}"))
}

fn view(db: &Db, playlist_id: i64) -> Vec<String> {
    let conn = db.conn().unwrap();
    query::query_tracks(
        &conn,
        &TrackQuery {
            playlist_id: Some(playlist_id),
            sort_by: SortField::Position,
            limit: 500,
            ..Default::default()
        },
    )
    .unwrap()
    .into_iter()
    .map(|track| track.title.unwrap_or_else(|| track.path.clone()))
    .collect()
}

#[test]
fn a_playlist_reads_back_through_the_ordinary_paged_query() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 1_700_000_000).unwrap();

    playlists::add_tracks(
        &mut conn,
        playlist.id,
        &[
            id_of(&h.db, "Wasted Acres"),
            id_of(&h.db, "Maki"),
            id_of(&h.db, "Sleeping Ute"),
        ],
    )
    .unwrap();

    assert_eq!(
        view(&h.db, playlist.id),
        ["Wasted Acres", "Maki", "Sleeping Ute"]
    );
    assert_eq!(
        playlists::get(&conn, playlist.id)
            .unwrap()
            .unwrap()
            .track_count,
        3
    );
}

#[test]
fn reordering_survives_reopening_the_database() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    let maki = id_of(&h.db, "Maki");
    playlists::add_tracks(
        &mut conn,
        playlist.id,
        &[
            maki,
            id_of(&h.db, "Sakura Coming"),
            id_of(&h.db, "Sleeping Ute"),
        ],
    )
    .unwrap();

    playlists::move_tracks(&mut conn, playlist.id, &[maki], 3).unwrap();
    drop(conn);

    // A second `Db` on the same file is what the next launch sees.
    let reopened = Db::open(h.db.path()).unwrap();
    assert_eq!(
        view(&reopened, playlist.id),
        ["Sakura Coming", "Sleeping Ute", "Maki"]
    );
}

#[test]
fn the_play_queue_for_a_playlist_is_the_playlists_own_order() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    let ids = [
        id_of(&h.db, "Sleeping Ute"),
        id_of(&h.db, "Maki"),
        id_of(&h.db, "Wasted Acres"),
    ];
    playlists::add_tracks(&mut conn, playlist.id, &ids).unwrap();

    // "Play from here" sends whatever `all_track_ids` returns for the view.
    let queue = query::all_track_ids(
        &conn,
        &TrackQuery {
            playlist_id: Some(playlist.id),
            sort_by: SortField::Position,
            ..Default::default()
        },
    )
    .unwrap();

    assert_eq!(queue, ids, "the queue must match the rows on screen");
    assert_eq!(playlists::track_ids(&conn, playlist.id).unwrap(), ids);
}

#[test]
fn a_rescan_that_finds_everything_leaves_playlists_alone() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    let ids = [id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")];
    playlists::add_tracks(&mut conn, playlist.id, &ids).unwrap();

    scan::scan(&mut conn, |_| {}).expect("rescan");

    assert_eq!(playlists::track_ids(&conn, playlist.id).unwrap(), ids);
}

/// The reason phase 16 exists. A vanished file used to be deleted from the
/// library, taking every playlist entry pointing at it - so an unplugged drive
/// was data loss rather than a temporary condition, and unrecoverable, since a
/// later rescan re-adds the file under a new id.
#[test]
fn a_file_that_disappears_keeps_its_playlist_entry() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    playlists::add_tracks(
        &mut conn,
        playlist.id,
        &[id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")],
    )
    .unwrap();

    std::fs::remove_file(h.music.join("Guitar/Tokyo/01 Maki.mp3")).unwrap();
    let summary = scan::scan(&mut conn, |_| {}).expect("rescan");
    assert_eq!(summary.missing, 1);

    assert_eq!(view(&h.db, playlist.id), ["Maki", "Sleeping Ute"]);
}

/// The other half: the entry does go when the user says so, because that is
/// the one place rows are destroyed.
#[test]
fn removing_missing_tracks_takes_their_playlist_entries_with_them() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    playlists::add_tracks(
        &mut conn,
        playlist.id,
        &[id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")],
    )
    .unwrap();

    std::fs::remove_file(h.music.join("Guitar/Tokyo/01 Maki.mp3")).unwrap();
    scan::scan(&mut conn, |_| {}).expect("rescan");
    assert_eq!(scan::remove_missing(&conn).unwrap(), 1);

    assert_eq!(view(&h.db, playlist.id), ["Sleeping Ute"]);
}

#[test]
fn searching_inside_a_playlist_filters_it_rather_than_the_library() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let playlist = playlists::create(&conn, "Evening", 0).unwrap();
    playlists::add_tracks(
        &mut conn,
        playlist.id,
        &[id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")],
    )
    .unwrap();

    let query = TrackQuery {
        playlist_id: Some(playlist.id),
        search: Some("Grizzly".to_owned()),
        sort_by: SortField::Relevance,
        limit: 500,
        ..Default::default()
    };

    // Two Grizzly Bear tracks are in the library; only one is in the playlist.
    assert_eq!(query::count_tracks(&conn, &query).unwrap(), 1);
    assert_eq!(
        query::query_tracks(&conn, &query).unwrap()[0]
            .title
            .as_deref(),
        Some("Sleeping Ute")
    );
}
