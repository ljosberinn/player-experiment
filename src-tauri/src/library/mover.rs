//! Moving one release to where [`super::layout`] says it goes.
//!
//! Reachable from nothing yet:
//! [83c](../../../docs/issues/upcoming/83c-turning-the-library-folder-on.md) is
//! the worker that calls this, and the `log::Op` and the `library://changed`
//! per release are its wiring to do - which is why [`Outcome`] carries the
//! counts a log line wants rather than writing one.
//!
//! **`tracks.path` is the row's identity.** `insert_track` is
//! `ON CONFLICT(path)`, so a move the scanner discovers is a new row plus an
//! old row marked missing, which costs the play count, `added_at` and every
//! playlist the track was in. The `UPDATE tracks SET path` commits in the same
//! transaction as the rename, and nothing here routes through a rescan.
//!
//! **Failure does not need unwinding, because the target is derived.** A
//! release left with some files moved and some not computes the same targets on
//! the next attempt, and a file already at its target is a no-op. That is the
//! resume mechanism and the retry mechanism at once, and it is why there is no
//! state table here.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};

use crate::db::{lookup, query};
use crate::error::{AppError, AppResult};
use crate::library::layout;
use crate::scan::{self, ScanLock};

/// Windows' `ERROR_NOT_SAME_DEVICE`: the rename crossed a volume, so the move
/// has to be a copy.
const NOT_SAME_DEVICE: i32 = 17;

/// The artwork that travels with a release, matched case-insensitively.
///
/// Cover art and nothing else: `.nfo`, `.cue`, `.log` and `.m3u` describe the
/// folder they are in rather than the release, and a playlist that followed
/// the files would name paths that no longer exist.
const COVER_STEMS: [&str; 3] = ["cover", "folder", "front"];
const COVER_EXTENSIONS: [&str; 2] = ["jpg", "png"];

/// The one filesystem call that has to be injectable.
///
/// A cross-volume rename is the branch with the copy in it, and no test can
/// arrange a second volume on a runner - so the failure is injected instead,
/// the same seam `AudioSink` and `Transport` are.
pub trait Rename {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()>;
}

/// What ships.
pub struct OsRename;

impl Rename for OsRename {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::rename(from, to)
    }
}

/// What one release came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Done(Moved),
    /// Left where it is: the player holds a file of this release open.
    ///
    /// Not an error and not a failure - the caller decides what to do with it.
    /// [83c](../../../docs/issues/upcoming/83c-turning-the-library-folder-on.md)
    /// defers these to the end of its run rather than dropping them, so a user
    /// who leaves one album playing does not find it the only one left behind.
    Deferred,
}

/// What moving one release cost.
///
/// All zero for a release already at its targets, which is what makes a second
/// pass over a placed library free.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Moved {
    pub files: u32,
    pub covers: u32,
    /// Rows marked missing: there is no file to move, and the row's path is
    /// the last place it was seen.
    pub skipped: u32,
}

/// Moves every file of `release` under `root`, rows and all.
///
/// `open` is the tracks the player currently holds a `std::fs::File` on - the
/// playing one and the prepared next one. A same-volume rename survives that,
/// but the cross-volume path deletes the source under a live decoder, and the
/// difference is not something this can see before it tries.
///
/// The lock is taken per release rather than for a whole backfill, the way
/// [82b](../../../docs/issues/done/82b-the-unattended-lookup-pass.md) takes it:
/// this rewrites the paths a scan reads, and holding it for four hours would
/// block every scan in that window.
pub fn move_release(
    conn: &mut Connection,
    lock: &ScanLock,
    fs: &dyn Rename,
    root: &Path,
    release: &lookup::Release,
    open: &HashSet<i64>,
) -> AppResult<Outcome> {
    let files = query::release_files(conn, release.album.as_deref(), release.artist.as_deref())?;
    if files.is_empty() {
        return Ok(Outcome::Done(Moved::default()));
    }
    if files.iter().any(|file| open.contains(&file.id)) {
        return Ok(Outcome::Deferred);
    }

    let _guard = lock.acquire();

    let shape = shape(release, &files);
    let mut moves = Vec::new();
    let mut taken = HashSet::new();
    let mut skipped = 0;
    for file in &files {
        if file.missing {
            skipped += 1;
            continue;
        }
        let source = PathBuf::from(&file.path);
        let ideal = root.join(layout::relative_path(root, &shape, &track(file)));
        let target = free_target(conn, file.id, &ideal, &taken)?;
        taken.insert(key(&target));
        if target != source {
            moves.push((file, source, target));
        }
    }

    // Read before anything is renamed: this asks which audio files a source
    // folder holds, and after the moves it holds none of them.
    let covers = travelling_covers(&files, &moves);

    let tx = conn.transaction()?;
    {
        let mut set_path = tx.prepare(
            // `mtime` and `size` in the same statement, the discipline
            // `tags::write::sync_row` keeps: `scan::plan` diffs on exactly that
            // pair, and a cross-volume move gives the target a fresh `mtime`.
            "UPDATE tracks SET path = ?2, mtime = ?3, size = ?4 WHERE id = ?1",
        )?;
        // A file landing on a path the user once removed a different file from
        // would be skipped by `scan::plan` before it is marked seen - which
        // means marked missing on every scan, forever. Nothing writes a
        // tombstone for the source: only an explicit removal tombstones, and
        // this only ever moves rows that exist.
        let mut lift = tx.prepare("DELETE FROM removed_paths WHERE path = ?1")?;

        for (file, source, target) in &moves {
            place_file(fs, source, target)?;
            let meta =
                std::fs::metadata(target).map_err(|error| AppError::io(target.display(), error))?;
            set_path.execute(rusqlite::params![
                file.id,
                key(target),
                scan::mtime_secs(&meta),
                meta.len() as i64,
            ])?;
            lift.execute([key(target)])?;
        }

        for (source, target) in &covers {
            place_file(fs, source, target)?;
        }
    }
    tx.commit()?;

    // After the commit: a folder that could not be removed is a folder that is
    // still there, which costs nothing and is not worth rolling a move back
    // over. `remove_dir` rather than `remove_dir_all`, so the folder that kept
    // its `.nfo` keeps existing too.
    let stop = stop_folders(conn, root)?;
    for (_, source, _) in &moves {
        if let Some(parent) = source.parent() {
            prune_empty(parent, &stop);
        }
    }

    Ok(Outcome::Done(Moved {
        files: moves.len() as u32,
        covers: covers.len() as u32,
        skipped,
    }))
}

/// Moves one file to `target`, creating the folders above it.
///
/// The seam [85b](../../../docs/issues/upcoming/85b-drop-files-and-folders.md)
/// needs: the move without the row update, for a dropped file that has no row
/// yet.
///
/// A source that is gone with the target already there is an interrupted
/// attempt finishing, not a failure - see the module header.
pub fn place_file(fs: &dyn Rename, source: &Path, target: &Path) -> AppResult<()> {
    if source == target || (!source.exists() && target.exists()) {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|error| AppError::io(parent.display(), error))?;
    }
    match fs.rename(source, target) {
        Ok(()) => Ok(()),
        Err(error) if error.raw_os_error() == Some(NOT_SAME_DEVICE) => copy_across(source, target),
        Err(error) => Err(AppError::io(source.display(), error)),
    }
}

/// The cross-volume fallback: copy, verify the size, delete the source.
///
/// Size and not a hash - hashing a 400 GB library to confirm what the
/// filesystem already confirmed costs hours and answers nothing.
fn copy_across(source: &Path, target: &Path) -> AppResult<()> {
    let expected = std::fs::metadata(source)
        .map_err(|error| AppError::io(source.display(), error))?
        .len();
    std::fs::copy(source, target).map_err(|error| AppError::io(target.display(), error))?;
    let copied = std::fs::metadata(target)
        .map_err(|error| AppError::io(target.display(), error))?
        .len();
    if copied != expected {
        // The source is left alone. A short copy is the one case where
        // deleting it would lose the file rather than move it.
        return Err(AppError::Internal(format!(
            "{}: copied {copied} bytes of {expected}",
            target.display()
        )));
    }
    std::fs::remove_file(source).map_err(|error| AppError::io(source.display(), error))
}

/// The facts every file of the release shares.
///
/// `release.artist` goes in the `album_artist` slot because it is already
/// `GROUP_ARTIST`'s value - the grid's expression, resolved - and the layout
/// resolves that slot first.
fn shape<'a>(release: &'a lookup::Release, files: &'a [query::ReleaseFile]) -> layout::Release<'a> {
    layout::Release {
        album_artist: release.artist.as_deref(),
        artist: None,
        album: release.album.as_deref(),
        // The first row that has one, in tracklist order. Rows of one release
        // can disagree, and a release that is one folder has to be one answer.
        year: files.iter().find_map(|file| file.year),
        release_type: files.iter().find_map(|file| file.release_type.as_deref()),
        disc_count: files
            .iter()
            .map(|file| file.disc_no.unwrap_or(1))
            .collect::<HashSet<_>>()
            .len() as u32,
    }
}

fn track(file: &query::ReleaseFile) -> layout::TrackFile<'_> {
    layout::TrackFile {
        disc_no: file.disc_no,
        track_no: file.track_no,
        title: file.title.as_deref(),
        artist: file.artist.as_deref(),
        extension: Path::new(&file.path)
            .extension()
            .and_then(|extension| extension.to_str()),
    }
}

/// `ideal`, or the first ` (n)` beside it that no row and no earlier file of
/// this release has claimed.
///
/// A target that already exists is two different situations, and `tracks`
/// separates them: a row owning the path is a real collision - two releases
/// that sanitize to one name - where a path no row owns is the partial file an
/// interrupted copy left behind, and `rename` overwrites that for free.
fn free_target(
    conn: &Connection,
    id: i64,
    ideal: &Path,
    taken: &HashSet<String>,
) -> AppResult<PathBuf> {
    let mut candidate = ideal.to_path_buf();
    let mut nth = 2;
    while taken.contains(&key(&candidate)) || owned_by_other(conn, id, &candidate)? {
        candidate = layout::suffixed(ideal, nth);
        nth += 1;
    }
    Ok(candidate)
}

fn owned_by_other(conn: &Connection, id: i64, path: &Path) -> AppResult<bool> {
    let owned: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM tracks WHERE path = ?1 AND id <> ?2",
            rusqlite::params![key(path), id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(owned.is_some())
}

/// The artwork moving with the release, as (source, target) pairs.
///
/// **Only from a folder that held nothing else.** A source folder containing
/// two releases would otherwise have its artwork taken away from whichever
/// release moved second.
fn travelling_covers(
    files: &[query::ReleaseFile],
    moves: &[(&query::ReleaseFile, PathBuf, PathBuf)],
) -> Vec<(PathBuf, PathBuf)> {
    let members: HashSet<String> = files.iter().map(|file| file.path.clone()).collect();
    let mut covers = Vec::new();
    let mut folders = HashSet::new();

    for (_, source, target) in moves {
        let (Some(from), Some(to)) = (source.parent(), target.parent()) else {
            continue;
        };
        if from == to || !folders.insert(from.to_path_buf()) {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(from) else {
            continue;
        };

        let mut found = Vec::new();
        let mut shared = false;
        for entry in entries.flatten() {
            let path = entry.path();
            if scan::is_audio_file(&path) {
                shared |= !members.contains(&key(&path));
            } else if is_cover(&path) {
                found.push(path);
            }
        }
        if !shared {
            covers.extend(found.into_iter().map(|cover| {
                let name = cover.file_name().unwrap_or_default().to_owned();
                (cover, to.join(name))
            }));
        }
    }
    covers
}

fn is_cover(path: &Path) -> bool {
    let matches = |part: Option<&std::ffi::OsStr>, against: &[&str]| {
        part.and_then(|part| part.to_str()).is_some_and(|part| {
            against
                .iter()
                .any(|candidate| candidate.eq_ignore_ascii_case(part))
        })
    };
    matches(path.file_stem(), &COVER_STEMS) && matches(path.extension(), &COVER_EXTENSIONS)
}

/// The folders a prune stops at: the library root and every watch folder.
///
/// A watch-folder root is never removed - it is a folder the user named, and an
/// empty one is still watched. Nothing above one is touched either, which is
/// what keeps a move out of a folder that was never part of the library from
/// walking up into the user's Downloads.
fn stop_folders(conn: &Connection, root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut stop = scan::watch_folders(conn)?;
    stop.push(root.to_path_buf());
    Ok(stop)
}

/// Removes `dir` and every empty folder above it, up to but never including a
/// folder in `stop`.
fn prune_empty(dir: &Path, stop: &[PathBuf]) {
    let mut dir = dir.to_path_buf();
    while !stop.iter().any(|root| root == dir.as_path())
        && stop.iter().any(|root| dir.starts_with(root))
        && std::fs::remove_dir(&dir).is_ok()
    {
        let Some(parent) = dir.parent() else { break };
        dir = parent.to_path_buf();
    }
}

/// A path as `tracks.path` and `scan::plan` spell it.
fn key(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use std::cell::Cell;

    const ALBUM: &str = "Loveless";
    const ARTIST: &str = "My Bloody Valentine";

    /// Where the two tracks of the fixture release belong, under `Library`.
    const FIRST: &str =
        "Library\\My Bloody Valentine\\Loveless - 1991 - Album\\01 - Only Shallow.mp3";
    const SECOND: &str = "Library\\My Bloody Valentine\\Loveless - 1991 - Album\\02 - Loomer.mp3";

    /// What a row says about a track, with the fixture release as the default.
    struct Row<'a> {
        album: &'a str,
        artist: &'a str,
        track_artist: Option<&'a str>,
        title: &'a str,
        track_no: Option<i64>,
        disc_no: Option<i64>,
        year: Option<i64>,
        release_type: Option<&'a str>,
        missing: bool,
    }

    impl Default for Row<'_> {
        fn default() -> Self {
            Self {
                album: ALBUM,
                artist: ARTIST,
                track_artist: None,
                title: "Only Shallow",
                track_no: Some(1),
                disc_no: None,
                year: Some(1991),
                release_type: None,
                missing: false,
            }
        }
    }

    /// A library on disk with its database beside it.
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

        fn at(&self, relative: &str) -> PathBuf {
            self.dir.path().join(relative)
        }

        fn root(&self) -> PathBuf {
            self.at("Library")
        }

        fn conn(&self) -> Connection {
            self.db.conn().unwrap()
        }

        /// A file at `relative` and the row that owns it.
        ///
        /// The contents are the path it was written to, so a file is still
        /// identifiable after something has renamed it.
        fn track(&self, relative: &str, row: Row<'_>) -> i64 {
            let path = self.write(relative, relative);
            let meta = std::fs::metadata(&path).unwrap();
            let conn = self.conn();
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, album, album_artist, artist, title,
                                     track_no, disc_no, year, release_type, missing_since, added_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0)",
                rusqlite::params![
                    key(&path),
                    scan::mtime_secs(&meta),
                    meta.len() as i64,
                    row.album,
                    row.artist,
                    row.track_artist.unwrap_or(row.artist),
                    row.title,
                    row.track_no,
                    row.disc_no,
                    row.year,
                    row.release_type,
                    row.missing.then_some(1_i64),
                ],
            )
            .unwrap();
            conn.last_insert_rowid()
        }

        fn write(&self, relative: &str, contents: &str) -> PathBuf {
            let path = self.at(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, contents).unwrap();
            path
        }

        fn watch(&self, relative: &str) -> PathBuf {
            let path = self.at(relative);
            std::fs::create_dir_all(&path).unwrap();
            scan::add_watch_folder(&self.conn(), &path).unwrap();
            path
        }

        fn release(&self) -> lookup::Release {
            lookup::Release {
                album: Some(ALBUM.to_owned()),
                artist: Some(ARTIST.to_owned()),
            }
        }

        fn move_it(&self, fs: &dyn Rename) -> AppResult<Outcome> {
            self.move_with(fs, &HashSet::new())
        }

        fn move_with(&self, fs: &dyn Rename, open: &HashSet<i64>) -> AppResult<Outcome> {
            let mut conn = self.conn();
            move_release(
                &mut conn,
                &ScanLock::default(),
                fs,
                &self.root(),
                &self.release(),
                open,
            )
        }

        /// Every row's path, in id order, relative to the fixture.
        fn paths(&self) -> Vec<String> {
            let conn = self.conn();
            let mut stmt = conn.prepare("SELECT path FROM tracks ORDER BY id").unwrap();
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            let prefix = format!("{}\\", self.dir.path().to_string_lossy());
            rows.into_iter()
                .map(|path| path.strip_prefix(&prefix).unwrap_or(&path).to_owned())
                .collect()
        }
    }

    /// Renames as the OS does until `after` of them have gone through, then
    /// fails the way a drive that went away does.
    struct FailAfter {
        after: usize,
        done: Cell<usize>,
    }

    impl FailAfter {
        fn new(after: usize) -> Self {
            Self {
                after,
                done: Cell::new(0),
            }
        }
    }

    impl Rename for FailAfter {
        fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
            if self.done.get() >= self.after {
                return Err(std::io::Error::other("the drive went away"));
            }
            self.done.set(self.done.get() + 1);
            std::fs::rename(from, to)
        }
    }

    /// The second volume no runner has.
    struct OtherVolume;

    impl Rename for OtherVolume {
        fn rename(&self, _: &Path, _: &Path) -> std::io::Result<()> {
            Err(std::io::Error::from_raw_os_error(NOT_SAME_DEVICE))
        }
    }

    fn moved(files: u32, covers: u32, skipped: u32) -> Outcome {
        Outcome::Done(Moved {
            files,
            covers,
            skipped,
        })
    }

    /// Two tracks of one release, in a folder of their own.
    fn loveless(fixture: &Fixture) -> (i64, i64) {
        let first = fixture.track("Incoming\\mbv\\a.mp3", Row::default());
        let second = fixture.track(
            "Incoming\\mbv\\b.mp3",
            Row {
                title: "Loomer",
                track_no: Some(2),
                ..Row::default()
            },
        );
        (first, second)
    }

    #[test]
    fn a_moved_release_keeps_its_track_ids_play_counts_and_playlist_places() {
        let fixture = Fixture::new();
        let (first, second) = loveless(&fixture);
        let conn = fixture.conn();
        conn.execute("UPDATE tracks SET play_count = 7 WHERE id = ?1", [first])
            .unwrap();
        conn.execute(
            "INSERT INTO playlists (name, kind, created_at) VALUES ('Mix', 'static', 0)",
            [],
        )
        .unwrap();
        let playlist = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, 3)",
            rusqlite::params![playlist, second],
        )
        .unwrap();

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(2, 0, 0));
        assert_eq!(fixture.paths(), [FIRST, SECOND]);
        assert_eq!(
            std::fs::read_to_string(fixture.at(FIRST)).unwrap(),
            "Incoming\\mbv\\a.mp3"
        );
        let (count, position): (i64, i64) = conn
            .query_row(
                "SELECT (SELECT play_count FROM tracks WHERE id = ?1),
                        (SELECT position FROM playlist_tracks WHERE track_id = ?2)",
                rusqlite::params![first, second],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((count, position), (7, 3));
    }

    #[test]
    fn the_row_carries_the_size_and_mtime_the_target_has() {
        let fixture = Fixture::new();
        loveless(&fixture);
        fixture.move_it(&OsRename).unwrap();

        let meta = std::fs::metadata(fixture.at(FIRST)).unwrap();
        let (mtime, size): (i64, i64) = fixture
            .conn()
            .query_row(
                "SELECT mtime, size FROM tracks ORDER BY id LIMIT 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((mtime, size), (scan::mtime_secs(&meta), meta.len() as i64));
    }

    #[test]
    fn a_release_already_at_its_targets_moves_nothing() {
        let fixture = Fixture::new();
        loveless(&fixture);
        fixture.move_it(&OsRename).unwrap();

        let again = fixture.move_it(&OsRename).unwrap();

        assert_eq!(again, moved(0, 0, 0));
        assert_eq!(fixture.paths(), [FIRST, SECOND]);
    }

    #[test]
    fn a_rename_that_fails_partway_rolls_the_rows_back() {
        let fixture = Fixture::new();
        loveless(&fixture);

        let error = fixture.move_it(&FailAfter::new(1)).unwrap_err();

        assert!(error.to_string().contains("the drive went away"), "{error}");
        assert_eq!(
            fixture.paths(),
            ["Incoming\\mbv\\a.mp3", "Incoming\\mbv\\b.mp3"]
        );
        // The file the first rename did move stays where it landed. Unwinding
        // it would be work: the target is derived, so the next attempt finds
        // it there and moves the rest.
        assert!(fixture.at(FIRST).exists());
    }

    #[test]
    fn a_release_left_half_moved_finishes_on_the_next_attempt() {
        let fixture = Fixture::new();
        loveless(&fixture);
        fixture.move_it(&FailAfter::new(1)).unwrap_err();

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(2, 0, 0));
        assert_eq!(fixture.paths(), [FIRST, SECOND]);
    }

    #[test]
    fn a_collision_with_a_row_owned_target_is_suffixed() {
        let fixture = Fixture::new();
        // A different release - Windows strips the trailing dot, so it is a
        // different album that sanitizes to the same folder and the same name.
        fixture.track(
            FIRST,
            Row {
                album: "Loveless.",
                ..Row::default()
            },
        );
        fixture.track("Incoming\\mbv\\a.mp3", Row::default());

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(1, 0, 0));
        assert_eq!(
            fixture.paths(),
            [
                FIRST,
                "Library\\My Bloody Valentine\\Loveless - 1991 - Album\\01 - Only Shallow (2).mp3"
            ]
        );
    }

    #[test]
    fn an_orphan_at_the_target_is_overwritten() {
        let fixture = Fixture::new();
        fixture.write(FIRST, "half a copy");
        fixture.track("Incoming\\mbv\\a.mp3", Row::default());

        fixture.move_it(&OsRename).unwrap();

        assert_eq!(fixture.paths(), [FIRST]);
        assert_eq!(
            std::fs::read_to_string(fixture.at(FIRST)).unwrap(),
            "Incoming\\mbv\\a.mp3"
        );
    }

    #[test]
    fn a_cross_volume_rename_falls_back_to_copy_and_delete() {
        let fixture = Fixture::new();
        loveless(&fixture);

        let outcome = fixture.move_it(&OtherVolume).unwrap();

        assert_eq!(outcome, moved(2, 0, 0));
        assert_eq!(fixture.paths(), [FIRST, SECOND]);
        assert!(!fixture.at("Incoming\\mbv\\a.mp3").exists());
        assert_eq!(
            std::fs::read_to_string(fixture.at(FIRST)).unwrap(),
            "Incoming\\mbv\\a.mp3"
        );
    }

    #[test]
    fn a_copy_that_fails_leaves_the_source_alone() {
        let fixture = Fixture::new();
        let source = fixture.write("Downloads\\track.mp3", "dropped");
        let target = fixture.at("Library\\track.mp3");
        // A directory at the target is the one way to fail the copy from here
        // without a second volume to fail it on.
        std::fs::create_dir_all(&target).unwrap();

        let error = place_file(&OtherVolume, &source, &target).unwrap_err();

        assert!(source.exists(), "{error}");
    }

    #[test]
    fn cover_art_travels_and_nothing_else_does() {
        let fixture = Fixture::new();
        loveless(&fixture);
        fixture.write("Incoming\\mbv\\Folder.JPG", "artwork");
        fixture.write("Incoming\\mbv\\album.nfo", "notes");

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(2, 1, 0));
        assert!(fixture
            .at("Library\\My Bloody Valentine\\Loveless - 1991 - Album\\Folder.JPG")
            .exists());
        assert!(fixture.at("Incoming\\mbv\\album.nfo").exists());
    }

    #[test]
    fn a_shared_source_folder_keeps_its_cover() {
        let fixture = Fixture::new();
        loveless(&fixture);
        fixture.track(
            "Incoming\\mbv\\c.mp3",
            Row {
                album: "Isn't Anything",
                title: "Soft as Snow",
                ..Row::default()
            },
        );
        fixture.write("Incoming\\mbv\\cover.jpg", "artwork");

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(2, 0, 0));
        assert!(fixture.at("Incoming\\mbv\\cover.jpg").exists());
    }

    #[test]
    fn an_emptied_folder_is_removed_and_a_watch_root_is_not() {
        let fixture = Fixture::new();
        let watched = fixture.watch("Incoming");
        loveless(&fixture);

        fixture.move_it(&OsRename).unwrap();

        assert!(!fixture.at("Incoming\\mbv").exists());
        assert!(watched.exists());
    }

    #[test]
    fn a_folder_that_kept_a_file_keeps_existing() {
        let fixture = Fixture::new();
        fixture.watch("Incoming");
        loveless(&fixture);
        fixture.write("Incoming\\mbv\\album.nfo", "notes");

        fixture.move_it(&OsRename).unwrap();

        assert!(fixture.at("Incoming\\mbv").exists());
    }

    #[test]
    fn a_tombstone_on_the_target_is_lifted_so_a_later_scan_keeps_the_row() {
        let fixture = Fixture::new();
        fixture.watch("Incoming");
        fixture.watch("Library");
        loveless(&fixture);
        // A different file was once removed from the path this release is
        // about to land on.
        fixture
            .conn()
            .execute(
                "INSERT INTO removed_paths (path, removed_at) VALUES (?1, 0)",
                [key(&fixture.at(FIRST))],
            )
            .unwrap();

        fixture.move_it(&OsRename).unwrap();
        let mut conn = fixture.conn();
        scan::scan(&mut conn, |_| {}).unwrap();

        let missing: i64 = conn
            .query_row(
                "SELECT count(*) FROM tracks WHERE missing_since IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(missing, 0);
        assert_eq!(fixture.paths(), [FIRST, SECOND]);
    }

    #[test]
    fn a_track_already_marked_missing_is_skipped() {
        let fixture = Fixture::new();
        fixture.track("Incoming\\mbv\\a.mp3", Row::default());
        let gone = fixture.track(
            "Incoming\\mbv\\b.mp3",
            Row {
                title: "Loomer",
                track_no: Some(2),
                missing: true,
                ..Row::default()
            },
        );
        std::fs::remove_file(fixture.at("Incoming\\mbv\\b.mp3")).unwrap();

        let outcome = fixture.move_it(&OsRename).unwrap();

        assert_eq!(outcome, moved(1, 0, 1));
        let path: String = fixture
            .conn()
            .query_row("SELECT path FROM tracks WHERE id = ?1", [gone], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(path, key(&fixture.at("Incoming\\mbv\\b.mp3")));
    }

    #[test]
    fn a_release_the_player_has_open_is_deferred() {
        let fixture = Fixture::new();
        let (first, _) = loveless(&fixture);

        let outcome = fixture
            .move_with(&OsRename, &HashSet::from([first]))
            .unwrap();

        assert_eq!(outcome, Outcome::Deferred);
        assert_eq!(
            fixture.paths(),
            ["Incoming\\mbv\\a.mp3", "Incoming\\mbv\\b.mp3"]
        );
    }

    #[test]
    fn a_release_with_no_rows_is_nothing_to_do() {
        let fixture = Fixture::new();

        assert_eq!(fixture.move_it(&OsRename).unwrap(), moved(0, 0, 0));
    }

    #[test]
    fn a_multi_disc_release_prefixes_every_filename() {
        let fixture = Fixture::new();
        fixture.track(
            "Incoming\\mbv\\a.mp3",
            Row {
                disc_no: Some(1),
                ..Row::default()
            },
        );
        fixture.track(
            "Incoming\\mbv\\b.mp3",
            Row {
                title: "Loomer",
                track_no: Some(2),
                disc_no: Some(2),
                ..Row::default()
            },
        );

        fixture.move_it(&OsRename).unwrap();

        assert_eq!(
            fixture.paths(),
            [
                "Library\\My Bloody Valentine\\Loveless - 1991 - Album\\1-01 - Only Shallow.mp3",
                "Library\\My Bloody Valentine\\Loveless - 1991 - Album\\2-02 - Loomer.mp3"
            ]
        );
    }

    #[test]
    fn a_dropped_file_is_placed_without_a_row() {
        let fixture = Fixture::new();
        let source = fixture.write("Downloads\\track.mp3", "dropped");
        let target = fixture.at(FIRST);

        place_file(&OsRename, &source, &target).unwrap();

        assert!(!source.exists());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "dropped");
        let rows: i64 = fixture
            .conn()
            .query_row("SELECT count(*) FROM tracks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }
}
