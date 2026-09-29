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

use crate::db::plays::track_key;
use crate::error::{AppError, AppResult};
use crate::library::layout;
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
///
/// Keyed by [`layout::fold`] wherever it is collected, so `path` is the
/// spelling the row carries rather than the one the walk read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Known {
    id: i64,
    path: String,
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

pub(crate) fn mtime_secs(meta: &std::fs::Metadata) -> i64 {
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
    known: &HashMap<Vec<u8>, Known>,
    on_disk: &[(PathBuf, i64, i64)],
    removed: &HashSet<Vec<u8>>,
    absent: &[PathBuf],
) -> ScanPlan {
    let mut plan = ScanPlan::default();
    let mut seen = HashSet::with_capacity(on_disk.len());

    for (path, mtime, size) in on_disk {
        let key = layout::fold(path);
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
        if !seen.contains(key) && !entry.missing && !is_under(&entry.path, absent) {
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

fn load_known(conn: &Connection) -> AppResult<HashMap<Vec<u8>, Known>> {
    let mut stmt = conn.prepare("SELECT id, path, mtime, size, missing_since FROM tracks")?;
    let rows = stmt.query_map([], |row| {
        let path: String = row.get(1)?;
        Ok((
            layout::fold(Path::new(&path)),
            Known {
                id: row.get(0)?,
                path,
                mtime: row.get(2)?,
                size: row.get(3)?,
                missing: row.get::<_, Option<i64>>(4)?.is_some(),
            },
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
}

/// The paths a removal has tombstoned. See migration 7.
fn load_removed(conn: &Connection) -> AppResult<HashSet<Vec<u8>>> {
    let mut stmt = conn.prepare("SELECT path FROM removed_paths")?;
    let rows = stmt.query_map([], |row| {
        let path: String = row.get(0)?;
        Ok(layout::fold(Path::new(&path)))
    })?;
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
/// Playlist entries of a song with no other copy follow through `ON DELETE
/// CASCADE`, which is why this is a deliberate action rather than something a
/// scan does on the user's behalf.
///
/// No tombstones, unlike `remove_tracks`: a drive coming back should restore
/// what was on it, which is the whole point of migration 3. Only an explicit
/// per-row removal is a statement about wanting the song gone.
pub fn remove_missing(conn: &mut Connection) -> AppResult<u32> {
    let tx = conn.transaction()?;
    let ids = tx
        .prepare("SELECT id FROM tracks WHERE missing_since IS NOT NULL")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    let removed = delete_handing_on(&tx, &ids)?;
    // Those rows were carrying tag values, and a value nothing carries any more
    // should stop being suggested.
    crate::db::tag_values::rebuild(&tx)?;
    tx.commit()?;
    Ok(removed)
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
    let mut present = Vec::with_capacity(ids.len());
    {
        // The path is read back rather than taken from the caller: the caller
        // knows a selection by id, and a tombstone on a path that was never in
        // the library would suppress a file nobody asked to remove.
        let mut path_of = tx.prepare("SELECT path FROM tracks WHERE id = ?1")?;
        let mut tombstone = tx.prepare(
            "INSERT INTO removed_paths (path, removed_at) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET removed_at = excluded.removed_at",
        )?;
        let at = now_secs();

        for id in ids {
            let path: Option<String> = path_of.query_row([id], |row| row.get(0)).optional()?;
            let Some(path) = path else { continue };
            tombstone.execute(rusqlite::params![path, at])?;
            present.push(*id);
        }
    }
    let removed = delete_handing_on(&tx, &present)?;

    // Five whole-table aggregates per gesture, rather than per-value decrements
    // across five fields. The rebuild is the cheaper thing to be sure of, and
    // it is what `remove_missing` already does.
    crate::db::tag_values::rebuild(&tx)?;
    tx.commit()?;
    Ok(removed)
}

/// Deletes the rows `ids` names, first handing each one's play count, last
/// played and playlist places to the copy of its song that stays (issue 169).
///
/// The copy is the one `plays::resolve` links the song's plays to - present
/// before missing, then the lowest id - over `tracks.match_key` alone. A song
/// whose every copy goes hands nothing on, and its plays stay in the log
/// unlinked.
///
/// **`max`, never add**, for `lastfm::import::count`'s reason: after an import
/// the copy that stays already counts the other copy's plays. The plays the log
/// links to it once this removal is resolved are the third term, since they
/// include local plays of the other copy.
///
/// One insert per id into a temporary table, for the parameter limit
/// `remove_tracks` gives.
fn delete_handing_on(conn: &Connection, ids: &[i64]) -> AppResult<u32> {
    conn.execute_batch(
        "DROP TABLE IF EXISTS temp.removing;
         CREATE TEMP TABLE removing (id INTEGER PRIMARY KEY);
         DROP TABLE IF EXISTS temp.hand_on;
         CREATE TEMP TABLE hand_on (
             absorbed       INTEGER PRIMARY KEY,
             keeper         INTEGER NOT NULL,
             play_count     INTEGER NOT NULL,
             last_played_at INTEGER
         );",
    )?;
    {
        let mut insert = conn.prepare("INSERT OR IGNORE INTO temp.removing (id) VALUES (?1)")?;
        for id in ids {
            insert.execute([id])?;
        }
    }

    conn.execute_batch(
        "INSERT INTO temp.hand_on (absorbed, keeper, play_count, last_played_at)
         SELECT id, keeper, play_count, last_played_at FROM (
             SELECT t.id, t.play_count, t.last_played_at,
                    (SELECT k.id FROM tracks k
                      WHERE k.match_key = t.match_key
                        AND k.id NOT IN (SELECT id FROM temp.removing)
                      ORDER BY k.missing_since IS NOT NULL, k.id
                      LIMIT 1) AS keeper
               FROM tracks t
              WHERE t.id IN (SELECT id FROM temp.removing)
                AND t.match_key IS NOT NULL)
          WHERE keeper IS NOT NULL;

         -- OR IGNORE where the keeper already holds that place, or a second
         -- removed copy has just taken it: the entry left behind cascades.
         UPDATE OR IGNORE playlist_tracks
            SET track_id = (SELECT keeper FROM temp.hand_on WHERE absorbed = track_id)
          WHERE track_id IN (SELECT absorbed FROM temp.hand_on);",
    )?;

    let removed = conn.execute(
        "DELETE FROM tracks WHERE id IN (SELECT id FROM temp.removing)",
        [],
    )?;
    // The plays those files answered for are still facts; only the link to a
    // file is gone, and that is what a rebuild recomputes.
    crate::db::plays::resolve(conn)?;

    // Guarded for `lastfm::import::count`'s reason: every update of `tracks`
    // reindexes the row in `tracks_fts`.
    conn.execute_batch(
        "UPDATE tracks
            SET play_count = max(play_count, h.plays),
                last_played_at = nullif(max(coalesce(last_played_at, 0), h.last), 0)
           FROM (SELECT keeper,
                        max(max(play_count),
                            (SELECT count(*) FROM plays WHERE track_id = keeper)) AS plays,
                        max(coalesce(max(last_played_at), 0),
                            coalesce((SELECT max(started_at) FROM plays
                                       WHERE track_id = keeper), 0)) AS last
                   FROM temp.hand_on
                  GROUP BY keeper) h
          WHERE tracks.id = h.keeper
            AND (h.plays > tracks.play_count
                 OR h.last > coalesce(tracks.last_played_at, 0));

         DROP TABLE temp.removing;
         DROP TABLE temp.hand_on;",
    )?;
    Ok(removed as u32)
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
///
/// **Except the Library folder, while the library is being filed into it.**
/// [`plan`] marks missing every known row it did not walk, not only rows under
/// the roots it walked, so a library organised into a folder nobody watches is
/// a library marked missing in full on the next scan. Refused here rather than
/// only hidden in Settings, because two clicks in the panel below the switch
/// is not far enough away from 65,535 rows marked missing.
pub fn remove_watch_folder(conn: &Connection, path: &Path) -> AppResult<()> {
    if crate::db::settings::library_root(conn)?.as_deref() == Some(path) {
        return Err(AppError::Internal(
            "This is your Library folder. Turn off Organise My Library to stop watching it."
                .to_owned(),
        ));
    }
    conn.execute(
        "DELETE FROM watch_folders WHERE path = ?1",
        [path.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

/// Reads tags for `paths` in parallel.
///
/// A file that fails to parse comes back as its error rather than stopping the
/// batch: a corrupt file in a 50k library should cost that one file, not the
/// scan.
fn read_tags(paths: &[PathBuf]) -> Vec<(PathBuf, AppResult<TrackTags>)> {
    paths
        .par_iter()
        .map(|path| (path.clone(), tags::read(path)))
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
        .add("unreadable", summary.unreadable)
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
/// `on_unreadable` is called with the error of each file whose tags would not
/// parse, which names the file.
pub fn scan(
    conn: &mut Connection,
    on_progress: impl FnMut(ScanProgress),
    on_unreadable: impl FnMut(&AppError),
) -> AppResult<ScanSummary> {
    let roots = watch_folders(conn)?;
    scan_roots(conn, &roots, &[], on_progress, on_unreadable)
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
    mut on_unreadable: impl FnMut(&AppError),
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
            match tags {
                Ok(tags) => {
                    insert_track(&tx, path, tags)?;
                    summary.added += 1;
                }
                Err(error) => {
                    on_unreadable(error);
                    summary.unreadable += 1;
                }
            }
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
            match tags {
                Ok(tags) => {
                    update_track(&tx, path, tags)?;
                    summary.updated += 1;
                }
                Err(error) => {
                    on_unreadable(error);
                    summary.unreadable += 1;
                }
            }
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
    crate::db::plays::resolve(conn)?;

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

/// How many files the MusicBrainz-id pass reads per commit, and per hold of
/// the scan lock. Small, because a scan the user asked for waits out one chunk.
const MBID_CHUNK: i64 = 200;

/// Reads the MusicBrainz release tags off every file in the library, once.
///
/// **A backfill for what Picard wrote before this app read it.** Migrations 8
/// and 9 assumed nothing had written the ids and the type, but a Picard-tagged
/// file carries all three, and [`scan`] never re-reads a file whose mtime and
/// size are unchanged - so the lookup pass searches, and overwrites, releases
/// whose files already name them.
///
/// **Only empty ids are filled**, so an id the lookup already wrote stays. The
/// type is filled wherever the row's is not already a primary type: a scan
/// stored Picard's (`album`, `album; compilation`) raw before `tags::read`
/// normalized it, and it names the folder the mover files a release into.
///
/// A background thread in the shape of `covers::normalize_stored`: resumable
/// through a cursor committed with each chunk, and a flag once done. Each chunk
/// holds [`ScanLock`], so a scan or a move cannot rewrite a row between its file
/// being read here and the tags being written. Missing and unreadable files are
/// skipped; a scan reads them if they come back.
///
/// Answers how many rows it changed, or `None` on every launch after the one
/// that finished.
pub fn read_musicbrainz_tags(conn: &mut Connection, lock: &ScanLock) -> AppResult<Option<u32>> {
    use crate::db::settings;

    if settings::get(conn, settings::MUSICBRAINZ_READ)?.is_some() {
        return Ok(None);
    }
    let mut cursor: i64 = settings::get(conn, settings::MUSICBRAINZ_READ_THROUGH)?
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut found = 0;

    loop {
        let _guard = lock.acquire();
        let rows: Vec<(i64, String, Option<String>)> = conn
            .prepare(
                "SELECT id, path, release_type FROM tracks
                  WHERE id > ?1 AND missing_since IS NULL
                  ORDER BY id LIMIT ?2",
            )?
            .query_map(rusqlite::params![cursor, MBID_CHUNK], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let Some(&(last, ..)) = rows.last() else {
            break;
        };

        let tx = conn.transaction()?;
        for (id, path, stored) in rows {
            let Ok(read) = tags::musicbrainz_tags(Path::new(&path)) else {
                continue;
            };
            let settled = stored
                .as_deref()
                .is_some_and(|stored| tags::PRIMARY_TYPES.contains(&stored));
            let release_type = if settled { stored } else { read.release_type };
            found += tx.execute(
                "UPDATE tracks
                    SET release_mbid       = coalesce(release_mbid, ?2),
                        release_group_mbid = coalesce(release_group_mbid, ?3),
                        release_type       = ?4
                  WHERE id = ?1
                    AND (   (release_mbid IS NULL AND ?2 IS NOT NULL)
                         OR (release_group_mbid IS NULL AND ?3 IS NOT NULL)
                         OR release_type IS NOT ?4)",
                rusqlite::params![id, read.release, read.release_group, release_type],
            )? as u32;
        }
        // With the rows it describes, or a crash between the two skips them.
        settings::set(&tx, settings::MUSICBRAINZ_READ_THROUGH, &last.to_string())?;
        tx.commit()?;
        cursor = last;
    }

    settings::set(conn, settings::MUSICBRAINZ_READ, "true")?;
    Ok(Some(found))
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
                             release_mbid, release_group_mbid, release_type, cover_hash, added_at,
                             match_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18,
                 ?19, ?20, ?21)
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
             cover_hash = excluded.cover_hash, match_key = excluded.match_key",
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
            track_key(tags.artist.as_deref(), tags.title.as_deref()),
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
                           cover_hash = ?19, match_key = ?20
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
            track_key(tags.artist.as_deref(), tags.title.as_deref()),
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(entries: &[(&str, i64, i64)]) -> HashMap<Vec<u8>, Known> {
        marked(entries, &[])
    }

    /// The same, with the named paths already marked missing.
    fn marked(entries: &[(&str, i64, i64)], missing: &[&str]) -> HashMap<Vec<u8>, Known> {
        entries
            .iter()
            .enumerate()
            .map(|(i, (path, mtime, size))| {
                (
                    layout::fold(Path::new(path)),
                    Known {
                        id: i as i64 + 1,
                        path: (*path).to_owned(),
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

    fn tombstones(paths: &[&str]) -> HashSet<Vec<u8>> {
        paths.iter().map(|p| layout::fold(Path::new(p))).collect()
    }

    /// `plan` as a scan the user asked for: no tombstones, every root walked.
    fn plan(known: &HashMap<Vec<u8>, Known>, on_disk: &[(PathBuf, i64, i64)]) -> ScanPlan {
        super::plan(known, on_disk, &HashSet::new(), &[])
    }

    /// The invariant [`plan`] would otherwise break: a library filed into a
    /// folder nobody watches is marked missing in full on the next scan.
    #[test]
    fn the_library_folder_cannot_be_unwatched_while_it_is_being_filed_into() {
        use crate::db::{settings, Db};

        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path().join("library.sqlite3")).unwrap();
        let conn = db.conn().unwrap();
        let root = dir.path().join("Library");
        std::fs::create_dir(&root).unwrap();
        let listed = || watch_folders(&conn).unwrap();

        add_watch_folder(&conn, &root).unwrap();
        settings::set(&conn, settings::LIBRARY_ROOT, &root.to_string_lossy()).unwrap();
        settings::set(&conn, settings::ORGANIZE, "true").unwrap();

        assert!(remove_watch_folder(&conn, &root).is_err());
        assert_eq!(listed(), [root.as_path()].map(PathBuf::from));

        // Turning the switch off is what releases it.
        settings::set(&conn, settings::ORGANIZE, "false").unwrap();
        remove_watch_folder(&conn, &root).unwrap();
        assert!(listed().is_empty());
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

    /// `tracks.path` folds case since 82i, so a row the mover wrote in one
    /// casing and the walk reads back in another is one file. Compared
    /// byte-exact here, that file is marked missing and then insert's
    /// `ON CONFLICT` folds it onto the row that was just marked - a file on
    /// disk that the library cannot see.
    #[test]
    fn a_path_cased_differently_than_its_row_is_the_same_file() {
        let plan = plan(
            &known(&[("D:\\M\\The Corpse Of Rebirth\\01.mp3", 10, 100)]),
            &on_disk(&[("D:\\M\\The Corpse of Rebirth\\01.mp3", 10, 100)]),
        );

        assert_eq!(plan.unchanged, 1);
        assert!(plan.added.is_empty());
        assert!(plan.missing.is_empty());
    }

    /// And a tombstone is on the file, not on the spelling.
    #[test]
    fn a_tombstone_holds_under_another_casing() {
        let plan = super::plan(
            &HashMap::new(),
            &on_disk(&[("D:\\M\\The Corpse of Rebirth\\01.mp3", 10, 100)]),
            &tombstones(&["D:\\M\\The Corpse Of Rebirth\\01.mp3"]),
            &[],
        );

        assert!(plan.added.is_empty());
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
        let mut conn = db.conn().unwrap();
        conn.execute(
            "UPDATE tracks SET missing_since = 1 WHERE path = '/m/go.mp3'",
            [],
        )
        .unwrap();

        assert_eq!(remove_missing(&mut conn).unwrap(), 1);

        assert!(load_removed(&conn).unwrap().is_empty());
    }

    /// Two copies of one song, the older one played and in two playlists, the
    /// second of which the newer copy is not in. Returns (older, newer).
    fn copies(conn: &Connection) -> (i64, i64) {
        let key = crate::db::plays::match_key("Band", "Song");
        for (path, play_count, last) in [("/m/old.mp3", 40, Some(500)), ("/m/new.mp3", 0, None)] {
            conn.execute(
                "INSERT INTO tracks (path, mtime, size, title, artist, added_at, match_key,
                                     play_count, last_played_at)
                 VALUES (?1, 1, 1, 'Song', 'Band', 0, ?2, ?3, ?4)",
                rusqlite::params![path, key, play_count, last],
            )
            .unwrap();
        }
        let (old, new) = (id_of(conn, "/m/old.mp3"), id_of(conn, "/m/new.mp3"));
        conn.execute_batch(&format!(
            "INSERT INTO playlists (id, name, kind, created_at) VALUES
                 (10, 'Both', 'static', 0), (11, 'Old', 'static', 0);
             INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES
                 (10, {old}, 1), (10, {new}, 2), (11, {old}, 3);"
        ))
        .unwrap();
        (old, new)
    }

    fn counted(conn: &Connection, id: i64) -> (i64, Option<i64>) {
        conn.query_row(
            "SELECT play_count, last_played_at FROM tracks WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap()
    }

    fn places(conn: &Connection) -> Vec<(i64, i64, i64)> {
        conn.prepare("SELECT playlist_id, track_id, position FROM playlist_tracks ORDER BY 1, 3")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn play(conn: &Connection, started_at: i64) {
        conn.execute(
            "INSERT INTO plays (started_at, source, artist, title, match_key)
             VALUES (?1, 'local', 'Band', 'Song', ?2)",
            rusqlite::params![started_at, crate::db::plays::match_key("Band", "Song")],
        )
        .unwrap();
    }

    fn empty() -> (tempfile::TempDir, crate::db::Db) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::Db::open(dir.path().join("library.sqlite3")).unwrap();
        (dir, db)
    }

    #[test]
    fn removing_the_played_copy_hands_its_plays_to_the_one_that_stays() {
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);

        assert_eq!(remove_tracks(&mut conn, &[old]).unwrap(), 1);

        assert_eq!(counted(&conn, new), (40, Some(500)));
        // Where the copy that stays is already in the playlist, the place goes.
        assert_eq!(places(&conn), [(10, new, 2), (11, new, 3)]);
    }

    #[test]
    fn the_copy_that_stays_keeps_a_higher_count() {
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);
        conn.execute(
            "UPDATE tracks SET play_count = 50, last_played_at = 900 WHERE id = ?1",
            [new],
        )
        .unwrap();

        remove_tracks(&mut conn, &[old]).unwrap();

        assert_eq!(counted(&conn, new), (50, Some(900)));
    }

    #[test]
    fn the_plays_the_log_links_to_the_copy_that_stays_count_too() {
        // Local plays of the newer copy were logged against the older one,
        // which `resolve` preferred while both were there.
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);
        conn.execute(
            "UPDATE tracks SET play_count = 1 WHERE id IN (?1, ?2)",
            [old, new],
        )
        .unwrap();
        for started_at in [100, 200, 700] {
            play(&conn, started_at);
        }

        remove_tracks(&mut conn, &[old]).unwrap();

        assert_eq!(counted(&conn, new), (3, Some(700)));
    }

    #[test]
    fn removing_every_copy_hands_nothing_on() {
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);
        play(&conn, 100);
        crate::db::plays::resolve(&conn).unwrap();

        assert_eq!(remove_tracks(&mut conn, &[old, new]).unwrap(), 2);

        assert!(places(&conn).is_empty());
        assert_eq!(
            count(&conn, "SELECT count(*) FROM plays WHERE track_id IS NULL"),
            1,
            "the play stays in the log, unlinked"
        );
    }

    #[test]
    fn removing_a_missing_copy_hands_its_plays_to_the_one_that_is_there() {
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);
        conn.execute("UPDATE tracks SET missing_since = 1 WHERE id = ?1", [old])
            .unwrap();

        assert_eq!(remove_missing(&mut conn).unwrap(), 1);

        assert_eq!(counted(&conn, new), (40, Some(500)));
        assert_eq!(places(&conn), [(10, new, 2), (11, new, 3)]);
    }

    #[test]
    fn a_song_with_one_copy_is_removed_as_before() {
        let (_dir, db) = empty();
        let mut conn = db.conn().unwrap();
        let (old, new) = copies(&conn);
        conn.execute("UPDATE tracks SET match_key = 'other' WHERE id = ?1", [new])
            .unwrap();

        remove_tracks(&mut conn, &[old]).unwrap();

        assert_eq!(counted(&conn, new), (0, None));
        assert_eq!(places(&conn), [(10, new, 2)]);
    }
}
