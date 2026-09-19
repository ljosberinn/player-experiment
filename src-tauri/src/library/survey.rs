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

use std::collections::{HashMap, HashSet};
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
            .is_some_and(|root| !placed(conn, root, &release, files));
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
/// Through [`mover::shape`], [`mover::track`] and [`mover::free_target`] rather
/// than rebuilding the answer beside them: two answers to where a file goes is
/// the defect. The harmless direction is a release this calls placed and the
/// mover would have moved; the other direction is a sweep offering the same
/// release to a mover that does nothing with it, every sweep, forever.
///
/// Missing rows do not count either way - there is no file to move - so a
/// release of nothing but missing rows is placed.
fn placed(
    conn: &Connection,
    root: &Path,
    release: &lookup::Release,
    files: &[query::ReleaseFile],
) -> bool {
    let shape = mover::shape(release, files);
    files.iter().filter(|file| !file.missing).all(|file| {
        let source = Path::new(&file.path);
        let ideal = root.join(layout::relative_path(root, &shape, &mover::track(file)));
        // Through `layout::same`, which is where the case fold and its reasons
        // are. First because it answers the whole placed library without a
        // query: only a file that is somewhere else reaches the ask below.
        if layout::same(source, &ideal) {
            return true;
        }
        layout::marker(source).is_some() && earns_its_marker(conn, file.id, source, &ideal)
    })
}

/// Whether the marker `source` wears is the one the mover would give it.
///
/// [82i](../../../docs/issues/done/82i-paths-compare-byte-exact.md) accepted
/// any marker, which is what stopped the loop and is too generous by exactly
/// the markers the loop itself left behind:
/// [82m](../../../docs/issues/done/82m-a-marker-only-survives-while-held.md).
/// A number is earned while another row holds the plain name - including a row
/// marked missing, which `owned_by_other` counts on purpose - and is litter
/// once nothing does.
///
/// Asked with an empty `taken` where the mover asks with the release's
/// in-flight one, so the mover's answer can only be this one or higher. After
/// a move every file's row owns its target, so the next pass reproduces the
/// choice rather than offering the release again.
fn earns_its_marker(conn: &Connection, id: i64, source: &Path, ideal: &Path) -> bool {
    match mover::free_target(conn, id, source, ideal, &HashMap::new()) {
        Ok(target) => layout::same(source, &target),
        // A question that could not be asked reads as placed, which is the
        // harmless direction above.
        Err(_) => true,
    }
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

    /// Two rips merged into one release can disagree about the year, which is
    /// what 95 is about.
    fn set_year(conn: &Connection, path: &str, year: i64) {
        conn.execute(
            "UPDATE tracks SET year = ?2 WHERE path = ?1",
            rusqlite::params![path, year],
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

    /// The same row with a file behind it, for the tests that let the mover act
    /// on what the survey found.
    fn on_disk(conn: &Connection, path: &str, album: &str, artist: &str, track_no: i64) {
        let at = Path::new(path);
        std::fs::create_dir_all(at.parent().unwrap()).unwrap();
        std::fs::write(at, path).unwrap();
        track(conn, path, album, artist, track_no);
    }

    fn place(conn: &mut Connection, root: &Path, album: &str) -> mover::Outcome {
        mover::move_release(
            conn,
            &crate::scan::ScanLock::default(),
            &mover::OsRename,
            root,
            &lookup::Release {
                album: Some(album.to_owned()),
                artist: Some(ARTIST.to_owned()),
            },
            &HashSet::new(),
        )
        .unwrap()
    }

    fn paths(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT path FROM tracks ORDER BY id").unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        rows.collect::<rusqlite::Result<Vec<_>>>().unwrap()
    }

    /// Two albums that sanitize to one folder, which is what a collision
    /// marker is for: `?` and `*` are both illegal, and both become `_`.
    const COLLIDING: [&str; 2] = ["Loveless?", "Loveless*"];

    /// Where either of [`COLLIDING`]'s tracks belongs under `root`.
    fn shared_target(root: &Path, track_no: i64) -> String {
        target(root, track_no).replace("Loveless -", "Loveless_ -")
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

    /// The survey is what actually feeds the pass, so this is where a
    /// compilation being twelve releases of one file would have shown - and
    /// where its being one now has to hold.
    #[test]
    fn a_compilation_is_one_release_to_look_up() {
        let (_dir, db) = open();
        let conn = db.conn().unwrap();
        conn.execute(
            "INSERT INTO covers (hash, mime, bytes) VALUES ('art', 'image/jpeg', x'00')",
            [],
        )
        .unwrap();
        for track_no in 1..=12 {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, album, artist, title, track_no,
                                     cover_hash, added_at)
                 VALUES (?1, 0, 0, 'Bind Them', ?2, ?3, ?4, 'art', 0)",
                rusqlite::params![
                    format!("D:\\Inbox\\{track_no:02}.mp3"),
                    format!("Artist {track_no}"),
                    format!("Track {track_no}"),
                    track_no
                ],
            )
            .unwrap();
        }

        let found = found(
            &conn,
            &Steps {
                look_up: true,
                root: None,
            },
        );

        assert_eq!(found.total, 1);
        assert_eq!(
            found.batch[0].release.artist.as_deref(),
            Some(crate::db::query::VARIOUS_ARTISTS)
        );
        assert!(found.batch[0].look_up);
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
    ///
    #[test]
    fn a_marker_another_release_holds_the_name_for_is_placed() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &shared_target(&root, 1), COLLIDING[0], ARTIST, 1);
        let collided = shared_target(&root, 1).replace(".mp3", " (2).mp3");
        track(&conn, &collided, COLLIDING[1], ARTIST, 1);

        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// The marker the placement loop left behind: nothing holds the plain name,
    /// so the file is not where it goes and the mover takes the number off.
    #[test]
    fn a_marker_no_row_holds_the_name_for_comes_down() {
        let (dir, db) = open();
        let mut conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let marked = target(&root, 1).replace(".mp3", " (2).mp3");
        on_disk(&conn, &marked, ALBUM, ARTIST, 1);

        assert_eq!(found(&conn, &organizing(&root)).total, 1);

        place(&mut conn, &root, ALBUM);

        assert_eq!(paths(&conn), vec![target(&root, 1)]);
        assert!(Path::new(&target(&root, 1)).exists());
        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// A row marked missing holds the name too: `owned_by_other` counts it so
    /// that `UPDATE tracks SET path` cannot collide with it when the drive
    /// comes back. The marker stays until the user removes the row.
    #[test]
    fn a_marker_a_missing_row_holds_the_name_for_is_placed() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        track(&conn, &target(&root, 1), ALBUM, ARTIST, 1);
        mark_missing(&conn, &target(&root, 1));
        let collided = target(&root, 1).replace(".mp3", " (2).mp3");
        track(&conn, &collided, ALBUM, ARTIST, 1);

        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// The mover asks with the release's in-flight `taken` and this asks with
    /// none, so two files of one release sanitizing to one name settle in the
    /// pass that moved them rather than being offered again.
    #[test]
    fn a_release_whose_own_files_collide_settles_in_one_pass() {
        let (dir, db) = open();
        let mut conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let inbox = dir.path().join("Inbox");
        for name in ["a.mp3", "b.mp3"] {
            let at = inbox.join(name).to_string_lossy().into_owned();
            on_disk(&conn, &at, ALBUM, ARTIST, 1);
        }

        place(&mut conn, &root, ALBUM);

        assert_eq!(
            paths(&conn),
            vec![
                target(&root, 1),
                target(&root, 1).replace(".mp3", " (2).mp3")
            ]
        );
        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// 95: two rips of one release, disagreeing about the year, with the
    /// marker on the row whose year lost. The folder was named through the
    /// marker, the move handed the marker to the other row, and the next sweep
    /// named the folder back - every file moving, every 15 seconds, forever.
    #[test]
    fn a_release_whose_rips_disagree_about_the_year_settles_in_one_pass() {
        let (dir, db) = open();
        let mut conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let inbox = dir.path().join("Inbox");
        let plain = inbox
            .join("01 - Track 1.mp3")
            .to_string_lossy()
            .into_owned();
        let marked = inbox
            .join("01 - Track 1 (2).mp3")
            .to_string_lossy()
            .into_owned();
        on_disk(&conn, &plain, ALBUM, ARTIST, 1);
        on_disk(&conn, &marked, ALBUM, ARTIST, 1);
        set_year(&conn, &plain, 1994);
        set_year(&conn, &marked, 1995);

        place(&mut conn, &root, ALBUM);

        let placed = target(&root, 1).replace("1991", "1994");
        assert_eq!(
            paths(&conn),
            vec![placed.clone(), placed.replace(".mp3", " (2).mp3")]
        );
        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// The ideal is built from the tags and the directory is what it is really
    /// called. Compared byte-exact, the release is offered on every sweep,
    /// forever - the loop 82i ends.
    #[test]
    fn a_directory_cased_differently_than_its_tags_is_placed() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let folded = |nth| target(&root, nth).replace("Loveless", "loveless");
        track(&conn, &folded(1), ALBUM, ARTIST, 1);
        track(&conn, &folded(2), ALBUM, ARTIST, 2);

        assert_eq!(found(&conn, &organizing(&root)), Found::default());
    }

    /// 94: the same rule past ASCII. NTFS folds `Ü` the way it folds `U`, so
    /// the release the tags spell `Lügenkabinett` is in the folder disk spells
    /// `LÜGENKABINETT` - and an ASCII-only compare offered it to the mover on
    /// every sweep, forever.
    #[test]
    fn a_directory_cased_differently_past_ascii_is_placed_too() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let folder = root.join("Akrea\\LÜGENKABINETT - 1991 - Album");
        for nth in 1..=2 {
            let at = folder.join(format!("{nth:02} - Track {nth}.mp3"));
            track(&conn, &at.to_string_lossy(), "Lügenkabinett", "Akrea", nth);
        }

        assert_eq!(found(&conn, &organizing(&root)), Found::default());
    }

    /// And in the artist folder, which is the half of 94 that re-placed six
    /// releases of one artist rather than one.
    #[test]
    fn an_artist_folder_cased_differently_past_ascii_is_placed_too() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let at = root.join("Fjørt\\Couleur - 1991 - Album\\01 - Track 1.mp3");
        track(&conn, &at.to_string_lossy(), "Couleur", "FJØRT", 1);

        assert_eq!(found(&conn, &organizing(&root)), Found::default());
    }

    /// The fold is case and nothing else: a folder differing by a character is
    /// a folder the release is not in.
    #[test]
    fn a_directory_differing_by_a_character_is_not_placed() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let at = root.join("Akrea\\Lugenkabinett - 1991 - Album\\01 - Track 1.mp3");
        track(&conn, &at.to_string_lossy(), "Lügenkabinett", "Akrea", 1);

        assert_eq!(found(&conn, &organizing(&root)).total, 1);
    }

    /// And the row that makes a marker earned is matched on the same terms: it
    /// is the file that holds the name, whatever casing it is spelled in.
    #[test]
    fn the_row_holding_the_name_is_matched_case_insensitively() {
        let (dir, db) = open();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        let folded = shared_target(&root, 1).replace("Loveless_", "loveless_");
        track(&conn, &folded, COLLIDING[0], ARTIST, 1);
        let collided = shared_target(&root, 1).replace(".mp3", " (2).mp3");
        track(&conn, &collided, COLLIDING[1], ARTIST, 1);

        assert_eq!(found(&conn, &organizing(&root)).total, 0);
    }

    /// A number in the name is not a marker, and a marker on another name is
    /// not one on this file's.
    #[test]
    fn a_file_under_another_name_is_not_placed_by_its_number() {
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
