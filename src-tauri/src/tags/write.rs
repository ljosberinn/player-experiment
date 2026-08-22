//! Writing tags back to disk, and undoing it.
//!
//! Two rules shape everything here. A file is never edited in place - tags are
//! written to a copy that then replaces the original, so a crash or a full
//! disk cannot leave a half-written mp3 where music used to be. And nothing is
//! written without first recording what was there, so a bulk edit over 500
//! files is one undoable step rather than 500 irreversible ones.

use std::path::{Path, PathBuf};

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::probe::Probe;
use lofty::tag::{Tag, TagType};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::model::{CoverEdit, TagEdit, TagWriteSummary, WriteProgress};
use crate::tags::{hash_bytes, Cover};

/// Cover art larger than this is refused.
///
/// The bytes live in the database and travel through the `cover://` handler;
/// a 40 MB scan of an LP sleeve would bloat both for no visible gain.
const MAX_COVER_BYTES: usize = 12 * 1024 * 1024;

/// How many files are written between progress emissions.
///
/// Coarser than it looks like it should be. A tag write is a copy-and-replace
/// of a whole mp3, so one file is milliseconds rather than microseconds -
/// emitting per file would put hundreds of events a second on the IPC channel
/// to move a readout by a pixel. `scan` chunks at 200 for the same reason and
/// is doing much cheaper work per item.
const PROGRESS_INTERVAL: usize = 25;

/// Everything an edit can change, as it was before the edit.
///
/// Stored as JSON in `tag_undo`. Cover art is referenced by hash rather than
/// copied - the bytes are already in `covers`, which nothing deletes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagSnapshot {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub comment: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub cover_hash: Option<String>,
}

/// Which fields an edit touches, resolved from the request's strings.
///
/// A field the user did not touch is `None` and is left exactly as it was -
/// that is what makes a bulk edit over mixed values safe. A field they cleared
/// is `Some(None)`.
#[derive(Debug, Clone, Default)]
struct Resolved {
    title: Option<Option<String>>,
    artist: Option<Option<String>>,
    album: Option<Option<String>>,
    album_artist: Option<Option<String>>,
    genre: Option<Option<String>>,
    comment: Option<Option<String>>,
    year: Option<Option<i64>>,
    track_no: Option<Option<i64>>,
    disc_no: Option<Option<i64>>,
    cover: Option<CoverChange>,
}

#[derive(Debug, Clone)]
enum CoverChange {
    Remove,
    Replace(Cover),
}

/// An empty string means "clear this field"; absent means "leave it alone".
fn text(field: &Option<String>) -> Option<Option<String>> {
    field.as_ref().map(|value| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_owned())
    })
}

/// Numbers arrive as strings for the same reason text does: the editor's
/// inputs hold strings, and an empty one has to mean "clear" rather than zero.
fn number(field: &Option<String>, name: &str) -> AppResult<Option<Option<i64>>> {
    match field {
        None => Ok(None),
        Some(value) if value.trim().is_empty() => Ok(Some(None)),
        Some(value) => value
            .trim()
            .parse::<i64>()
            .map(|parsed| Some(Some(parsed)))
            .map_err(|_| {
                AppError::Internal(format!("{name} must be a number, or empty to clear."))
            }),
    }
}

fn resolve(edit: &TagEdit) -> AppResult<Resolved> {
    Ok(Resolved {
        title: text(&edit.title),
        artist: text(&edit.artist),
        album: text(&edit.album),
        album_artist: text(&edit.album_artist),
        genre: text(&edit.genre),
        comment: text(&edit.comment),
        year: number(&edit.year, "Year")?,
        track_no: number(&edit.track_no, "Track number")?,
        disc_no: number(&edit.disc_no, "Disc number")?,
        cover: match &edit.cover {
            None => None,
            Some(CoverEdit::Remove) => Some(CoverChange::Remove),
            Some(CoverEdit::Replace { path }) => Some(CoverChange::Replace(read_cover(path)?)),
        },
    })
}

/// Loads a replacement cover from the file the user picked.
fn read_cover(path: &str) -> AppResult<Cover> {
    let bytes = std::fs::read(path).map_err(|e| AppError::io(path, e))?;
    if bytes.len() > MAX_COVER_BYTES {
        return Err(AppError::Internal(format!(
            "That image is {} MB; the limit is {} MB.",
            bytes.len() / 1024 / 1024,
            MAX_COVER_BYTES / 1024 / 1024
        )));
    }
    // Sniffed from the bytes rather than trusted from the extension: a file
    // named .jpg that is really a PNG would otherwise be stored mislabelled and
    // fail to render.
    let mime = match bytes.as_slice() {
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        _ => {
            return Err(AppError::Internal(
                "Cover art has to be a JPEG or a PNG.".to_owned(),
            ))
        }
    };
    Ok(Cover {
        hash: hash_bytes(&bytes),
        mime: mime.to_owned(),
        bytes,
    })
}

/// The tags a file carries right now, for the undo journal.
fn snapshot(path: &Path) -> AppResult<TagSnapshot> {
    let tags = crate::tags::read(path)?;
    Ok(TagSnapshot {
        title: tags.title,
        artist: tags.artist,
        album: tags.album,
        album_artist: tags.album_artist,
        genre: tags.genre,
        comment: tags.comment,
        year: tags.year,
        track_no: tags.track_no,
        disc_no: tags.disc_no,
        cover_hash: tags.cover.map(|cover| cover.hash),
    })
}

fn set_or_remove(tag: &mut Tag, key: ItemKey, value: &Option<String>) {
    match value {
        Some(text) => {
            tag.insert_text(key, text.clone());
        }
        None => {
            tag.remove_key(key);
        }
    }
}

/// Applies `resolved` to `tag`, leaving untouched fields exactly as they were.
fn mutate(tag: &mut Tag, resolved: &Resolved) {
    if let Some(value) = &resolved.title {
        set_or_remove(tag, ItemKey::TrackTitle, value);
    }
    if let Some(value) = &resolved.artist {
        set_or_remove(tag, ItemKey::TrackArtist, value);
    }
    if let Some(value) = &resolved.album {
        set_or_remove(tag, ItemKey::AlbumTitle, value);
    }
    if let Some(value) = &resolved.album_artist {
        set_or_remove(tag, ItemKey::AlbumArtist, value);
    }
    if let Some(value) = &resolved.genre {
        set_or_remove(tag, ItemKey::Genre, value);
    }
    if let Some(value) = &resolved.comment {
        set_or_remove(tag, ItemKey::Comment, value);
    }
    if let Some(value) = &resolved.year {
        // ID3v2.4 carries the year in TDRC (RecordingDate); the reader accepts
        // either, but writing the v2.3 TYER would be writing to a frame this
        // build of lofty does not emit.
        set_or_remove(tag, ItemKey::RecordingDate, &value.map(|y| y.to_string()));
    }
    if let Some(value) = &resolved.track_no {
        match value {
            Some(number) => tag.set_track(*number as u32),
            None => tag.remove_track(),
        }
    }
    if let Some(value) = &resolved.disc_no {
        match value {
            Some(number) => tag.set_disk(*number as u32),
            None => tag.remove_disk(),
        }
    }
    if let Some(change) = &resolved.cover {
        // Every picture goes, not just the front cover: a file with three
        // embedded images should end up showing the one that was chosen.
        tag.remove_picture_type(PictureType::CoverFront);
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
        if let CoverChange::Replace(cover) = change {
            let mime = if cover.mime == "image/png" {
                MimeType::Png
            } else {
                MimeType::Jpeg
            };
            tag.push_picture(
                Picture::unchecked(cover.bytes.clone())
                    .pic_type(PictureType::CoverFront)
                    .mime_type(mime)
                    .into(),
            );
        }
    }
}

/// Writes `resolved` into the file at `path`, atomically.
///
/// The tags go onto a copy beside the original, which then replaces it in one
/// rename. A crash mid-write therefore leaves either the old file or the new
/// one, never a truncated mp3 - and the copy is in the same directory so the
/// rename stays on one filesystem and stays atomic.
fn write_file(path: &Path, resolved: &Resolved) -> AppResult<()> {
    let temp = temp_beside(path);
    std::fs::copy(path, &temp).map_err(|e| AppError::io(temp.display(), e))?;

    let result = (|| -> AppResult<()> {
        let tagged = Probe::open(&temp)
            .map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))?
            .read()
            .map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))?;

        let mut tag = tagged
            .primary_tag()
            .or_else(|| tagged.first_tag())
            .cloned()
            // A file with no tag at all still has to be editable.
            .unwrap_or_else(|| Tag::new(TagType::Id3v2));

        mutate(&mut tag, resolved);
        tag.save_to_path(&temp, WriteOptions::default())
            .map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))
    })();

    if result.is_err() {
        // The original is untouched, so the copy is just litter.
        let _ = std::fs::remove_file(&temp);
        return result;
    }

    // On Windows this is MoveFileEx with MOVEFILE_REPLACE_EXISTING, so it
    // replaces the original rather than failing on it.
    std::fs::rename(&temp, path).map_err(|e| AppError::io(path.display(), e))?;
    Ok(())
}

/// A sibling of `path`, so the rename never crosses a filesystem boundary.
///
/// The marker is a *prefix*: lofty picks its writer from the file extension,
/// so a temp file called `01 Maki.mp3.player-tmp` is not something it will
/// write mp3 tags into. Keeping `.mp3` on the end keeps it one.
fn temp_beside(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "track".to_owned());
    path.with_file_name(format!(".player-tmp-{name}"))
}

/// Re-reads a file and writes what it found into its library row.
///
/// Reading back rather than trusting the edit: the file is the source of
/// truth, and a tag lofty normalised on write would otherwise leave the row
/// disagreeing with the disk until the next scan.
fn sync_row(conn: &Connection, track_id: i64, path: &Path) -> AppResult<()> {
    let tags = crate::tags::read(path)?;
    let metadata = std::fs::metadata(path).map_err(|e| AppError::io(path.display(), e))?;

    let cover_hash = match &tags.cover {
        Some(cover) => Some(crate::db::covers::store(conn, cover)?),
        None => None,
    };

    conn.execute(
        "UPDATE tracks SET title = ?2, artist = ?3, album = ?4, album_artist = ?5,
                           genre = ?6, comment = ?7, year = ?8, track_no = ?9, disc_no = ?10,
                           cover_hash = ?11, mtime = ?12, size = ?13
         WHERE id = ?1",
        rusqlite::params![
            track_id,
            tags.title,
            tags.artist,
            tags.album,
            tags.album_artist,
            tags.genre,
            tags.comment,
            tags.year,
            tags.track_no,
            tags.disc_no,
            cover_hash,
            metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs() as i64),
            metadata.len() as i64,
        ],
    )?;
    Ok(())
}

/// Applies one edit to many tracks.
///
/// Files are written first and the database second, because the file is what
/// survives this application. A file that cannot be written is reported and
/// skipped rather than failing the batch - a locked file in the middle of 500
/// should not undo the other 499.
pub fn apply(
    conn: &mut Connection,
    track_ids: &[i64],
    edit: &TagEdit,
    now: i64,
    mut on_progress: impl FnMut(WriteProgress),
) -> AppResult<TagWriteSummary> {
    let resolved = resolve(edit)?;
    let total = track_ids.len() as u32;
    // Before the first file, so a dialog showing this has a fraction to draw
    // rather than a blank while the first write is in flight.
    on_progress(WriteProgress { done: 0, total });
    // A batch id groups one user action, so undo restores all of it at once.
    let batch_id = now
        .checked_mul(1000)
        .unwrap_or(now)
        .saturating_add(conn.query_row("SELECT count(*) FROM tag_undo", [], |row| row.get(0))?);

    let mut written: Vec<(i64, PathBuf, TagSnapshot)> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for (index, &track_id) in track_ids.iter().enumerate() {
        let path: Option<String> = conn
            .query_row("SELECT path FROM tracks WHERE id = ?1", [track_id], |row| {
                row.get(0)
            })
            .optional()?;

        if let Some(path) = path.map(PathBuf::from) {
            // Snapshot before writing, so undo has something to restore even
            // if the write half-succeeds.
            match snapshot(&path).and_then(|before| write_file(&path, &resolved).map(|()| before)) {
                Ok(before) => written.push((track_id, path, before)),
                Err(error) => failures.push(error.to_string()),
            }
        }

        // Counted against every id asked for, not just the ones that turned
        // out to have a row - otherwise a selection naming rows a rescan has
        // since removed would leave the readout short of its own total.
        let done = index as u32 + 1;
        if (done as usize).is_multiple_of(PROGRESS_INTERVAL) {
            on_progress(WriteProgress { done, total });
        }
    }
    // The database work below is one transaction and reports nothing, so the
    // readout would otherwise stop short of its total and stay there.
    on_progress(WriteProgress { done: total, total });

    let tx = conn.transaction()?;
    for (track_id, path, before) in &written {
        sync_row(&tx, *track_id, path)?;
        tx.execute(
            "INSERT INTO tag_undo (batch_id, track_id, prev_tags_json, applied_at)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                batch_id,
                track_id,
                serde_json::to_string(before)
                    .map_err(|e| AppError::Internal(format!("could not record undo: {e}")))?,
                now
            ],
        )?;
    }
    // In the same transaction as the rows it is derived from, so a suggestion
    // list can never describe a library state that was rolled back.
    crate::db::tag_values::rebuild(&tx)?;
    tx.commit()?;

    Ok(TagWriteSummary {
        written: written.len() as u32,
        failed: failures.len() as u32,
        errors: failures,
    })
}

/// Reverts the most recent edit batch.
///
/// Undo is itself an edit - it writes files - but it is deliberately *not*
/// journalled: a redo stack invites the "undo, edit, undo" confusion, and one
/// level of certainty is worth more here than two levels of guessing.
pub fn undo_last(
    conn: &mut Connection,
    mut on_progress: impl FnMut(WriteProgress),
) -> AppResult<TagWriteSummary> {
    let batch_id: Option<i64> = conn
        .query_row("SELECT max(batch_id) FROM tag_undo", [], |row| row.get(0))
        .optional()?
        .flatten();
    let Some(batch_id) = batch_id else {
        return Err(AppError::Internal("There is nothing to undo.".to_owned()));
    };

    let mut stmt = conn.prepare(
        "SELECT tag_undo.track_id, tracks.path, tag_undo.prev_tags_json
         FROM tag_undo JOIN tracks ON tracks.id = tag_undo.track_id
         WHERE tag_undo.batch_id = ?1",
    )?;
    let entries: Vec<(i64, String, String)> = stmt
        .query_map([batch_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    let mut restored: Vec<(i64, PathBuf)> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    let total = entries.len() as u32;
    on_progress(WriteProgress { done: 0, total });

    for (index, (track_id, path, json)) in entries.into_iter().enumerate() {
        let path = PathBuf::from(path);
        let before: TagSnapshot = match serde_json::from_str(&json) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                failures.push(format!(
                    "{}: unreadable undo record ({error})",
                    path.display()
                ));
                continue;
            }
        };

        let resolved = match to_resolved(conn, &before) {
            Ok(resolved) => resolved,
            Err(error) => {
                failures.push(error.to_string());
                continue;
            }
        };

        match write_file(&path, &resolved) {
            Ok(()) => restored.push((track_id, path)),
            Err(error) => failures.push(error.to_string()),
        }

        let done = index as u32 + 1;
        if (done as usize).is_multiple_of(PROGRESS_INTERVAL) {
            on_progress(WriteProgress { done, total });
        }
    }
    on_progress(WriteProgress { done: total, total });

    let tx = conn.transaction()?;
    for (track_id, path) in &restored {
        sync_row(&tx, *track_id, path)?;
    }
    // The batch goes whether or not every file came back: leaving it would
    // make the next undo try the same failures again forever.
    tx.execute("DELETE FROM tag_undo WHERE batch_id = ?1", [batch_id])?;
    // An undo changes tags, so it changes the vocabulary - and this is the
    // direction that matters most: a typo corrected and then un-corrected has
    // to come back as a suggestion, or the list quietly disagrees with disk.
    crate::db::tag_values::rebuild(&tx)?;
    tx.commit()?;

    Ok(TagWriteSummary {
        written: restored.len() as u32,
        failed: failures.len() as u32,
        errors: failures,
    })
}

/// Turns a snapshot into an edit that sets every field to what it was.
///
/// Undo has to clear a field the edit *added*, so every field is `Some` here -
/// including the ones that were empty before.
fn to_resolved(conn: &Connection, before: &TagSnapshot) -> AppResult<Resolved> {
    let cover = match &before.cover_hash {
        None => CoverChange::Remove,
        Some(hash) => {
            let found = crate::db::query::cover_bytes(conn, hash)?;
            match found {
                Some((mime, bytes)) => CoverChange::Replace(Cover {
                    hash: hash.clone(),
                    mime,
                    bytes,
                }),
                // The bytes are gone, so the best available truth is "no
                // cover" - better than refusing to undo the rest of the tags.
                None => CoverChange::Remove,
            }
        }
    };

    Ok(Resolved {
        title: Some(before.title.clone()),
        artist: Some(before.artist.clone()),
        album: Some(before.album.clone()),
        album_artist: Some(before.album_artist.clone()),
        genre: Some(before.genre.clone()),
        comment: Some(before.comment.clone()),
        year: Some(before.year),
        track_no: Some(before.track_no),
        disc_no: Some(before.disc_no),
        cover: Some(cover),
    })
}

/// Whether there is a batch to undo, for enabling the menu item.
pub fn can_undo(conn: &Connection) -> AppResult<bool> {
    let count: i64 = conn.query_row("SELECT count(*) FROM tag_undo", [], |row| row.get(0))?;
    Ok(count > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_absent_field_is_left_alone_and_an_empty_one_clears() {
        assert_eq!(text(&None), None, "untouched");
        assert_eq!(text(&Some(String::new())), Some(None), "cleared");
        assert_eq!(text(&Some("  ".to_owned())), Some(None), "blank clears too");
        assert_eq!(
            text(&Some(" Tokyo ".to_owned())),
            Some(Some("Tokyo".to_owned()))
        );
    }

    #[test]
    fn numbers_follow_the_same_rule_and_report_what_cannot_be_parsed() {
        assert_eq!(number(&None, "Year").unwrap(), None);
        assert_eq!(number(&Some(String::new()), "Year").unwrap(), Some(None));
        assert_eq!(
            number(&Some(" 2012 ".to_owned()), "Year").unwrap(),
            Some(Some(2012))
        );

        let error = number(&Some("twenty".to_owned()), "Year").unwrap_err();
        assert!(error.to_string().contains("Year"), "unhelpful: {error}");
    }

    #[test]
    fn the_temp_file_is_a_sibling_so_the_rename_stays_atomic() {
        let path = Path::new("C:\\music\\Guitar\\01 Maki.mp3");
        let temp = temp_beside(path);

        assert_eq!(temp.parent(), path.parent());
        assert_ne!(temp.file_name(), path.file_name());
        // lofty chooses its writer by extension, so the temp file has to keep
        // the original one or nothing can be written into it.
        assert_eq!(temp.extension(), path.extension());
    }

    #[test]
    fn cover_art_has_to_be_an_image_we_can_actually_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cover.jpg");

        // Named .jpg, but the bytes say otherwise.
        std::fs::write(&path, b"not an image at all").unwrap();
        assert!(read_cover(&path.to_string_lossy()).is_err());

        std::fs::write(&path, [0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap();
        assert_eq!(
            read_cover(&path.to_string_lossy()).unwrap().mime,
            "image/jpeg"
        );

        std::fs::write(&path, [0x89, b'P', b'N', b'G', 1, 2, 3]).unwrap();
        assert_eq!(
            read_cover(&path.to_string_lossy()).unwrap().mime,
            "image/png"
        );
    }

    #[test]
    fn a_missing_cover_file_is_reported_rather_than_panicking() {
        assert!(read_cover("C:\\nowhere\\missing.jpg").is_err());
    }
}
