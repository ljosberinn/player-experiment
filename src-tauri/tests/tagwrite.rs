//! Tag writing against real mp3 files: write, re-read with an independent
//! reader, undo, re-read again.

mod fixture;

use std::path::{Path, PathBuf};

use player_lib::db::Db;
use player_lib::model::{CoverEdit, TagEdit};
use player_lib::scan;
use player_lib::tags::{self, write};

struct Harness {
    _dir: tempfile::TempDir,
    music: PathBuf,
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

fn id_of(db: &Db, title: &str) -> i64 {
    db.conn()
        .unwrap()
        .query_row("SELECT id FROM tracks WHERE title = ?1", [title], |row| {
            row.get(0)
        })
        .unwrap_or_else(|e| panic!("no track titled {title:?}: {e}"))
}

fn path_of(db: &Db, track_id: i64) -> PathBuf {
    let path: String = db
        .conn()
        .unwrap()
        .query_row("SELECT path FROM tracks WHERE id = ?1", [track_id], |row| {
            row.get(0)
        })
        .unwrap();
    PathBuf::from(path)
}

/// What the library row says, for comparing against what the file says.
fn row(db: &Db, track_id: i64) -> (Option<String>, Option<String>, Option<i64>, Option<String>) {
    db.conn()
        .unwrap()
        .query_row(
            "SELECT title, artist, year, cover_hash FROM tracks WHERE id = ?1",
            [track_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap()
}

fn edit() -> TagEdit {
    TagEdit::default()
}

fn set(field: &str) -> Option<String> {
    Some(field.to_owned())
}

#[test]
fn a_write_round_trips_through_the_file_and_into_the_library() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    let summary = write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Maki (Remastered)"),
            genre: set("Dream Pop"),
            year: set("2019"),
            ..edit()
        },
        0,
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (1, 0));

    // The file is the source of truth, so read it back independently.
    let on_disk = tags::read(&path_of(&h.db, track)).unwrap();
    assert_eq!(on_disk.title.as_deref(), Some("Maki (Remastered)"));
    assert_eq!(on_disk.genre.as_deref(), Some("Dream Pop"));
    assert_eq!(on_disk.year, Some(2019));

    // And the row agrees without needing a rescan.
    let (title, _, year, _) = row(&h.db, track);
    assert_eq!(title.as_deref(), Some("Maki (Remastered)"));
    assert_eq!(year, Some(2019));
}

#[test]
fn a_field_the_edit_does_not_mention_survives_untouched() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let before = tags::read(&path_of(&h.db, track)).unwrap();

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        0,
    )
    .unwrap();

    // This is what makes a bulk edit over mixed values safe: everything the
    // user left as a dash has to come through unchanged.
    let after = tags::read(&path_of(&h.db, track)).unwrap();
    assert_eq!(after.title, before.title);
    assert_eq!(after.artist, before.artist);
    assert_eq!(after.album, before.album);
    assert_eq!(after.album_artist, before.album_artist);
    assert_eq!(after.year, before.year);
    assert_eq!(after.track_no, before.track_no);
    assert_eq!(after.cover.map(|c| c.hash), before.cover.map(|c| c.hash));
}

#[test]
fn an_empty_value_clears_the_field_rather_than_writing_an_empty_one() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: Some(String::new()),
            year: Some(String::new()),
            ..edit()
        },
        0,
    )
    .unwrap();

    let after = tags::read(&path_of(&h.db, track)).unwrap();
    assert_eq!(after.genre, None);
    assert_eq!(after.year, None);
    assert_eq!(row(&h.db, track).2, None);
}

#[test]
fn one_edit_covers_a_whole_selection() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let tracks = [id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")];

    let summary = write::apply(
        &mut conn,
        &tracks,
        &TagEdit {
            genre: set("Compilation"),
            ..edit()
        },
        0,
    )
    .unwrap();

    assert_eq!(summary.written, 2);
    for track in tracks {
        assert_eq!(
            tags::read(&path_of(&h.db, track)).unwrap().genre.as_deref(),
            Some("Compilation")
        );
    }
    // Each keeps its own title - a bulk edit is not a broadcast of every field.
    assert_ne!(row(&h.db, tracks[0]).0, row(&h.db, tracks[1]).0);
}

#[test]
fn undo_puts_every_field_of_a_batch_back() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let tracks = [id_of(&h.db, "Maki"), id_of(&h.db, "Sleeping Ute")];
    let before: Vec<_> = tracks
        .iter()
        .map(|&track| tags::read(&path_of(&h.db, track)).unwrap())
        .collect();

    write::apply(
        &mut conn,
        &tracks,
        &TagEdit {
            genre: set("Compilation"),
            comment: set("bulk edited"),
            year: set("1999"),
            ..edit()
        },
        0,
    )
    .unwrap();
    assert!(write::can_undo(&conn).unwrap());

    let summary = write::undo_last(&mut conn).unwrap();

    assert_eq!((summary.written, summary.failed), (2, 0));
    for (index, &track) in tracks.iter().enumerate() {
        let after = tags::read(&path_of(&h.db, track)).unwrap();
        assert_eq!(after.genre, before[index].genre);
        assert_eq!(after.comment, before[index].comment);
        assert_eq!(after.year, before[index].year);
    }
    assert!(
        !write::can_undo(&conn).unwrap(),
        "the batch should be spent"
    );
}

#[test]
fn undo_clears_a_field_the_edit_had_added() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    // This one has no comment of its own.
    let track = id_of(&h.db, "Sleeping Ute");
    assert_eq!(tags::read(&path_of(&h.db, track)).unwrap().comment, None);

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            comment: set("added"),
            ..edit()
        },
        0,
    )
    .unwrap();
    write::undo_last(&mut conn).unwrap();

    // Restoring "what was there" has to include restoring "nothing".
    assert_eq!(tags::read(&path_of(&h.db, track)).unwrap().comment, None);
    assert_eq!(
        h.db.conn()
            .unwrap()
            .query_row("SELECT comment FROM tracks WHERE id = ?1", [track], |r| {
                r.get::<_, Option<String>>(0)
            })
            .unwrap(),
        None
    );
}

#[test]
fn undo_goes_back_one_batch_at_a_time() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("First"),
            ..edit()
        },
        1,
    )
    .unwrap();
    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Second"),
            ..edit()
        },
        2,
    )
    .unwrap();

    write::undo_last(&mut conn).unwrap();
    assert_eq!(
        tags::read(&path_of(&h.db, track)).unwrap().genre.as_deref(),
        Some("First")
    );

    write::undo_last(&mut conn).unwrap();
    assert_eq!(
        tags::read(&path_of(&h.db, track)).unwrap().genre.as_deref(),
        Some("Post Shoegaze"),
        "the second undo should reach the original"
    );
}

#[test]
fn undoing_with_nothing_to_undo_says_so() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();

    assert!(!write::can_undo(&conn).unwrap());
    assert!(write::undo_last(&mut conn).is_err());
}

#[test]
fn cover_art_can_be_replaced_and_removed_and_put_back() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let original = tags::read(&path_of(&h.db, track)).unwrap().cover.unwrap();

    // A minimal but real PNG header, which is all the sniffer looks at.
    let replacement = h.music.join("new-cover.png");
    std::fs::write(
        &replacement,
        [0x89, b'P', b'N', b'G', 13, 10, 26, 10, 1, 2, 3],
    )
    .unwrap();

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            cover: Some(CoverEdit::Replace {
                path: replacement.to_string_lossy().into_owned(),
            }),
            ..edit()
        },
        1,
    )
    .unwrap();

    let swapped = tags::read(&path_of(&h.db, track)).unwrap().cover.unwrap();
    assert_ne!(swapped.hash, original.hash);
    assert_eq!(row(&h.db, track).3, Some(swapped.hash.clone()));

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            cover: Some(CoverEdit::Remove),
            ..edit()
        },
        2,
    )
    .unwrap();
    assert!(tags::read(&path_of(&h.db, track)).unwrap().cover.is_none());
    assert_eq!(row(&h.db, track).3, None);

    // Undoing the removal has to find the bytes again, which is why `covers`
    // is never pruned.
    write::undo_last(&mut conn).unwrap();
    assert_eq!(
        tags::read(&path_of(&h.db, track))
            .unwrap()
            .cover
            .map(|c| c.hash),
        Some(swapped.hash)
    );
}

#[test]
fn a_file_that_cannot_be_written_is_reported_and_the_rest_still_go() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let good = id_of(&h.db, "Maki");
    let doomed = id_of(&h.db, "Sleeping Ute");

    // Delete the file out from under the library: writing it must fail.
    std::fs::remove_file(path_of(&h.db, doomed)).unwrap();

    let summary = write::apply(
        &mut conn,
        &[doomed, good],
        &TagEdit {
            genre: set("Mixed"),
            ..edit()
        },
        0,
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (1, 1));
    assert_eq!(summary.errors.len(), 1);
    assert_eq!(
        tags::read(&path_of(&h.db, good)).unwrap().genre.as_deref(),
        Some("Mixed"),
        "one bad file must not undo the good ones"
    );
    // And the failure is not in the journal, so undo will not try to restore it.
    write::undo_last(&mut conn).unwrap();
    assert_eq!(
        tags::read(&path_of(&h.db, good)).unwrap().genre.as_deref(),
        Some("Post Shoegaze")
    );
}

#[test]
fn a_write_leaves_no_temporary_files_behind() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        0,
    )
    .unwrap();

    let directory = path_of(&h.db, track).parent().unwrap().to_path_buf();
    let leftovers: Vec<String> = std::fs::read_dir(&directory)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains("player-tmp"))
        .collect();

    assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
}

#[test]
fn the_written_file_is_still_a_playable_mp3() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let path = path_of(&h.db, track);
    let duration_before = tags::read(&path).unwrap().duration_ms;

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Still Audio"),
            ..edit()
        },
        0,
    )
    .unwrap();

    // Through the shipped decoder, not just the tag reader: a tag write that
    // corrupted the audio would otherwise pass every assertion above.
    let file = std::fs::File::open(&path).unwrap();
    assert!(
        rodio::Decoder::try_from(file).is_ok(),
        "the file no longer decodes after a tag write"
    );
    assert_eq!(tags::read(&path).unwrap().duration_ms, duration_before);
}

#[test]
fn a_rescan_after_an_edit_finds_nothing_to_do() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        0,
    )
    .unwrap();
    let summary = scan::scan(&mut conn, |_| {}).unwrap();

    // The row was updated in step with the file, including mtime and size, so
    // the incremental scan has no reason to reparse it.
    assert_eq!(
        summary.updated, 0,
        "the edit should have kept the row current"
    );
    assert_eq!(summary.added, 0);
    assert_eq!(summary.removed, 0);
}

#[test]
fn an_unparseable_number_is_refused_before_anything_is_written() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let before = tags::read(&path_of(&h.db, track)).unwrap();

    let error = write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Should Not Land"),
            year: set("twenty twelve"),
            ..edit()
        },
        0,
    )
    .unwrap_err();

    assert!(error.to_string().contains("Year"), "unhelpful: {error}");
    assert_eq!(
        tags::read(&path_of(&h.db, track)).unwrap().genre,
        before.genre,
        "a rejected edit must write nothing at all"
    );
}

#[test]
fn editing_a_track_the_library_no_longer_has_is_skipped_not_fatal() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    let summary = write::apply(
        &mut conn,
        &[9999, track],
        &TagEdit {
            genre: set("Fine"),
            ..edit()
        },
        0,
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (1, 0));
}

/// The scanner has to keep seeing the file as unchanged, which only holds if
/// the rename preserved the path exactly.
#[test]
fn the_file_keeps_its_name_and_place() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let path = path_of(&h.db, track);

    write::apply(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Renamed Tag"),
            ..edit()
        },
        0,
    )
    .unwrap();

    assert!(Path::new(&path).exists());
    assert_eq!(path_of(&h.db, track), path);
}
