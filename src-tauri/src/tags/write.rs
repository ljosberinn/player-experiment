//! Writing tags back to disk.
//!
//! One rule shapes everything here: a file is never edited in place - tags are
//! written to a copy that then replaces the original, so a crash or a full
//! disk cannot leave a half-written mp3 where music used to be.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::id3::v2::Id3v2Tag;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::probe::Probe;
use lofty::tag::{Tag, TagType};
use rusqlite::{Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::model::{CoverEdit, TagEdit, TagWriteSummary, WriteProgress};
use crate::tags::{hash_bytes, Cover};

/// Cover art larger than this is refused.
///
/// The bytes live in the database and travel through the `cover://` handler;
/// a 40 MB scan of an LP sleeve would bloat both for no visible gain.
const MAX_COVER_BYTES: usize = 12 * 1024 * 1024;

/// The TXXX descriptions the two MusicBrainz ids live under in ID3v2, paired
/// with the [`ItemKey`] lofty reads them into.
///
/// They have to be written by description because lofty will not write them by
/// key: its `Tag` to `Id3v2Tag` conversion (0.25, `id3/v2/tag/conversion.rs`)
/// has an arm for `MusicBrainzArtistId` and its siblings but none for these
/// two, and the fallback arm only handles four-character frame ids, so
/// `insert_text` on a generic tag is silently discarded on save. Reading is
/// unaffected - TXXX frames map back to `ItemKey` by description.
const MUSICBRAINZ_TXXX: [(ItemKey, &str); 2] = [
    (ItemKey::MusicBrainzReleaseId, "MusicBrainz Album Id"),
    (
        ItemKey::MusicBrainzReleaseGroupId,
        "MusicBrainz Release Group Id",
    ),
];

/// How many files are written between progress emissions.
///
/// Coarser than it looks like it should be. A tag write is a copy-and-replace
/// of a whole mp3, so one file is milliseconds rather than microseconds -
/// emitting per file would put hundreds of events a second on the IPC channel
/// to move a readout by a pixel. `scan` chunks at 200 for the same reason and
/// is doing much cheaper work per item.
const PROGRESS_INTERVAL: usize = 25;

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
    release_mbid: Option<Option<String>>,
    release_group_mbid: Option<Option<String>>,
    release_type: Option<Option<String>>,
    cover: Option<CoverChange>,
}

#[derive(Debug, Clone)]
enum CoverChange {
    Remove,
    /// Shared, because a batch is usually one cover repeated - a release whose
    /// artwork was replaced sends the same path with every track, and holding
    /// a copy per track would put hundreds of megabytes on the heap to write
    /// the same image.
    Replace(Arc<Cover>),
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

/// Resolves one edit, reusing any cover already loaded for the same path.
fn resolve(edit: &TagEdit, covers: &mut HashMap<String, Arc<Cover>>) -> AppResult<Resolved> {
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
        release_mbid: text(&edit.release_mbid),
        release_group_mbid: text(&edit.release_group_mbid),
        release_type: text(&edit.release_type),
        cover: match &edit.cover {
            None => None,
            Some(CoverEdit::Remove) => Some(CoverChange::Remove),
            Some(CoverEdit::Replace { path }) => {
                let cover = match covers.get(path) {
                    Some(cover) => Arc::clone(cover),
                    None => {
                        let cover = Arc::new(read_cover(path)?);
                        covers.insert(path.clone(), Arc::clone(&cover));
                        cover
                    }
                };
                Some(CoverChange::Replace(cover))
            }
        },
    })
}

/// Checks a candidate cover and reports the mime its bytes say it is.
///
/// The cap and the sniff live here rather than in either caller: a cover
/// reaches the app two ways now - picked as a path, or dropped as bytes - and
/// the two must refuse the same images.
///
/// The mime is sniffed rather than trusted from the extension. A file named
/// .jpg that is really a PNG would be stored mislabelled and fail to render,
/// and a dropped `File`'s `type` is derived from its name, so for a drop the
/// bytes are the only honest source there is.
pub(crate) fn check_cover(bytes: &[u8]) -> AppResult<&'static str> {
    if bytes.len() > MAX_COVER_BYTES {
        return Err(AppError::Internal(format!(
            "That image is {} MB; the limit is {} MB.",
            bytes.len() / 1024 / 1024,
            MAX_COVER_BYTES / 1024 / 1024
        )));
    }
    match bytes {
        [0xFF, 0xD8, 0xFF, ..] => Ok("image/jpeg"),
        [0x89, b'P', b'N', b'G', ..] => Ok("image/png"),
        _ => Err(AppError::Internal(
            "Cover art has to be a JPEG or a PNG.".to_owned(),
        )),
    }
}

/// Loads a replacement cover from the file the user picked.
///
/// A dropped image has already been through [`check_cover`] once, when it
/// was staged. It goes through again here: staging refuses early, while the
/// pointer is still over the square, and this is the last line before bytes go
/// into an mp3.
fn read_cover(path: &str) -> AppResult<Cover> {
    let bytes = std::fs::read(path).map_err(|e| AppError::io(path, e))?;
    let mime = check_cover(&bytes)?;
    Ok(Cover {
        hash: hash_bytes(&bytes),
        mime: mime.to_owned(),
        bytes,
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
    if let Some(value) = &resolved.release_mbid {
        set_or_remove(tag, ItemKey::MusicBrainzReleaseId, value);
    }
    if let Some(value) = &resolved.release_group_mbid {
        set_or_remove(tag, ItemKey::MusicBrainzReleaseGroupId, value);
    }
    if let Some(value) = &resolved.release_type {
        // Not in `MUSICBRAINZ_TXXX`, unlike the two ids above: lofty 0.25's
        // ID3v2 conversion has an arm for this key and emits the TXXX frame
        // without being told to.
        set_or_remove(tag, ItemKey::MusicBrainzReleaseType, value);
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
        save_tag(&temp, tag).map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))
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

/// Saves `tag`, carrying the MusicBrainz ids lofty would drop on the way.
///
/// See [`MUSICBRAINZ_TXXX`]. The values are taken off the generic tag before
/// the conversion loses them and put back as TXXX frames afterwards, which
/// covers both cases at once: an id the edit set, and an id the file already
/// carried that the edit never mentioned. A key absent from the tag stays
/// absent, so clearing one still clears it.
///
/// Only ID3v2 gets this. An mp3 carrying nothing but an ID3v1 tag has no frame
/// to put a MusicBrainz id in, and turning it into an ID3v2 file would be a
/// larger change to make silently than the ids are worth.
fn save_tag(path: &Path, tag: Tag) -> Result<(), lofty::error::FileEncodingError> {
    if tag.tag_type() != TagType::Id3v2 {
        return tag.save_to_path(path, WriteOptions::default());
    }

    let carried: Vec<(&str, String)> = MUSICBRAINZ_TXXX
        .iter()
        .filter_map(|(key, description)| {
            tag.get_string(*key)
                .map(|value| (*description, value.to_owned()))
        })
        .collect();

    let mut id3 = Id3v2Tag::from(tag);
    for (_, description) in MUSICBRAINZ_TXXX {
        id3.remove_user_text(description);
    }
    for (description, value) in carried {
        id3.insert_user_text(description.to_owned(), value);
    }
    id3.save_to_path(path, WriteOptions::default())
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
                           release_mbid = ?11, release_group_mbid = ?12, release_type = ?13,
                           cover_hash = ?14, mtime = ?15, size = ?16
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
            tags.release_mbid,
            tags.release_group_mbid,
            tags.release_type,
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
/// The bulk editor's shape: one set of fields broadcast over a selection.
/// Everything below it works per track, so this is the caller that repeats
/// itself rather than a second writer.
pub fn apply_to_each(
    conn: &mut Connection,
    track_ids: &[i64],
    edit: &TagEdit,
    on_progress: impl FnMut(WriteProgress),
) -> AppResult<TagWriteSummary> {
    let edits: Vec<(i64, TagEdit)> = track_ids.iter().map(|&id| (id, edit.clone())).collect();
    apply(conn, &edits, on_progress)
}

/// Applies one edit per track, in one batch.
///
/// Per track rather than one edit over many files, because a tracklist is the
/// case that cannot be spelled the other way: title, track number and disc
/// number all differ per file.
///
/// Files are written first and the database second, because the file is what
/// survives this application. A file that cannot be written is reported and
/// skipped rather than failing the batch - a locked file in the middle of 500
/// should not stop the other 499.
pub fn apply(
    conn: &mut Connection,
    edits: &[(i64, TagEdit)],
    mut on_progress: impl FnMut(WriteProgress),
) -> AppResult<TagWriteSummary> {
    // Every edit is resolved before any file is opened, so an unparseable
    // number in the last one refuses the batch rather than half-writing it.
    let mut covers: HashMap<String, Arc<Cover>> = HashMap::new();
    let resolved = edits
        .iter()
        .map(|(track_id, edit)| Ok((*track_id, resolve(edit, &mut covers)?)))
        .collect::<AppResult<Vec<(i64, Resolved)>>>()?;
    let total = resolved.len() as u32;
    // Before the first file, so a dialog showing this has a fraction to draw
    // rather than a blank while the first write is in flight.
    on_progress(WriteProgress { done: 0, total });

    let mut written: Vec<(i64, PathBuf)> = Vec::new();
    let mut failures: Vec<String> = Vec::new();

    for (index, (track_id, resolved)) in resolved.iter().enumerate() {
        let track_id = *track_id;
        let path: Option<String> = conn
            .query_row("SELECT path FROM tracks WHERE id = ?1", [track_id], |row| {
                row.get(0)
            })
            .optional()?;

        if let Some(path) = path.map(PathBuf::from) {
            match write_file(&path, resolved) {
                Ok(()) => written.push((track_id, path)),
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
    for (track_id, path) in &written {
        sync_row(&tx, *track_id, path)?;
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
    fn the_same_check_refuses_bytes_that_never_were_a_file() {
        // What a drop goes through: the picker's path never exists for it, so
        // the cap and the sniff have to be reachable from the bytes alone.
        assert!(check_cover(b"not an image at all").is_err());
        assert_eq!(
            check_cover(&[0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3]).unwrap(),
            "image/jpeg"
        );
        assert!(check_cover(&vec![0; MAX_COVER_BYTES + 1]).is_err());
    }

    #[test]
    fn a_missing_cover_file_is_reported_rather_than_panicking() {
        assert!(read_cover("C:\\nowhere\\missing.jpg").is_err());
    }
}
