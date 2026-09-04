//! What the unattended pass still has to do, drawn from the library itself.
//!
//! **There is no resume table and no migration.** A release whose files all sit
//! at their computed target is done, and the computation is string builds with
//! no I/O in them. The state is derived from the paths, which is the same
//! property that makes
//! [83b](../../../docs/issues/done/83b-moving-one-release.md)'s retries free,
//! and it survives the setting being turned off and on again.
//!
//! **It is not free.** [`query::for_each_release`] sorts every row in `tracks`
//! over expressions with no index behind them, which is why the worker's idle
//! backoff is not optional - and why this is re-run per batch rather than once
//! per sweep: a sweep runs for ninety hours, and a release retagged inside
//! one has to be picked up before it ends.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::{lookup, query};
use crate::error::AppResult;
use crate::library::{layout, mover};

/// One release with work left, and which of the two steps it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Pending {
    pub release: lookup::Release,
    /// One row of it, so the worker can ask what the release is called after a
    /// lookup has rewritten the album and artist on every file of it and the
    /// key this carries has stopped naming anything.
    pub track: i64,
    pub look_up: bool,
    pub place: bool,
}

/// Which steps are on, as the survey reads the library through them.
///
/// Both off is not a sweep: the thread does not start one.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Steps {
    pub look_up: bool,
    /// Where the library is filed, or `None` while it is not filed at all.
    pub root: Option<PathBuf>,
}

impl Steps {
    /// Whether either step is on. What the thread asks before it sweeps.
    pub fn any(&self) -> bool {
        self.look_up || self.root.is_some()
    }
}

/// What one pass over the library found.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Found {
    /// The first `limit` releases with work left, in the order they are read.
    pub batch: Vec<Pending>,
    /// Every release with either step left to do, batch included.
    ///
    /// The number that reaches 100%: the readout counts up from nothing to
    /// this, rather than from what a previous sweep already got through.
    pub total: usize,
}

/// Walks the library once and reports what is left to do.
///
/// `skip` is the releases this run has already visited - the ones it moved,
/// the one it deferred, the one that would not move. They are left out of the
/// batch **and** out of the total, so the readout does not stall a percent
/// short of the end on a release that is never coming back.
pub fn survey(
    conn: &Connection,
    steps: &Steps,
    limit: usize,
    skip: &HashSet<lookup::Key>,
) -> AppResult<Found> {
    // One read for the whole walk. Empty when the lookup is off, which is what
    // makes `look_up` below false for every release without a second check.
    let attempted = if steps.look_up {
        lookup::attempted(conn)?
    } else {
        HashSet::new()
    };

    let mut found = Found::default();
    query::for_each_release(conn, |album, artist, files| {
        let key = lookup::fold(&album, &artist);
        if skip.contains(&key) {
            return;
        }
        let release = lookup::Release { album, artist };

        // A release whose every row is missing is left out, the way
        // `lookup::pending` leaves it out: there is nothing to read a duration
        // from, and nothing to move either.
        let look_up =
            steps.look_up && !attempted.contains(&key) && files.iter().any(|file| !file.missing);
        let place = steps
            .root
            .as_deref()
            .is_some_and(|root| !placed(root, &release, files));
        if !look_up && !place {
            return;
        }

        found.total += 1;
        if found.batch.len() < limit {
            found.batch.push(Pending {
                release,
                track: files[0].id,
                look_up,
                place,
            });
        }
    })?;
    Ok(found)
}

/// Whether every file of `release` is already where it goes.
///
/// Through [`mover::shape`] and [`mover::track`] rather than rebuilding the
/// target beside them: two answers to where a file goes is the defect. The
/// harmless direction is a release this calls placed and the mover would have
/// moved; the other direction is a sweep offering the same release to a mover
/// that does nothing with it, every sweep, forever.
///
/// Missing rows do not count either way - there is no file to move - so a
/// release of nothing but missing rows is placed.
fn placed(root: &Path, release: &lookup::Release, files: &[query::ReleaseFile]) -> bool {
    let shape = mover::shape(release, files);
    files.iter().filter(|file| !file.missing).all(|file| {
        let ideal = root.join(layout::relative_path(root, &shape, &mover::track(file)));
        at_target(Path::new(&file.path), &ideal)
    })
}

/// Whether `actual` is `ideal`, or `ideal` wearing a collision marker.
///
/// Folding the marker in is what keeps a collided release - two releases whose
/// tags sanitize to one name - from reading as unplaced on every sweep,
/// forever. Compared against [`layout::suffixed`]'s own answer rather than by
/// stripping the marker, because that one also cuts the stem to keep the path
/// inside the ceiling, and a path built to the last character of its budget
/// does not carry the whole stem plus a marker.
fn at_target(actual: &Path, ideal: &Path) -> bool {
    actual == ideal
        || collision_nth(actual).is_some_and(|nth| actual == layout::suffixed(ideal, nth))
}

/// The `n` of a trailing ` (n)` on the file's stem.
fn collision_nth(path: &Path) -> Option<u32> {
    let stem = path.file_stem()?.to_str()?;
    let (before, nth) = stem.strip_suffix(')')?.rsplit_once(" (")?;
    if before.is_empty() {
        return None;
    }
    nth.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    const ALBUM: &str = "Loveless";
    const ARTIST: &str = "My Bloody Valentine";
    const FOLDER: &str = "My Bloody Valentine\\Loveless - 1991 - Album";

    fn open() -> (tempfile::TempDir, Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        (dir, db)
    }

    /// One row, wherever the caller says it is.
    fn track(conn: &Connection, path: &str, album: &str, artist: &str, track_no: i64) {
        conn.execute(
            "INSERT INTO tracks (path, mtime, size, album, album_artist, artist, title, year,
                                 track_no, release_type, added_at)
             VALUES (?1, 0, 0, ?2, ?3, ?3, ?4, 1991, ?5, 'Album', 0)",
            rusqlite::params![path, album, artist, format!("Track {track_no}"), track_no],
        )
        .unwrap();
    }

    fn mark_missing(conn: &Connection, path: &str) {
        conn.execute(
            "UPDATE tracks SET missing_since = 1 WHERE path = ?1",
            [path],
        )
        .unwrap();
    }

    /// Where the fixture's two tracks belong under `root`.
    fn target(root: &Path, track_no: i64) -> String {
        root.join(FOLDER)
            .join(format!("{track_no:02} - Track {track_no}.mp3"))
            .to_string_lossy()
            .into_owned()
    }

    fn organizing(root: &Path) -> Steps {
        Steps {
            look_up: false,
            root: Some(root.to_path_buf()),
        }
    }

    fn found(conn: &Connection, steps: &Steps) -> Found {
        survey(conn, steps, 10, &HashSet::new()).unwrap()
    }

    #[test]
    fn a_release_already_at_its_targets_has_nothing_left_to_do() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        track(&conn, &target(&root, 2), ALBUM, ARTIST, 2);

        assert_eq!(found(&conn, &organizing(&root)), Found::default());
    }

    #[test]
    fn a_release_one_file_short_of_placed_is_offered_whole() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        track(&conn, "D:\\Inbox\\02.mp3", ALBUM, ARTIST, 2);

        let found = found(&conn, &organizing(&root));
        assert_eq!(found.total, 1);
        assert_eq!(found.batch[0].release.album.as_deref(), Some(ALBUM));
        assert!(found.batch[0].place);
        assert!(!found.batch[0].look_up, "the lookup is off");
    }

    /// The collision suffix is 83b's, not a file out of place. Without this a
    /// collided release reads as unplaced on every sweep, forever.
    #[test]
    fn a_collision_suffix_still_counts_as_placed() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        let collided = target(&root, 2).replace(".mp3", " (2).mp3");
        track(&conn, &collided, ALBUM, ARTIST, 2);

        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// A number in the name is not a marker, and a marker on the wrong target
    /// is not one either.
    #[test]
    fn only_a_real_collision_marker_is_folded_in() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        let elsewhere = root.join(FOLDER).join("02 - Something Else (2).mp3");
        track(&conn, &elsewhere.to_string_lossy(), ALBUM, ARTIST, 2);

        assert_eq!(found(&conn, &organizing(&root)).total, 1);
    }

    #[test]
    fn a_missing_row_is_neither_placed_nor_unplaced() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        track(&conn, "D:\\Gone\\02.mp3", ALBUM, ARTIST, 2);
        mark_missing(&conn, "D:\\Gone\\02.mp3");

        assert_eq!(
            found(&conn, &organizing(&root)).total,
            0,
            "there is no file to move"
        );
    }

    /// The other half of the same rule: a missing row still shapes the folder
    /// the present ones go into, which is what keeps this and the mover
    /// agreeing about where that is.
    #[test]
    fn the_survey_agrees_with_the_mover_about_a_placed_release() {
        let (dir, db) = open();
        let mut conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        track(&conn, &target(&root, 2), ALBUM, ARTIST, 2);

        let release = lookup::Release {
            album: Some(ALBUM.to_owned()),
            artist: Some(ARTIST.to_owned()),
        };
        let moved = mover::move_release(
            &mut conn,
            &crate::scan::ScanLock::default(),
            &mover::OsRename,
            &root,
            &release,
            &HashSet::new(),
        )
        .unwrap();

        assert_eq!(moved, mover::Outcome::Done(mover::Moved::default()));
        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    #[test]
    fn a_release_with_no_row_is_the_lookups_to_do() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);

        let steps = Steps {
            look_up: true,
            root: Some(root),
        };
        let pending = found(&conn, &steps);
        assert_eq!(pending.total, 1);
        assert!(pending.batch[0].look_up);
        assert!(!pending.batch[0].place, "it is where it goes already");

        lookup::record(
            &conn,
            &pending.batch[0].release,
            lookup::Status::NotFound,
            None,
            None,
            None,
            0,
        )
        .unwrap();
        assert_eq!(found(&conn, &steps).total, 0);
    }

    #[test]
    fn the_batch_is_capped_and_the_total_is_not() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        for nth in 1..=4 {
            track(
                &conn,
                &format!("D:\\Inbox\\{nth}.mp3"),
                &format!("Album {nth}"),
                ARTIST,
                1,
            );
        }

        let found = survey(&conn, &organizing(&root), 2, &HashSet::new()).unwrap();
        assert_eq!(found.batch.len(), 2);
        assert_eq!(found.total, 4);
    }

    #[test]
    fn a_skipped_release_is_out_of_the_batch_and_out_of_the_total() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, "D:\\Inbox\\01.mp3", ALBUM, ARTIST, 1);
        track(&conn, "D:\\Inbox\\02.mp3", "Spiderland", "Slint", 1);

        let skip = HashSet::from([lookup::fold(
            &Some(ALBUM.to_owned()),
            &Some(ARTIST.to_owned()),
        )]);
        let found = survey(&conn, &organizing(&root), 10, &skip).unwrap();
        assert_eq!(found.total, 1);
        assert_eq!(found.batch[0].release.album.as_deref(), Some("Spiderland"));
    }
}
