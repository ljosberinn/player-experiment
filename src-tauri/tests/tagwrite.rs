//! Tag writing against real mp3 files: write, then re-read with an
//! independent reader.

mod fixture;

use std::path::{Path, PathBuf};

use apex_lib::db::Db;
use apex_lib::model::{CoverEdit, TagEdit};
use apex_lib::scan;
use apex_lib::tags::{self, write};

struct Harness {
    _dir: tempfile::TempDir,
    music: PathBuf,
    db: Db,
}

fn harness() -> Harness {
    harness_with_bulk(0)
}

/// The same library plus `bulk` interchangeable files, for the tests whose
/// subject is a batch too long to sit through.
fn harness_with_bulk(bulk: usize) -> Harness {
    let dir = tempfile::tempdir().expect("tempdir");
    let music = dir.path().join("music");
    std::fs::create_dir_all(&music).unwrap();
    let db = Db::open(dir.path().join("library.sqlite3")).expect("open db");

    let conn = db.conn().unwrap();
    scan::add_watch_folder(&conn, &music).expect("add watch folder");
    fixture::library(&music);
    fixture::bulk(&music, bulk);

    let mut conn = db.conn().unwrap();
    scan::scan(&mut conn, |_| {}).expect("scan");

    Harness {
        _dir: dir,
        music,
        db,
    }
}

/// Every id `fixture::bulk` put in the library, in a stable order.
fn bulk_ids(db: &Db) -> Vec<i64> {
    let conn = db.conn().unwrap();
    let mut statement = conn
        .prepare("SELECT id FROM tracks WHERE title = ?1 ORDER BY path")
        .unwrap();
    let ids = statement
        .query_map([fixture::BULK_TITLE], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect::<Vec<i64>>();
    ids
}

/// The properties a readout has to have for a user to trust it: it starts at
/// nothing, it never goes backwards or past its own total, it arrives, and it
/// gets there in steps rather than in one jump at the end.
fn assert_reports_as_it_goes(seen: &[apex_lib::model::WriteProgress], total: u32) {
    assert!(
        seen.len() > 2,
        "only {} reports for {total} files - a readout that moves once is a readout that does not move",
        seen.len()
    );
    assert_eq!(seen.first().unwrap().done, 0);
    assert_eq!(seen.last().unwrap().done, total);
    assert!(seen.iter().all(|p| p.total == total), "{seen:?}");

    let mut largest_step = 0;
    for pair in seen.windows(2) {
        let step = pair[1].done.checked_sub(pair[0].done).unwrap_or_else(|| {
            panic!(
                "the readout went backwards: {:?} then {:?}",
                pair[0], pair[1]
            )
        });
        largest_step = largest_step.max(step);
    }
    // No single step covers a quarter of the batch, which is what "it moves
    // smoothly rather than in one jump at the end" means in a number.
    assert!(
        largest_step <= total / 4,
        "one step covered {largest_step} of {total}: {seen:?}"
    );
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

/// What the row caches for the two MusicBrainz ids.
fn mbids(db: &Db, track_id: i64) -> (Option<String>, Option<String>) {
    db.conn()
        .unwrap()
        .query_row(
            "SELECT release_mbid, release_group_mbid FROM tracks WHERE id = ?1",
            [track_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap()
}

/// A release and its release group, as a lookup would supply them.
const RELEASE: &str = "8f468e8a-1b1b-4a53-9c0f-1f0f1a2b3c4d";
const RELEASE_GROUP: &str = "1c9a0e2f-5d3b-4a11-8e7d-9f8e7d6c5b4a";

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

    let summary = write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Maki (Remastered)"),
            genre: set("Dream Pop"),
            year: set("2019"),
            ..edit()
        },
        |_| {},
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

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        |_| {},
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

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: Some(String::new()),
            year: Some(String::new()),
            ..edit()
        },
        |_| {},
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

    let summary = write::apply_to_each(
        &mut conn,
        &tracks,
        &TagEdit {
            genre: set("Compilation"),
            ..edit()
        },
        |_| {},
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

/// The case a broadcast edit cannot express: a tracklist, where the title and
/// the track number differ per file.
#[test]
fn a_batch_of_per_track_edits_writes_each_one() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let first = id_of(&h.db, "Maki");
    let second = id_of(&h.db, "Sleeping Ute");

    let summary = write::apply(
        &mut conn,
        &[
            (
                first,
                TagEdit {
                    title: set("Track One"),
                    track_no: set("1"),
                    disc_no: set("1"),
                    ..edit()
                },
            ),
            (
                second,
                TagEdit {
                    title: set("Track Two"),
                    track_no: set("2"),
                    disc_no: set("2"),
                    ..edit()
                },
            ),
        ],
        |_| {},
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (2, 0));
    let one = tags::read(&path_of(&h.db, first)).unwrap();
    let two = tags::read(&path_of(&h.db, second)).unwrap();
    assert_eq!(
        (one.title.as_deref(), one.track_no, one.disc_no),
        (Some("Track One"), Some(1), Some(1))
    );
    assert_eq!(
        (two.title.as_deref(), two.track_no, two.disc_no),
        (Some("Track Two"), Some(2), Some(2))
    );

    // The rows are the only other thing the batch touches, and they agree
    // without a rescan.
    assert_eq!(row(&h.db, first).0.as_deref(), Some("Track One"));
    assert_eq!(row(&h.db, second).0.as_deref(), Some("Track Two"));
}

/// A malformed field anywhere in the batch refuses all of it, which only holds
/// because every edit is resolved before the first file is opened.
#[test]
fn an_unparseable_number_in_a_later_edit_stops_the_earlier_ones() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let first = id_of(&h.db, "Maki");
    let second = id_of(&h.db, "Sleeping Ute");

    let error = write::apply(
        &mut conn,
        &[
            (
                first,
                TagEdit {
                    title: set("Should Not Land"),
                    ..edit()
                },
            ),
            (
                second,
                TagEdit {
                    track_no: set("side b"),
                    ..edit()
                },
            ),
        ],
        |_| {},
    )
    .unwrap_err();

    assert!(error.to_string().contains("Track number"), "{error}");
    assert_eq!(
        tags::read(&path_of(&h.db, first)).unwrap().title.as_deref(),
        Some("Maki")
    );
}

/// The MBIDs go through the same three places as every other tag: written to
/// the file, read back off it, and cached in the row without a rescan.
#[test]
fn both_musicbrainz_ids_round_trip_into_the_file_and_the_row() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            release_mbid: set(RELEASE),
            release_group_mbid: set(RELEASE_GROUP),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    let on_disk = tags::read(&path_of(&h.db, track)).unwrap();
    assert_eq!(on_disk.release_mbid.as_deref(), Some(RELEASE));
    assert_eq!(on_disk.release_group_mbid.as_deref(), Some(RELEASE_GROUP));
    assert_eq!(
        mbids(&h.db, track),
        (Some(RELEASE.to_owned()), Some(RELEASE_GROUP.to_owned()))
    );

    // And they come back off the file, so a rescan cannot blank the columns.
    let summary = scan::scan(&mut conn, |_| {}).unwrap();
    assert_eq!((summary.added, summary.updated), (0, 0));
    assert_eq!(
        mbids(&h.db, track),
        (Some(RELEASE.to_owned()), Some(RELEASE_GROUP.to_owned()))
    );
}

/// Absent means leave alone here as everywhere else, which is what lets a
/// later lookup pass skip a release it has already resolved.
#[test]
fn an_edit_that_does_not_mention_the_mbids_leaves_the_ones_the_file_has() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    // The one the fixture tagged: it carries both before anything writes.
    let track = id_of(&h.db, "Sleeping Ute");
    assert_eq!(
        mbids(&h.db, track),
        (
            Some(fixture::SHIELDS_RELEASE.to_owned()),
            Some(fixture::SHIELDS_RELEASE_GROUP.to_owned())
        ),
        "the scan should have read what the file carries"
    );

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Indie"),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    let on_disk = tags::read(&path_of(&h.db, track)).unwrap();
    assert_eq!(
        on_disk.release_mbid.as_deref(),
        Some(fixture::SHIELDS_RELEASE)
    );
    assert_eq!(
        on_disk.release_group_mbid.as_deref(),
        Some(fixture::SHIELDS_RELEASE_GROUP)
    );
    // And the row still caches them, which is what lets a later pass skip the
    // release without opening the file.
    assert_eq!(
        mbids(&h.db, track),
        (
            Some(fixture::SHIELDS_RELEASE.to_owned()),
            Some(fixture::SHIELDS_RELEASE_GROUP.to_owned())
        )
    );
}

/// An empty value clears them, the same as any other text field - the lookup
/// needs a way to take back an identity it got wrong.
#[test]
fn an_empty_mbid_clears_the_one_the_file_had() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Sleeping Ute");

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            release_mbid: Some(String::new()),
            release_group_mbid: Some(String::new()),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    assert_eq!(
        tags::read(&path_of(&h.db, track)).unwrap().release_mbid,
        None
    );
    assert_eq!(mbids(&h.db, track), (None, None));
}

#[test]
fn cover_art_can_be_replaced_and_removed() {
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

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            cover: Some(CoverEdit::Replace {
                path: replacement.to_string_lossy().into_owned(),
            }),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    let swapped = tags::read(&path_of(&h.db, track)).unwrap().cover.unwrap();
    assert_ne!(swapped.hash, original.hash);
    assert_eq!(row(&h.db, track).3, Some(swapped.hash.clone()));

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            cover: Some(CoverEdit::Remove),
            ..edit()
        },
        |_| {},
    )
    .unwrap();
    assert!(tags::read(&path_of(&h.db, track)).unwrap().cover.is_none());
    assert_eq!(row(&h.db, track).3, None);
}

#[test]
fn a_file_that_cannot_be_written_is_reported_and_the_rest_still_go() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let good = id_of(&h.db, "Maki");
    let doomed = id_of(&h.db, "Sleeping Ute");

    // Delete the file out from under the library: writing it must fail.
    std::fs::remove_file(path_of(&h.db, doomed)).unwrap();

    let summary = write::apply_to_each(
        &mut conn,
        &[doomed, good],
        &TagEdit {
            genre: set("Mixed"),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (1, 1));
    assert_eq!(summary.errors.len(), 1);
    assert_eq!(
        tags::read(&path_of(&h.db, good)).unwrap().genre.as_deref(),
        Some("Mixed"),
        "one bad file must not cost the good ones"
    );
}

#[test]
fn a_write_leaves_no_temporary_files_behind() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        |_| {},
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

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Still Audio"),
            ..edit()
        },
        |_| {},
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

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Dream Pop"),
            ..edit()
        },
        |_| {},
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
    assert_eq!(summary.missing, 0);
}

#[test]
fn an_unparseable_number_is_refused_before_anything_is_written() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let before = tags::read(&path_of(&h.db, track)).unwrap();

    let error = write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            genre: set("Should Not Land"),
            year: set("twenty twelve"),
            ..edit()
        },
        |_| {},
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

    let summary = write::apply_to_each(
        &mut conn,
        &[9999, track],
        &TagEdit {
            genre: set("Fine"),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (1, 0));
}

#[test]
fn progress_starts_at_zero_and_lands_on_the_count_it_was_asked_for() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    // Includes an id the library does not have, because the readout counts
    // what it was asked to do rather than what it found to do - otherwise a
    // selection naming a removed row stops short of its own total.
    let ids = [id_of(&h.db, "Maki"), 9999];

    let mut seen: Vec<apex_lib::model::WriteProgress> = Vec::new();
    let summary = write::apply_to_each(
        &mut conn,
        &ids,
        &TagEdit {
            genre: set("Ambient"),
            ..edit()
        },
        |p| seen.push(p),
    )
    .unwrap();

    assert_eq!(summary.written, 1);
    assert_eq!(seen.first().unwrap().done, 0);
    assert!(seen.iter().all(|p| p.total == 2));
    assert_eq!(seen.last().unwrap().done, 2);
}

/// The scanner has to keep seeing the file as unchanged, which only holds if
/// the rename preserved the path exactly.
#[test]
fn the_file_keeps_its_name_and_place() {
    let h = harness();
    let mut conn = h.db.conn().unwrap();
    let track = id_of(&h.db, "Maki");
    let path = path_of(&h.db, track);

    write::apply_to_each(
        &mut conn,
        &[track],
        &TagEdit {
            title: set("Renamed Tag"),
            ..edit()
        },
        |_| {},
    )
    .unwrap();

    assert!(Path::new(&path).exists());
    assert_eq!(path_of(&h.db, track), path);
}

/// The batch the manual check used to be: large enough that the progress
/// interval fires several times, small enough to stay a test.
const BULK: usize = 120;

/// Standing in for "edit a few hundred files and watch the readout", which
/// needed a few hundred files nobody has in a checkout.
#[test]
fn a_batch_too_long_to_sit_through_reports_all_the_way_along() {
    let h = harness_with_bulk(BULK);
    let mut conn = h.db.conn().unwrap();
    let ids = bulk_ids(&h.db);
    assert_eq!(ids.len(), BULK);

    let mut seen: Vec<apex_lib::model::WriteProgress> = Vec::new();
    let summary = write::apply_to_each(
        &mut conn,
        &ids,
        &TagEdit {
            genre: set("Bulk Edited"),
            ..edit()
        },
        |p| seen.push(p),
    )
    .unwrap();

    assert_eq!((summary.written, summary.failed), (BULK as u32, 0));
    assert_reports_as_it_goes(&seen, BULK as u32);
    // The files, not just the count: a readout that reaches its total over a
    // batch that did not land is the failure this is here to catch.
    for id in [ids[0], ids[BULK / 2], ids[BULK - 1]] {
        assert_eq!(
            tags::read(&path_of(&h.db, id)).unwrap().genre.as_deref(),
            Some("Bulk Edited")
        );
    }
}
