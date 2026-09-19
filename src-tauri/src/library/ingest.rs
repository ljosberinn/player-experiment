//! What a drop from the OS does to the library.
//!
//! [85b](../../../docs/issues/done/85b-drop-files-and-folders.md). The
//! second thing in the app, after File ▸ Add Folders…, that puts music in the
//! library.
//!
//! **Nothing here inserts a row.** The scan that follows a drop is what makes
//! rows, from tags it reads itself; this only has to leave the filesystem and
//! `removed_paths` in a state where that scan sees the file. Which is also why
//! there is no window in which a row points outside every watch root - the
//! order is not "insert then move", it is "move, then let the scan find it".

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::mover::{self, Rename};
use crate::db::settings;
use crate::error::AppResult;
use crate::model::DropSummary;
use crate::scan;

/// The row id `free_target` excludes from a collision, for a file that has no
/// row: `tracks` ids are positive, so nothing is excluded.
const NO_ROW: i64 = -1;

/// Takes the paths of one drop.
///
/// Folders first, and the roots re-read after them, so a drop carrying a
/// folder and a file inside it adopts the file rather than refusing it.
pub fn ingest(conn: &Connection, fs: &dyn Rename, paths: &[PathBuf]) -> AppResult<DropSummary> {
    let mut summary = DropSummary::default();
    let (folders, files): (Vec<_>, Vec<_>) = paths.iter().partition(|path| path.is_dir());

    let mut roots = scan::watch_folders(conn)?;
    for folder in folders {
        // A folder a root already covers is walked by every scan as it is, and
        // adding it again is a row in Settings that does nothing.
        if covered(&roots, folder) {
            continue;
        }
        scan::add_watch_folder(conn, folder)?;
        roots.push(folder.clone());
        summary.folders += 1;
    }

    // `Some` only while organizing is on, which is the switch this reads.
    let root = settings::library_root(conn)?;
    for file in files {
        if !scan::is_audio_file(file) {
            summary.ignored += 1;
            continue;
        }
        if covered(&roots, file) {
            // Nothing moves: the scan already walks where it lies. All it needs
            // is its tombstone off, which is the drag-it-back-in case 73 left.
            lift(conn, file)?;
            summary.adopted += 1;
        } else if let Some(root) = &root {
            summary.moved += place(conn, fs, root, file)?;
        } else {
            summary.refused += 1;
        }
    }
    Ok(summary)
}

/// Moves one file to the top level of the Library folder.
///
/// **Not to 83a's target.** That layout is a function of a release -
/// `mover::shape` resolves the artist across the release's rows, takes the year
/// most of them agree on and counts discs over all of them - and a file with no
/// row answers none of it. A target computed here would be a third answer to
/// where a file goes, differing from what `survey` computes, so the worker
/// would move the file a second time on its next sweep. It files this one from
/// the top level instead, which it reaches the same way.
///
/// The tombstone comes off after the target is chosen and before the file
/// lands: `free_target` steps around a tombstoned file that is really there,
/// and the row that bites is the one on a path with nothing behind it, which
/// `scan::plan` would skip before marking seen - forever.
fn place(conn: &Connection, fs: &dyn Rename, root: &Path, file: &Path) -> AppResult<u32> {
    let Some(name) = file.file_name() else {
        return Ok(0);
    };
    let target = mover::free_target(conn, NO_ROW, file, &root.join(name), &HashMap::new())?;
    lift(conn, &target)?;
    mover::place_file(fs, file, &target)?;
    Ok(1)
}

/// Takes `path` out of `removed_paths`.
///
/// `COLLATE NOCASE` for the reason `mover` has it: `scan::plan` folds the
/// tombstones it reads, so one written in another casing is on this file and
/// has to come off with it.
fn lift(conn: &Connection, path: &Path) -> AppResult<()> {
    conn.execute(
        "DELETE FROM removed_paths WHERE path = ?1 COLLATE NOCASE",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

fn covered(roots: &[PathBuf], path: &Path) -> bool {
    roots.iter().any(|root| under(root, path))
}

/// Whether `path` is `root` or lies inside it.
///
/// Component by component rather than on the strings: the two can disagree on
/// separator, and `D:\Musicology` starts with `D:\Music`.
fn under(root: &Path, path: &Path) -> bool {
    let mut inside = path.components();
    for segment in root.components() {
        match inside.next() {
            Some(next) if fold(next.as_os_str()) == fold(segment.as_os_str()) => {}
            _ => return false,
        }
    }
    true
}

fn fold(segment: &std::ffi::OsStr) -> String {
    segment.to_string_lossy().to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    struct Fixture {
        dir: tempfile::TempDir,
        db: Db,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
            Self { dir, db }
        }

        /// A segment at a time, so the path is spelt with the separator the
        /// platform uses: `removed_paths` is compared as a string, and the
        /// tombstones and drop paths a user produces are both OS-native.
        fn at(&self, relative: &str) -> PathBuf {
            relative
                .split('/')
                .fold(self.dir.path().to_path_buf(), |path, segment| {
                    path.join(segment)
                })
        }

        fn conn(&self) -> Connection {
            self.db.conn().unwrap()
        }

        fn write(&self, relative: &str) -> PathBuf {
            let path = self.at(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, relative).unwrap();
            path
        }

        fn folder(&self, relative: &str) -> PathBuf {
            let path = self.at(relative);
            std::fs::create_dir_all(&path).unwrap();
            path
        }

        /// Organizing on, with `Library` as the root and a watch folder.
        fn organizing(&self) -> PathBuf {
            let root = self.folder("Library");
            let conn = self.conn();
            scan::add_watch_folder(&conn, &root).unwrap();
            settings::set(&conn, settings::LIBRARY_ROOT, &root.to_string_lossy()).unwrap();
            settings::set(&conn, settings::ORGANIZE, "true").unwrap();
            root
        }

        fn tombstone(&self, path: &Path) {
            self.conn()
                .execute(
                    "INSERT INTO removed_paths (path, removed_at) VALUES (?1, 0)",
                    [path.to_string_lossy().as_ref()],
                )
                .unwrap();
        }

        fn tombstoned(&self, path: &Path) -> bool {
            self.conn()
                .query_row(
                    "SELECT count(*) FROM removed_paths WHERE path = ?1 COLLATE NOCASE",
                    [path.to_string_lossy().as_ref()],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap()
                > 0
        }
    }

    fn ingested(fixture: &Fixture, paths: &[PathBuf]) -> DropSummary {
        ingest(&fixture.conn(), &mover::OsRename, paths).unwrap()
    }

    #[test]
    fn watches_a_dropped_folder() {
        let fixture = Fixture::new();
        let folder = fixture.folder("Downloads/Loveless");

        let summary = ingested(&fixture, std::slice::from_ref(&folder));

        assert_eq!(summary.folders, 1);
        assert_eq!(scan::watch_folders(&fixture.conn()).unwrap(), vec![folder]);
    }

    #[test]
    fn skips_a_folder_a_root_already_covers() {
        let fixture = Fixture::new();
        let root = fixture.folder("Music");
        scan::add_watch_folder(&fixture.conn(), &root).unwrap();
        let inside = fixture.folder("Music/Loveless");

        let summary = ingested(&fixture, &[inside]);

        assert_eq!(summary.folders, 0);
        assert_eq!(scan::watch_folders(&fixture.conn()).unwrap(), vec![root]);
    }

    #[test]
    fn ignores_what_is_not_audio() {
        let fixture = Fixture::new();
        fixture.organizing();
        let cover = fixture.write("Downloads/cover.jpg");

        let summary = ingested(&fixture, std::slice::from_ref(&cover));

        assert_eq!((summary.ignored, summary.moved, summary.refused), (1, 0, 0));
        assert!(cover.exists());
    }

    #[test]
    fn refuses_a_loose_file_with_organizing_off() {
        let fixture = Fixture::new();
        let file = fixture.write("Downloads/Only Shallow.mp3");

        let summary = ingested(&fixture, std::slice::from_ref(&file));

        assert_eq!((summary.refused, summary.moved), (1, 0));
        assert!(file.exists(), "a refused drop moves nothing");
    }

    #[test]
    fn moves_a_loose_file_to_the_top_of_the_root() {
        let fixture = Fixture::new();
        let root = fixture.organizing();
        let file = fixture.write("Downloads/Only Shallow.mp3");

        let summary = ingested(&fixture, std::slice::from_ref(&file));

        assert_eq!(summary.moved, 1);
        assert!(!file.exists());
        assert!(root.join("Only Shallow.mp3").exists());
    }

    #[test]
    fn steps_around_a_name_the_root_already_holds() {
        let fixture = Fixture::new();
        let root = fixture.organizing();
        let taken = fixture.write("Library/Only Shallow.mp3");
        fixture.tombstone(&taken);
        let file = fixture.write("Downloads/Only Shallow.mp3");

        ingested(&fixture, &[file]);

        assert_eq!(
            std::fs::read_to_string(&taken).unwrap(),
            "Library/Only Shallow.mp3"
        );
        assert!(root.join("Only Shallow (2).mp3").exists());
    }

    #[test]
    fn adopts_a_file_a_root_already_covers_and_lifts_its_tombstone() {
        let fixture = Fixture::new();
        let root = fixture.folder("Music");
        scan::add_watch_folder(&fixture.conn(), &root).unwrap();
        let file = fixture.write("Music/Loveless/Only Shallow.mp3");
        fixture.tombstone(&file);

        let summary = ingested(&fixture, std::slice::from_ref(&file));

        assert_eq!((summary.adopted, summary.moved, summary.refused), (1, 0, 0));
        assert!(file.exists(), "a file already under a root does not move");
        assert!(!fixture.tombstoned(&file));
    }

    #[test]
    fn lifts_the_tombstone_the_file_lands_on() {
        let fixture = Fixture::new();
        let root = fixture.organizing();
        let target = root.join("Only Shallow.mp3");
        // Nothing behind it: the row `scan::plan` would skip the file over,
        // before marking it seen, on every scan forever.
        fixture.tombstone(&target);
        let file = fixture.write("Downloads/Only Shallow.mp3");

        ingested(&fixture, &[file]);

        assert!(target.exists());
        assert!(!fixture.tombstoned(&target));
    }

    #[test]
    fn adopts_a_file_inside_a_folder_of_the_same_drop() {
        let fixture = Fixture::new();
        let folder = fixture.folder("Downloads/Loveless");
        let file = fixture.write("Downloads/Loveless/Only Shallow.mp3");

        let summary = ingested(&fixture, &[file.clone(), folder]);

        assert_eq!(
            (summary.folders, summary.adopted, summary.refused),
            (1, 1, 0)
        );
        assert!(file.exists());
    }

    #[test]
    fn under_stops_at_a_segment_boundary() {
        assert!(under(Path::new("D:\\Music"), Path::new("D:\\Music\\a.mp3")));
        assert!(under(Path::new("D:\\Music"), Path::new("D:/Music/a.mp3")));
        assert!(under(Path::new("D:\\Music"), Path::new("D:\\music\\a.mp3")));
        assert!(!under(
            Path::new("D:\\Music"),
            Path::new("D:\\Musicology\\a.mp3")
        ));
        assert!(!under(Path::new("D:\\Music\\a"), Path::new("D:\\Music")));
    }
}
