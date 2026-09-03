//! Bringing the database in line with what is on disk.
//!
//! Scanning is polled rather than filesystem-watched, and incremental: a file
//! whose (mtime, size) is unchanged is never re-parsed, so a pass over a large
//! library costs a directory walk rather than tens of thousands of tag reads.
//! That is what makes the [`watch`] thread's unattended pass affordable on a
//! timer, and why an event stream was not worth a second code path - see the
//! module's own header.

pub mod watch;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use rusqlite::{Connection, OptionalExtension};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::model::{ScanProgress, ScanSummary};
use crate::tags::{self, TrackTags};

/// Extensions ingested today. The schema and `lofty` both handle more, so
/// widening this is the only change other formats need.
pub const AUDIO_EXTENSIONS: &[&str] = &["mp3"];

/// How many files are parsed between progress emissions. Emitting per file
/// would flood the IPC channel on a large library.
const PROGRESS_INTERVAL: usize = 200;

/// Held for the length of anything that rewrites rows from files on disk.
///
/// Managed alongside [`crate::db::Db`] and taken by `scan_library`,
/// `tagsource_apply` and the unattended pass. Nothing before it did this job:
/// the frontend's `busy` flag guards one button in one window, which was
/// survivable only while every such write started with a click.
///
/// Poison-tolerant on purpose. A panicking scan must not leave the library
/// unscannable for the rest of the session; the guard protects an ordering,
/// not a value that could be left half-written.
#[derive(Debug, Clone, Default)]
pub struct ScanLock(Arc<Mutex<()>>);

impl ScanLock {
    /// Waits for whoever holds it.
    ///
    /// What a user-asked scan does: a Rescan that silently did nothing would
    /// be worse than one that starts its walk a little late.
    pub fn acquire(&self) -> MutexGuard<'_, ()> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// `None` when something else holds it, for a caller with nobody waiting.
    pub fn try_acquire(&self) -> Option<MutexGuard<'_, ()>> {
        match self.0.try_lock() {
            Ok(guard) => Some(guard),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => Some(poisoned.into_inner()),
            Err(std::sync::TryLockError::WouldBlock) => None,
        }
    }
}

/// What the database already knows about a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Known {
    id: i64,
    mtime: i64,
    size: i64,
    /// Whether the last scan failed to find it.
    missing: bool,
}

/// Which files need work, decided before any tag is read.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ScanPlan {
    pub added: Vec<PathBuf>,
    pub updated: Vec<PathBuf>,
    /// Known files that are no longer on disk and are not already marked.
    ///
    /// Not deleted: see migration 3. Already-marked files are left out so the
    /// timestamp keeps saying when the file first went, not when it was last
    /// looked for.
    pub missing: Vec<i64>,
    /// Marked files that turned up again - an external drive plugged back in.
    pub returned: Vec<i64>,
    pub unchanged: u32,
}

pub fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            AUDIO_EXTENSIONS
                .iter()
                .any(|known| known.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

/// Walks `roots`, returning every audio file with its (mtime, size).
///
/// Unreadable entries are skipped rather than aborting the walk: a permission
/// error on one directory must not cost the user the rest of the scan.
pub fn walk(roots: &[PathBuf]) -> Vec<(PathBuf, i64, i64)> {
    let mut found = Vec::new();
    for root in roots {
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() || !is_audio_file(entry.path()) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            found.push((
                entry.path().to_path_buf(),
                mtime_secs(&meta),
                meta.len() as i64,
            ));
        }
    }
    found
}

fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Diffs what is on disk against what is stored, without touching any tags.
///
/// Split out from the scan so the decision logic is testable on its own.
///
/// `removed` is the tombstones of migration 7: paths the user took out of the
/// library by hand. Such a file is skipped outright rather than added, which is
/// what stops the next Rescan from undoing the removal. It cannot appear in
/// `known` either - the row went with it - so the missing loop below never sees
/// one.
///
/// `absent` is the roots that were not on disk when the walk started, and is
/// empty for every scan the user asked for. A track underneath one of them is
/// neither found nor lost by this pass: `walk` yields nothing for a root that
/// is not there, so without this an unplugged external drive would mark every
/// track on it missing - which is the answer a Rescan is asking for and the
/// last thing the unattended pass should do on its own.
pub fn plan(
    known: &HashMap<String, Known>,
    on_disk: &[(PathBuf, i64, i64)],
    removed: &HashSet<String>,
    absent: &[PathBuf],
) -> ScanPlan {
    let mut plan = ScanPlan::default();
    let mut seen = HashSet::with_capacity(on_disk.len());

    for (path, mtime, size) in on_disk {
        let key = path.to_string_lossy().to_string();
        if removed.contains(&key) {
            continue;
        }
        seen.insert(key.clone());

        match known.get(&key) {
            None => plan.added.push(path.clone()),
            Some(entry) if entry.mtime != *mtime || entry.size != *size => {
                plan.updated.push(path.clone());
            }
            Some(_) => plan.unchanged += 1,
        }

        // Independent of the branch above: a file that came back unchanged is
        // still a file that came back, and one that came back edited needs
        // both the re-read and the mark cleared.
        if let Some(entry) = known.get(&key) {
            if entry.missing {
                plan.returned.push(entry.id);
            }
        }
    }

    for (key, entry) in known {
        if !seen.contains(key) && !entry.missing && !is_under(key, absent) {
            plan.missing.push(entry.id);
        }
    }

    plan
}

/// Whether `path` lies inside any of `roots`.
///
/// Compared by component rather than as text: `C:\Music2` starts with the
/// string `C:\Music` and is a different folder.
fn is_under(path: &str, roots: &[PathBuf]) -> bool {
    let path = Path::new(path);
    roots.iter().any(|root| path.starts_with(root))
}

fn load_known(conn: &Connection) -> AppResult<HashMap<String, Known>> {
    let mut stmt = conn.prepare("SELECT id, path, mtime, size, missing_since FROM tracks")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            Known {
                id: row.get(0)?,
                mtime: row.get(2)?,
                size: row.get(3)?,
                missing: row.get::<_, Option<i64>>(4)?.is_some(),
            },
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
}

/// The paths a removal has tombstoned. See migration 7.
fn load_removed(conn: &Connection) -> AppResult<HashSet<String>> {
    let mut stmt = conn.prepare("SELECT path FROM removed_paths")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<HashSet<_>>>()?)
}

/// Marks `ids` as no longer on disk, or clears the mark when `at` is `None`.
///
/// One statement per id rather than an `IN` list: the list is unbounded - an
/// unplugged drive can be the whole library - and SQLite's parameter limit is
/// not.
fn set_missing(tx: &rusqlite::Transaction<'_>, ids: &[i64], at: Option<i64>) -> AppResult<()> {
    let mut stmt = tx.prepare("UPDATE tracks SET missing_since = ?2 WHERE id = ?1")?;
    for id in ids {
        stmt.execute(rusqlite::params![id, at])?;
    }
    Ok(())
}

/// Marks one track missing, for the player: a file that will not open is gone
/// whether or not a scan has noticed yet.
///
/// Leaves an existing mark alone so the timestamp keeps its original meaning.
pub fn mark_missing(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE tracks SET missing_since = ?2 WHERE id = ?1 AND missing_since IS NULL",
        rusqlite::params![id, now_secs()],
    )?;
    Ok(())
}

/// Clears one track's mark, for the player: a file that opens is there.
///
/// Resolves to whether anything changed, which is nearly always false - the
/// caller only needs to react on the rare occasion that a file has come back,
/// and reloading the view on every track change would be waste.
pub fn clear_missing(conn: &Connection, id: i64) -> AppResult<bool> {
    let changed = conn.execute(
        "UPDATE tracks SET missing_since = NULL WHERE id = ?1 AND missing_since IS NOT NULL",
        [id],
    )?;
    Ok(changed > 0)
}

/// Deletes every track currently marked missing, returning how many went.
///
/// Playlist entries follow through `ON DELETE CASCADE`, which is why this is a
/// deliberate action rather than something a scan does on the user's behalf.
///
/// No tombstones, unlike `remove_tracks`: a drive coming back should restore
/// what was on it, which is the whole point of migration 3. Only an explicit
/// per-row removal is a statement about wanting the song gone.
pub fn remove_missing(conn: &Connection) -> AppResult<u32> {
    let removed = conn.execute("DELETE FROM tracks WHERE missing_since IS NOT NULL", [])?;
    // Those rows were carrying tag values, and a value nothing carries any more
    // should stop being suggested.
    crate::db::tag_values::rebuild(conn)?;
    Ok(removed as u32)
}

/// Deletes the named tracks and tombstones their paths, returning how many went.
///
/// The file on disk is not touched. What makes this different from
/// `remove_missing` is the tombstone: the file is still under a watch folder,
/// so without a record of the removal the next Rescan would add it straight
/// back. See migration 7.
///
/// One statement per id rather than an `IN` list, for the reason `set_missing`
/// gives: Ctrl+A puts the whole library in this list, and SQLite's parameter
/// limit does not grow to meet it.
pub fn remove_tracks(conn: &mut Connection, ids: &[i64]) -> AppResult<u32> {
    if ids.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction()?;
    let mut removed = 0_u32;
    {
        // The path is read back rather than taken from the caller: the caller
        // knows a selection by id, and a tombstone on a path that was never in
        // the library would suppress a file nobody asked to remove.
        let mut path_of = tx.prepare("SELECT path FROM tracks WHERE id = ?1")?;
        let mut tombstone = tx.prepare(
            "INSERT INTO removed_paths (path, removed_at) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET removed_at = excluded.removed_at",
        )?;
        let mut delete = tx.prepare("DELETE FROM tracks WHERE id = ?1")?;
        let at = now_secs();

        for id in ids {
            let path: Option<String> = path_of.query_row([id], |row| row.get(0)).optional()?;
            let Some(path) = path else { continue };
            tombstone.execute(rusqlite::params![path, at])?;
            delete.execute([id])?;
            removed += 1;
        }
    }
    tx.commit()?;

    // Five whole-table aggregates per gesture, rather than per-value decrements
    // across five fields. The rebuild is the cheaper thing to be sure of, and
    // it is what `remove_missing` already does.
    crate::db::tag_values::rebuild(conn)?;
    Ok(removed)
}

/// Drops every tombstone, returning how many went.
///
/// The way back from a mis-click: the rows themselves are gone, so this cannot
/// restore them - it only lets the next Rescan find those files again.
pub fn forget_removed(conn: &Connection) -> AppResult<u32> {
    Ok(conn.execute("DELETE FROM removed_paths", [])? as u32)
}

pub fn watch_folders(conn: &Connection) -> AppResult<Vec<PathBuf>> {
    let mut stmt = conn.prepare("SELECT path FROM watch_folders ORDER BY path")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(PathBuf::from)
        .collect())
}

pub fn add_watch_folder(conn: &Connection, path: &Path) -> AppResult<()> {
    if !path.is_dir() {
        return Err(AppError::Internal(format!(
            "{} is not a directory",
            path.display()
        )));
    }
    conn.execute(
        "INSERT OR IGNORE INTO watch_folders (path) VALUES (?1)",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

/// Stops watching `path`, and does nothing else.
///
/// The tracks under it stay in the library until a pass does not find them and
/// marks them missing, which is the route that already exists - a second kind
/// of removal, deleting rows because a folder left the list, would take the
/// play counts and playlist places on them with it.
pub fn remove_watch_folder(conn: &Connection, path: &Path) -> AppResult<()> {
    conn.execute(
        "DELETE FROM watch_folders WHERE path = ?1",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

/// Reads tags for `paths` in parallel.
///
/// Files that fail to parse are dropped, not propagated: a corrupt file in a
/// 50k library should cost that one file, not the scan.
fn read_tags(paths: &[PathBuf]) -> Vec<(PathBuf, TrackTags)> {
    paths
        .par_iter()
        .filter_map(|path| tags::read(path).ok().map(|tags| (path.clone(), tags)))
        .collect()
}

/// What a scan did, as a log line's worth of fields.
///
/// Here rather than at either call site because both of them write it: the
/// scan the user asked for and the pass nobody did are the same work, and
/// their lines have to be comparable to be worth reading.
///
/// `unchanged` is left out. It counts the files that were looked at and left
/// alone, which is the one number that says nothing about what happened.
pub fn summary_fields(summary: &ScanSummary) -> crate::log::Fields {
    crate::log::Fields::new()
        .add("added", summary.added)
        .add("updated", summary.updated)
        .add("missing", summary.missing)
        .add("returned", summary.returned)
}

/// Runs a full incremental scan of every configured watch folder.
///
/// The entry point for a scan the user asked for, and what the answer to
/// "Rescan" has always been: an unreachable root is walked like any other,
/// yields nothing, and the tracks under it are marked missing - which is what
/// feeds Remove Missing. [`watch::pass`] is the same scan with the roots
/// filtered first, for the case where nobody asked.
///
/// `on_progress` is called periodically; it is a closure rather than a Tauri
/// handle so the whole scan can be exercised in tests without a running app.
pub fn scan(
    conn: &mut Connection,
    on_progress: impl FnMut(ScanProgress),
) -> AppResult<ScanSummary> {
    let roots = watch_folders(conn)?;
    scan_roots(conn, &roots, &[], on_progress)
}

/// The scan itself, over the roots it is given.
///
/// `absent` names roots deliberately left out of `roots`, so that the tracks
/// under them are not mistaken for files that have gone; see [`plan`].
pub fn scan_roots(
    conn: &mut Connection,
    roots: &[PathBuf],
    absent: &[PathBuf],
    mut on_progress: impl FnMut(ScanProgress),
) -> AppResult<ScanSummary> {
    let on_disk = walk(roots);
    let known = load_known(conn)?;
    let plan = plan(&known, &on_disk, &load_removed(conn)?, absent);

    let total = (plan.added.len() + plan.updated.len()) as u32;
    let mut summary = ScanSummary {
        unchanged: plan.unchanged,
        ..Default::default()
    };

    on_progress(ScanProgress {
        scanned: 0,
        total,
        added: 0,
        updated: 0,
        missing: 0,
        done: false,
    });

    if !plan.missing.is_empty() || !plan.returned.is_empty() {
        let tx = conn.transaction()?;
        set_missing(&tx, &plan.missing, Some(now_secs()))?;
        set_missing(&tx, &plan.returned, None)?;
        tx.commit()?;
        summary.missing = plan.missing.len() as u32;
        summary.returned = plan.returned.len() as u32;
    }

    let mut scanned = 0_u32;
    // Chunked so tag reading, which is CPU-bound and parallel, overlaps with
    // writing, which is serial - and so progress is reported as work happens
    // rather than all at the end.
    for chunk in plan.added.chunks(PROGRESS_INTERVAL) {
        let parsed = read_tags(chunk);
        let tx = conn.transaction()?;
        for (path, tags) in &parsed {
            insert_track(&tx, path, tags)?;
            summary.added += 1;
        }
        tx.commit()?;

        scanned += chunk.len() as u32;
        on_progress(ScanProgress {
            scanned,
            total,
            added: summary.added,
            updated: summary.updated,
            missing: summary.missing,
            done: false,
        });
    }

    for chunk in plan.updated.chunks(PROGRESS_INTERVAL) {
        let parsed = read_tags(chunk);
        let tx = conn.transaction()?;
        for (path, tags) in &parsed {
            update_track(&tx, path, tags)?;
            summary.updated += 1;
        }
        tx.commit()?;

        scanned += chunk.len() as u32;
        on_progress(ScanProgress {
            scanned,
            total,
            added: summary.added,
            updated: summary.updated,
            missing: summary.missing,
            done: false,
        });
    }

    // Once, at the end, rather than per chunk: it is a whole-table aggregate
    // either way, and running it 50 times during a first scan would pay for
    // the same answer 50 times.
    crate::db::tag_values::rebuild(conn)?;

    on_progress(ScanProgress {
        scanned,
        total,
        added: summary.added,
        updated: summary.updated,
        missing: summary.missing,
        done: true,
    });

    Ok(summary)
}

/// Stores cover art if it is not already present, returning its hash.
fn store_cover(conn: &Connection, tags: &TrackTags) -> AppResult<Option<String>> {
    let Some(cover) = &tags.cover else {
        return Ok(None);
    };
    Ok(Some(crate::db::covers::store(conn, cover)?))
}

fn file_stats(path: &Path) -> (i64, i64) {
    std::fs::metadata(path)
        .map(|m| (mtime_secs(&m), m.len() as i64))
        .unwrap_or((0, 0))
}

fn insert_track(conn: &Connection, path: &Path, tags: &TrackTags) -> AppResult<()> {
    let cover_hash = store_cover(conn, tags)?;
    let (mtime, size) = file_stats(path);

    conn.execute(
        "INSERT INTO tracks (path, mtime, size, duration_ms, title, artist, album, album_artist,
                             genre, year, track_no, disc_no, comment, bitrate, sample_rate,
                             release_mbid, release_group_mbid, release_type, cover_hash, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                 ?19, ?20)
         ON CONFLICT(path) DO UPDATE SET
             mtime = excluded.mtime, size = excluded.size,
             duration_ms = excluded.duration_ms, title = excluded.title,
             artist = excluded.artist, album = excluded.album,
             album_artist = excluded.album_artist, genre = excluded.genre,
             year = excluded.year, track_no = excluded.track_no,
             disc_no = excluded.disc_no, comment = excluded.comment,
             bitrate = excluded.bitrate, sample_rate = excluded.sample_rate,
             release_mbid = excluded.release_mbid,
             release_group_mbid = excluded.release_group_mbid,
             release_type = excluded.release_type,
             cover_hash = excluded.cover_hash",
        rusqlite::params![
            path.to_string_lossy(),
            mtime,
            size,
            tags.duration_ms,
            tags.title,
            tags.artist,
            tags.album,
            tags.album_artist,
            tags.genre,
            tags.year,
            tags.track_no,
            tags.disc_no,
            tags.comment,
            tags.bitrate,
            tags.sample_rate,
            tags.release_mbid,
            tags.release_group_mbid,
            tags.release_type,
            cover_hash,
            now_secs(),
        ],
    )?;
    Ok(())
}

/// Same columns as an insert, but `added_at` and play statistics are left
/// alone: re-tagging a file must not look like re-adding it.
fn update_track(conn: &Connection, path: &Path, tags: &TrackTags) -> AppResult<()> {
    let cover_hash = store_cover(conn, tags)?;
    let (mtime, size) = file_stats(path);

    conn.execute(
        "UPDATE tracks SET mtime = ?2, size = ?3, duration_ms = ?4, title = ?5, artist = ?6,
                           album = ?7, album_artist = ?8, genre = ?9, year = ?10, track_no = ?11,
                           disc_no = ?12, comment = ?13, bitrate = ?14, sample_rate = ?15,
                           release_mbid = ?16, release_group_mbid = ?17, release_type = ?18,
                           cover_hash = ?19
         WHERE path = ?1",
        rusqlite::params![
            path.to_string_lossy(),
            mtime,
            size,
            tags.duration_ms,
            tags.title,
            tags.artist,
            tags.album,
            tags.album_artist,
            tags.genre,
            tags.year,
            tags.track_no,
            tags.disc_no,
            tags.comment,
            tags.bitrate,
            tags.sample_rate,
            tags.release_mbid,
            tags.release_group_mbid,
            tags.release_type,
            cover_hash,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(entries: &[(&str, i64, i64)]) -> HashMap<String, Known> {
        marked(entries, &[])
    }

    /// The same, with the named paths already marked missing.
    fn marked(entries: &[(&str, i64, i64)], missing: &[&str]) -> HashMap<String, Known> {
        entries
            .iter()
            .enumerate()
            .map(|(i, (path, mtime, size))| {
                (
                    (*path).to_owned(),
                    Known {
                        id: i as i64 + 1,
                        mtime: *mtime,
                        size: *size,
                        missing: missing.contains(path),
                    },
                )
            })
            .collect()
    }

    fn on_disk(entries: &[(&str, i64, i64)]) -> Vec<(PathBuf, i64, i64)> {
        entries
            .iter()
            .map(|(p, m, s)| (PathBuf::from(p), *m, *s))
            .collect()
    }

    fn tombstones(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| (*p).to_owned()).collect()
    }

    /// `plan` as a scan the user asked for: no tombstones, every root walked.
    fn plan(known: &HashMap<String, Known>, on_disk: &[(PathBuf, i64, i64)]) -> ScanPlan {
        super::plan(known, on_disk, &HashSet::new(), &[])
    }

    #[test]
    fn recognises_audio_files_case_insensitively() {
        assert!(is_audio_file(Path::new("/m/a.mp3")));
        assert!(is_audio_file(Path::new("/m/a.MP3")));
        assert!(!is_audio_file(Path::new("/m/cover.jpg")));
        assert!(!is_audio_file(Path::new("/m/no-extension")));
    }

    #[test]
    fn unchanged_files_are_not_reparsed() {
        let plan = plan(
            &known(&[("/m/a.mp3", 10, 100)]),
            &on_disk(&[("/m/a.mp3", 10, 100)]),
        );

        assert_eq!(plan.unchanged, 1);
        assert!(plan.added.is_empty());
        assert!(plan.updated.is_empty());
        assert!(plan.missing.is_empty());
    }

    #[test]
    fn detects_new_modified_and_deleted_files() {
        let plan = plan(
            &known(&[
                ("/m/same.mp3", 10, 100),
                ("/m/edited.mp3", 10, 100),
                ("/m/gone.mp3", 10, 100),
            ]),
            &on_disk(&[
                ("/m/same.mp3", 10, 100),
                ("/m/edited.mp3", 11, 100),
                ("/m/new.mp3", 1, 1),
            ]),
        );

        assert_eq!(plan.added, [PathBuf::from("/m/new.mp3")]);
        assert_eq!(plan.updated, [PathBuf::from("/m/edited.mp3")]);
        assert_eq!(plan.missing.len(), 1, "the vanished file should be marked");
        assert_eq!(plan.unchanged, 1);
    }

    #[test]
    fn a_file_that_is_still_gone_is_not_marked_twice() {
        // Otherwise every rescan would move the timestamp forward and the
        // count would report the same absence as news, over and over.
        let plan = plan(
            &marked(&[("/m/gone.mp3", 10, 100)], &["/m/gone.mp3"]),
            &on_disk(&[]),
        );

        assert!(plan.missing.is_empty());
        assert!(plan.returned.is_empty());
    }

    #[test]
    fn a_marked_file_that_reappears_is_unmarked() {
        let plan = plan(
            &marked(&[("/m/back.mp3", 10, 100)], &["/m/back.mp3"]),
            &on_disk(&[("/m/back.mp3", 10, 100)]),
        );

        assert_eq!(plan.returned.len(), 1);
        assert_eq!(plan.unchanged, 1, "and it is not re-parsed for nothing");
        assert!(plan.added.is_empty(), "it is the same row, not a new one");
    }

    #[test]
    fn a_marked_file_that_reappears_edited_is_both_unmarked_and_re_read() {
        // The drive was unplugged, the file was retagged elsewhere, and it is
        // back. Both halves have to happen.
        let plan = plan(
            &marked(&[("/m/back.mp3", 10, 100)], &["/m/back.mp3"]),
            &on_disk(&[("/m/back.mp3", 20, 140)]),
        );

        assert_eq!(plan.returned.len(), 1);
        assert_eq!(plan.updated, [PathBuf::from("/m/back.mp3")]);
    }

    #[test]
    fn a_size_change_alone_counts_as_modified() {
        // Editors that preserve mtime while rewriting tags are common enough
        // that size has to be part of the comparison.
        let plan = plan(
            &known(&[("/m/a.mp3", 10, 100)]),
            &on_disk(&[("/m/a.mp3", 10, 250)]),
        );

        assert_eq!(plan.updated, [PathBuf::from("/m/a.mp3")]);
        assert_eq!(plan.unchanged, 0);
    }

    #[test]
    fn a_removed_file_is_not_added_back_by_a_rescan() {
        // The whole point of migration 7: the file is still under a watch
        // folder, so without the tombstone this would be an `added`.
        let plan = super::plan(
            &known(&[]),
            &on_disk(&[("/m/unwanted.mp3", 10, 100)]),
            &tombstones(&["/m/unwanted.mp3"]),
            &[],
        );

        assert!(plan.added.is_empty());
        assert_eq!(plan.unchanged, 0, "nor counted as a file that was there");
        assert!(plan.missing.is_empty());
    }

    #[test]
    fn a_tombstone_suppresses_only_its_own_path() {
        let plan = super::plan(
            &known(&[]),
            &on_disk(&[("/m/unwanted.mp3", 10, 100), ("/m/wanted.mp3", 10, 100)]),
            &tombstones(&["/m/unwanted.mp3"]),
            &[],
        );

        assert_eq!(plan.added, [PathBuf::from("/m/wanted.mp3")]);
    }

    #[test]
    fn a_root_that_is_not_there_loses_nothing_under_it() {
        // What the unattended pass passes. `walk` yields nothing for a root
        // that is gone, so the absence has to be told from a deletion here -
        // or an unplugged drive marks its whole library missing on a timer.
        let plan = super::plan(
            &known(&[("/drive/a.mp3", 10, 100), ("/m/b.mp3", 10, 100)]),
            &on_disk(&[("/m/b.mp3", 10, 100)]),
            &HashSet::new(),
            &[PathBuf::from("/drive")],
        );

        assert!(plan.missing.is_empty());
        assert_eq!(
            plan.unchanged, 1,
            "and the root that is there is still read"
        );
    }

    #[test]
    fn a_missing_root_shields_only_what_is_inside_it() {
        // By component, not by prefix: `/drive2` starts with the string
        // `/drive` and is a different folder.
        let plan = super::plan(
            &known(&[("/drive2/a.mp3", 10, 100)]),
            &on_disk(&[]),
            &HashSet::new(),
            &[PathBuf::from("/drive")],
        );

        assert_eq!(plan.missing.len(), 1);
    }

    #[test]
    fn walk_finds_audio_recursively_and_ignores_everything_else() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("artist/album");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("track.mp3"), b"x").unwrap();
        std::fs::write(nested.join("cover.jpg"), b"x").unwrap();
        std::fs::write(dir.path().join("top.mp3"), b"x").unwrap();

        let found = walk(&[dir.path().to_path_buf()]);

        assert_eq!(found.len(), 2, "expected both mp3s and no jpg: {found:?}");
        assert!(found.iter().all(|(p, _, _)| is_audio_file(p)));
    }

    #[test]
    fn walking_a_missing_root_yields_nothing_rather_than_failing() {
        assert!(walk(&[PathBuf::from("/definitely/not/here")]).is_empty());
    }

    /// Two tracks and a static playlist holding both, so a removal has
    /// something to cascade through.
    fn library() -> (tempfile::TempDir, crate::db::Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        for path in ["/m/keep.mp3", "/m/go.mp3"] {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, title, artist, added_at)
                 VALUES (?1, 1, 1, 'Song', 'Band', 0)",
                [path],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO playlists (name, kind, created_at) VALUES ('Evening', 'static', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position)
             SELECT 1, id, id FROM tracks",
            [],
        )
        .unwrap();
        (dir, db)
    }

    fn id_of(conn: &Connection, path: &str) -> i64 {
        conn.query_row("SELECT id FROM tracks WHERE path = ?1", [path], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn count(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn removing_a_track_deletes_the_row_and_tombstones_its_path() {
        let (_dir, db) = library();
        let mut conn = db.conn().unwrap();
        let id = id_of(&conn, "/m/go.mp3");

        assert_eq!(remove_tracks(&mut conn, &[id]).unwrap(), 1);

        assert_eq!(count(&conn, "SELECT count(*) FROM tracks"), 1);
        assert_eq!(
            load_removed(&conn).unwrap(),
            tombstones(&["/m/go.mp3"]),
            "the path, so a rescan does not add it straight back"
        );
        // What the confirmation promises, and the only reason it has to say so:
        // the playlist entry goes with the row, through ON DELETE CASCADE.
        assert_eq!(count(&conn, "SELECT count(*) FROM playlist_tracks"), 1);
    }

    #[test]
    fn an_id_that_names_no_row_is_skipped_rather_than_tombstoned() {
        // The selection can name rows a concurrent write has already taken -
        // and a tombstone on a path that was never in the library would
        // suppress a file nobody asked to remove.
        let (_dir, db) = library();
        let mut conn = db.conn().unwrap();

        assert_eq!(remove_tracks(&mut conn, &[9_999]).unwrap(), 0);

        assert!(load_removed(&conn).unwrap().is_empty());
        assert_eq!(count(&conn, "SELECT count(*) FROM tracks"), 2);
    }

    #[test]
    fn forgetting_the_tombstones_lets_a_scan_find_those_files_again() {
        let (_dir, db) = library();
        let mut conn = db.conn().unwrap();
        let id = id_of(&conn, "/m/go.mp3");
        remove_tracks(&mut conn, &[id]).unwrap();

        assert_eq!(forget_removed(&conn).unwrap(), 1);

        // The row is still gone - only the suppression is lifted, which is all
        // this can offer: the id it had is not coming back.
        assert!(load_removed(&conn).unwrap().is_empty());
        assert_eq!(count(&conn, "SELECT count(*) FROM tracks"), 1);
    }

    #[test]
    fn removing_missing_tracks_leaves_no_tombstones() {
        // A drive coming back should restore what was on it: that is migration
        // 4's whole purpose, and a tombstone would quietly undo it.
        let (_dir, db) = library();
        let conn = db.conn().unwrap();
        conn.execute(
            "UPDATE tracks SET missing_since = 1 WHERE path = '/m/go.mp3'",
            [],
        )
        .unwrap();

        assert_eq!(remove_missing(&conn).unwrap(), 1);

        assert!(load_removed(&conn).unwrap().is_empty());
    }
}
