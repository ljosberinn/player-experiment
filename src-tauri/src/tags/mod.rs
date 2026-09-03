//! Reading tags off disk.
//!
//! Reading is fast and forgiving, since a real library always contains files
//! with missing or malformed tags and a scan must not stop for them. Writing
//! lives in [`write`], where the rules are the opposite: careful, atomic, and
//! never without a record of what was there before.

pub mod write;

use std::path::Path;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::ItemKey;
use lofty::probe::Probe;
use lofty::tag::Accessor;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Cover art extracted from a file, identified by content hash so the same
/// artwork shared across an album is stored once.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cover {
    pub hash: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TrackTags {
    pub duration_ms: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub comment: Option<String>,
    /// The MusicBrainz release this file belongs to, and the release group it
    /// belongs to across every pressing. Read here rather than only written,
    /// because the file is the source of truth: a column the writer fills but
    /// the reader ignores is blank again the next time a rescan re-adds it.
    pub release_mbid: Option<String>,
    pub release_group_mbid: Option<String>,
    /// Album, EP, Single and the rest, read for the same reason the two ids
    /// above are: a column only the writer fills is blank again the next time
    /// a rescan re-adds the row.
    pub release_type: Option<String>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub cover: Option<Cover>,
}

/// Reads tags, audio properties and cover art from one file.
pub fn read(path: &Path) -> AppResult<TrackTags> {
    let tagged = Probe::open(path)
        .map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))?
        .read()
        .map_err(|e| AppError::Internal(format!("{}: {e}", path.display())))?;

    let properties = tagged.properties();
    let mut tags = TrackTags {
        duration_ms: properties.duration().as_millis() as i64,
        bitrate: properties.audio_bitrate().map(i64::from),
        sample_rate: properties.sample_rate().map(i64::from),
        ..Default::default()
    };

    // Prefer the primary tag; fall back to whatever else the file carries so a
    // file tagged only with ID3v1, say, still yields something.
    let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) else {
        return Ok(tags);
    };

    tags.title = non_empty(tag.title().as_deref());
    tags.artist = non_empty(tag.artist().as_deref());
    tags.album = non_empty(tag.album().as_deref());
    tags.genre = non_empty(tag.genre().as_deref());
    tags.comment = non_empty(tag.comment().as_deref());
    tags.album_artist = non_empty(tag.get_string(ItemKey::AlbumArtist));
    tags.year = non_empty(tag.get_string(ItemKey::Year))
        .or_else(|| non_empty(tag.get_string(ItemKey::RecordingDate)))
        .as_deref()
        .and_then(parse_year);
    tags.track_no = tag.track().map(i64::from);
    tags.disc_no = tag.disk().map(i64::from);
    tags.release_mbid = non_empty(tag.get_string(ItemKey::MusicBrainzReleaseId));
    tags.release_group_mbid = non_empty(tag.get_string(ItemKey::MusicBrainzReleaseGroupId));
    tags.release_type = non_empty(tag.get_string(ItemKey::MusicBrainzReleaseType));

    tags.cover = tag.pictures().first().map(|picture| {
        let bytes = picture.data().to_vec();
        Cover {
            hash: hash_bytes(&bytes),
            mime: picture
                .mime_type()
                .map(ToString::to_string)
                .unwrap_or_else(|| "application/octet-stream".to_owned()),
            bytes,
        }
    });

    Ok(tags)
}

/// Pulls a year out of a date tag.
///
/// The year field is free text in practice: `2012`, `2012-05-01` and
/// `2012/05/01` all occur, so take the leading four-digit run rather than
/// requiring the whole value to parse.
///
/// `0000` is a placeholder taggers write for "no year", not a year, and it
/// would otherwise reach the browse views as one.
fn parse_year(value: &str) -> Option<i64> {
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    (digits.len() == 4)
        .then(|| digits.parse().ok())
        .flatten()
        .filter(|year| *year != 0)
}

/// Treats whitespace-only tag values as absent - they are common in the wild
/// and would otherwise sort and group as if they were real values.
fn non_empty(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

pub fn hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    // Hex of the first 16 bytes: collision risk is negligible for cover art
    // and it keeps the key short enough to be comfortable in a URL.
    digest.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_blank_tag_values_as_missing() {
        assert_eq!(non_empty(Some("  ")), None);
        assert_eq!(non_empty(Some("")), None);
        assert_eq!(non_empty(None), None);
        assert_eq!(non_empty(Some("  Tokyo ")), Some("Tokyo".to_owned()));
    }

    #[test]
    fn extracts_a_year_from_the_date_formats_that_occur_in_the_wild() {
        assert_eq!(parse_year("2012"), Some(2012));
        assert_eq!(parse_year("2012-05-01"), Some(2012));
        assert_eq!(parse_year("2012/05/01"), Some(2012));
        assert_eq!(
            parse_year("12"),
            None,
            "two-digit years are too ambiguous to guess"
        );
        assert_eq!(parse_year(""), None);
        assert_eq!(parse_year("unknown"), None);
        assert_eq!(
            parse_year("0000"),
            None,
            "a zero year is a tagger's placeholder, not a year"
        );
        assert_eq!(parse_year("0000-00-00"), None);
    }

    #[test]
    fn hashes_are_stable_and_content_addressed() {
        assert_eq!(hash_bytes(b"cover"), hash_bytes(b"cover"));
        assert_ne!(hash_bytes(b"cover"), hash_bytes(b"other"));
        assert_eq!(hash_bytes(b"cover").len(), 32);
    }

    #[test]
    fn reading_a_non_audio_file_errors_rather_than_panicking() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("not-audio.mp3");
        std::fs::write(&path, b"this is not an mp3").unwrap();

        assert!(read(&path).is_err());
    }
}
