//! Bringing the database in line with what is on disk.
//!
//! Scanning is explicit rather than filesystem-watched, and incremental: a
//! file whose (mtime, size) is unchanged is never re-parsed, so a rescan of a
//! large library costs a directory walk rather than tens of thousands of tag
//! reads.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use rusqlite::Connection;
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

/// What the database already knows about a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Known {
    id: i64,
    mtime: i64,
    size: i64,
}

/// Which files need work, decided before any tag is read.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ScanPlan {
    pub added: Vec<PathBuf>,
    pub updated: Vec<PathBuf>,
    pub removed: Vec<i64>,
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
pub fn plan(known: &HashMap<String, Known>, on_disk: &[(PathBuf, i64, i64)]) -> ScanPlan {
    let mut plan = ScanPlan::default();
    let mut seen = std::collections::HashSet::with_capacity(on_disk.len());

    for (path, mtime, size) in on_disk {
        let key = path.to_string_lossy().to_string();
        seen.insert(key.clone());

        match known.get(&key) {
            None => plan.added.push(path.clone()),
            Some(entry) if entry.mtime != *mtime || entry.size != *size => {
                plan.updated.push(path.clone());
            }
            Some(_) => plan.unchanged += 1,
        }
    }

    for (key, entry) in known {
        if !seen.contains(key) {
            plan.removed.push(entry.id);
        }
    }

    plan
}

fn load_known(conn: &Connection) -> AppResult<HashMap<String, Known>> {
    let mut stmt = conn.prepare("SELECT id, path, mtime, size FROM tracks")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            Known {
                id: row.get(0)?,
                mtime: row.get(2)?,
                size: row.get(3)?,
            },
        ))
    })?;
    Ok(rows.collect::<rusqlite::Result<HashMap<_, _>>>()?)
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

/// Runs a full incremental scan of the configured watch folders.
///
/// `on_progress` is called periodically; it is a closure rather than a Tauri
/// handle so the whole scan can be exercised in tests without a running app.
pub fn scan(
    conn: &mut Connection,
    mut on_progress: impl FnMut(ScanProgress),
) -> AppResult<ScanSummary> {
    let roots = watch_folders(conn)?;
    let on_disk = walk(&roots);
    let known = load_known(conn)?;
    let plan = plan(&known, &on_disk);

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
        removed: 0,
        done: false,
    });

    if !plan.removed.is_empty() {
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare("DELETE FROM tracks WHERE id = ?1")?;
            for id in &plan.removed {
                stmt.execute([id])?;
            }
        }
        tx.commit()?;
        summary.removed = plan.removed.len() as u32;
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
            removed: summary.removed,
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
            removed: summary.removed,
            done: false,
        });
    }

    on_progress(ScanProgress {
        scanned,
        total,
        added: summary.added,
        updated: summary.updated,
        removed: summary.removed,
        done: true,
    });

    Ok(summary)
}

/// Stores cover art if it is not already present, returning its hash.
fn store_cover(conn: &Connection, tags: &TrackTags) -> AppResult<Option<String>> {
    let Some(cover) = &tags.cover else {
        return Ok(None);
    };
    conn.execute(
        "INSERT OR IGNORE INTO covers (hash, mime, bytes) VALUES (?1, ?2, ?3)",
        rusqlite::params![cover.hash, cover.mime, cover.bytes],
    )?;
    Ok(Some(cover.hash.clone()))
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
                             cover_hash, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(path) DO UPDATE SET
             mtime = excluded.mtime, size = excluded.size,
             duration_ms = excluded.duration_ms, title = excluded.title,
             artist = excluded.artist, album = excluded.album,
             album_artist = excluded.album_artist, genre = excluded.genre,
             year = excluded.year, track_no = excluded.track_no,
             disc_no = excluded.disc_no, comment = excluded.comment,
             bitrate = excluded.bitrate, sample_rate = excluded.sample_rate,
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
                           cover_hash = ?16
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
            cover_hash,
        ],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(entries: &[(&str, i64, i64)]) -> HashMap<String, Known> {
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
        assert!(plan.removed.is_empty());
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
        assert_eq!(plan.removed.len(), 1, "the missing file should be removed");
        assert_eq!(plan.unchanged, 1);
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
}
