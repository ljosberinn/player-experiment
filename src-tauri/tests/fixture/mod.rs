//! Builds real, parseable mp3 files for the integration tests.
//!
//! Generated rather than committed: no encoder dependency, no binary blobs in
//! git, and no question about the licensing of the audio.

// Compiled separately into each integration test that includes it, and no one
// test uses all of it.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use lofty::config::{ParseOptions, WriteOptions};
use lofty::file::AudioFile;
use lofty::id3::v2::Id3v2Tag;
use lofty::mpeg::MpegFile;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::{Accessor, ItemKey, TagExt};
use lofty::tag::{Tag, TagType};

/// One frame of silent MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono.
///
/// Header bytes: `FF FB` sync + MPEG-1 + Layer III + no CRC, `90` for the
/// 128 kbps/44.1 kHz pair with no padding, `C0` for mono. At that rate a frame
/// is `144 * 128000 / 44100 = 417` bytes, so the rest is silence.
fn silent_frame() -> Vec<u8> {
    let mut frame = vec![0xFF, 0xFB, 0x90, 0xC0];
    frame.resize(417, 0);
    frame
}

/// `frames` frames is roughly `frames * 1152 / 44100` seconds of audio.
fn silent_mp3(frames: usize) -> Vec<u8> {
    silent_frame().repeat(frames)
}

#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub title: Option<&'static str>,
    pub artist: Option<&'static str>,
    pub album: Option<&'static str>,
    pub album_artist: Option<&'static str>,
    pub genre: Option<&'static str>,
    pub year: Option<&'static str>,
    pub track_no: Option<u32>,
    pub comment: Option<&'static str>,
    pub release_mbid: Option<&'static str>,
    pub release_group_mbid: Option<&'static str>,
    /// Cover art bytes. Identical bytes across files must dedupe to one row.
    pub cover: Option<&'static [u8]>,
}

/// Writes a tagged mp3 at `path`, creating parent directories as needed.
pub fn write_mp3(path: &Path, frames: usize, meta: &Meta) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create fixture dir");
    }
    std::fs::write(path, silent_mp3(frames)).expect("write fixture mp3");

    let mut tag = Tag::new(TagType::Id3v2);
    if let Some(v) = meta.title {
        tag.set_title(v.to_owned());
    }
    if let Some(v) = meta.artist {
        tag.set_artist(v.to_owned());
    }
    if let Some(v) = meta.album {
        tag.set_album(v.to_owned());
    }
    if let Some(v) = meta.genre {
        tag.set_genre(v.to_owned());
    }
    if let Some(v) = meta.comment {
        tag.set_comment(v.to_owned());
    }
    if let Some(v) = meta.album_artist {
        tag.insert_text(ItemKey::AlbumArtist, v.to_owned());
    }
    if let Some(v) = meta.year {
        // ID3v2.4 - which is what lofty writes - carries the year in TDRC
        // (RecordingDate), not the v2.3 TYER that ItemKey::Year maps to.
        // The reader accepts either.
        tag.insert_text(ItemKey::RecordingDate, v.to_owned());
    }
    if let Some(v) = meta.track_no {
        tag.set_track(v);
    }
    if let Some(bytes) = meta.cover {
        // `unchecked` skips format sniffing, which matters here because the
        // fixture "images" are plain byte strings rather than real JPEGs.
        let picture: Picture = Picture::unchecked(bytes.to_vec())
            .pic_type(PictureType::CoverFront)
            .mime_type(MimeType::Jpeg)
            .into();
        tag.push_picture(picture);
    }

    // Through `Id3v2Tag` rather than the generic tag, because lofty drops the
    // two MusicBrainz ids on the way out of a `Tag` - the same gap `save_tag`
    // works around in the writer, and the fixture has to write what the writer
    // writes or the tests are asserting against files nothing could produce.
    let mut id3 = Id3v2Tag::from(tag);
    if let Some(v) = meta.release_mbid {
        id3.insert_user_text("MusicBrainz Album Id".to_owned(), v.to_owned());
    }
    if let Some(v) = meta.release_group_mbid {
        id3.insert_user_text("MusicBrainz Release Group Id".to_owned(), v.to_owned());
    }
    id3.save_to_path(path, WriteOptions::default())
        .expect("write tags");
}

/// Puts `value` in an mp3's release-type frame as Picard does, which the app's
/// writer never would: lowercase, and with secondary types after it.
pub fn tag_release_type_as_picard(path: &Path, value: &str) {
    let mut file = std::fs::File::open(path).expect("open fixture mp3");
    let mut mpeg = MpegFile::read_from(&mut file, ParseOptions::new()).expect("read fixture mp3");
    drop(file);
    let id3 = mpeg.id3v2_mut().expect("fixture mp3s carry ID3v2");
    id3.insert_user_text("MusicBrainz Album Type".to_owned(), value.to_owned());
    id3.save_to_path(path, WriteOptions::default())
        .expect("write tags");
}

/// An ID3v2.4 size: four bytes of seven bits each.
fn synchsafe(mut size: u32) -> [u8; 4] {
    let mut out = [0u8; 4];
    for byte in out.iter_mut().rev() {
        *byte = (size & 0x7F) as u8;
        size >>= 7;
    }
    out
}

/// One frame with `body` already encoded, unflagged.
fn raw_frame(id: &str, body: &[u8]) -> Vec<u8> {
    let mut frame = Vec::from(id.as_bytes());
    frame.extend_from_slice(&synchsafe(body.len() as u32));
    frame.extend_from_slice(&[0, 0]);
    frame.extend_from_slice(body);
    frame
}

/// One text frame, UTF-8 encoded.
fn text_frame(id: &str, value: &str) -> Vec<u8> {
    let mut body = vec![3u8];
    body.extend_from_slice(value.as_bytes());
    raw_frame(id, &body)
}

/// An mp3 carrying `frames` of ID3v2.4 in front of `audio_frames` of silence.
fn write_hand_built_mp3(path: &Path, audio_frames: usize, frames: &[Vec<u8>]) {
    let body = frames.concat();
    let mut bytes = Vec::from(&b"ID3"[..]);
    bytes.extend_from_slice(&[4, 0, 0]);
    bytes.extend_from_slice(&synchsafe(body.len() as u32));
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(&silent_mp3(audio_frames));

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).expect("create fixture dir");
    }
    std::fs::write(path, bytes).expect("write fixture mp3");
}

/// An mp3 whose date frame lofty will read but refuse to write back.
///
/// Hand-built because no lofty call can produce one: an out-of-range month or
/// day is accepted on the way in and rejected on the way out, which is what
/// leaves such a file - and real taggers do emit them - permanently
/// un-editable. `id` is `TDRC` or `TDOR`.
pub fn write_mp3_with_unwritable_date(
    path: &Path,
    frames: usize,
    title: &str,
    id: &str,
    date: &str,
) {
    write_hand_built_mp3(
        path,
        frames,
        &[text_frame("TIT2", title), text_frame(id, date)],
    );
}

/// An mp3 whose `COMM` frame declares `language`, whatever those three bytes
/// are.
///
/// Hand-built for the same reason as [`write_mp3_with_unwritable_date`]:
/// `LanguageFrame::parse` takes the bytes as they come and only the encoder
/// insists they be ASCII letters, so the ones that matter here - `\0\0\xB0` is
/// what the wild produced - are exactly the ones no lofty call would write.
pub fn write_mp3_with_comment_language(
    path: &Path,
    frames: usize,
    title: &str,
    language: [u8; 3],
    comment: &str,
) {
    // Encoding, language, an empty description terminated by its null, then
    // the text: the COMM layout of ID3v2.4 section 4.10.
    let mut body = vec![3u8];
    body.extend_from_slice(&language);
    body.push(0);
    body.extend_from_slice(comment.as_bytes());

    write_hand_built_mp3(
        path,
        frames,
        &[text_frame("TIT2", title), raw_frame("COMM", &body)],
    );
}

/// The language declared by the first `COMM` frame of the mp3 at `path`.
pub fn comment_language(path: &Path) -> [u8; 3] {
    let mut file = std::fs::File::open(path).expect("open mp3");
    let mpeg = MpegFile::read_from(&mut file, ParseOptions::new()).expect("read mp3");
    let language = mpeg
        .id3v2()
        .expect("an ID3v2 tag")
        .comments()
        .next()
        .expect("a COMM frame")
        .language;
    language
}

/// `count` interchangeable mp3s under `root/bulk`, for the tests whose subject
/// is the size of a batch rather than what is in it.
///
/// Ten frames apiece: real enough to scan and to rewrite, small enough that a
/// few hundred of them cost a few hundred kilobytes of temp directory.
pub fn bulk(root: &Path, count: usize) -> Vec<PathBuf> {
    (0..count)
        .map(|index| {
            let path = root.join(format!("bulk/{index:04}.mp3"));
            write_mp3(
                &path,
                10,
                &Meta {
                    title: Some(BULK_TITLE),
                    artist: Some(BULK_TITLE),
                    ..Default::default()
                },
            );
            path
        })
        .collect()
}

/// What every file `bulk` writes is titled, so a test can ask for the batch
/// back out of the library by name.
pub const BULK_TITLE: &str = "Bulk";

/// The MusicBrainz ids on the Shields tracks, so a test can assert a scan
/// read what the files carry rather than only what a write put there.
pub const SHIELDS_RELEASE: &str = "3c1a1cb0-2f1c-4c3e-9b6c-6b1e7b0f0001";
pub const SHIELDS_RELEASE_GROUP: &str = "3c1a1cb0-2f1c-4c3e-9b6c-6b1e7b0f0002";

/// A small library: two artists, three albums, one untagged file.
pub fn library(root: &Path) -> Vec<PathBuf> {
    const COVER_A: &[u8] = b"cover-bytes-for-tokyo";
    const COVER_B: &[u8] = b"cover-bytes-for-shields";

    let files: Vec<(PathBuf, usize, Meta)> = vec![
        (
            root.join("Guitar/Tokyo/01 Maki.mp3"),
            40,
            Meta {
                title: Some("Maki"),
                artist: Some("Guitar"),
                album: Some("Tokyo"),
                album_artist: Some("Guitar"),
                genre: Some("Post Shoegaze"),
                year: Some("2012"),
                track_no: Some(1),
                comment: Some("first"),
                cover: Some(COVER_A),
                ..Default::default()
            },
        ),
        (
            root.join("Guitar/Tokyo/02 Sakura Coming.mp3"),
            60,
            Meta {
                title: Some("Sakura Coming"),
                artist: Some("Guitar"),
                album: Some("Tokyo"),
                album_artist: Some("Guitar"),
                genre: Some("Post Shoegaze"),
                year: Some("2012"),
                track_no: Some(2),
                // Same bytes as the track above: must store one cover row.
                cover: Some(COVER_A),
                ..Default::default()
            },
        ),
        (
            root.join("Grizzly Bear/Shields/01 Sleeping Ute.mp3"),
            80,
            Meta {
                title: Some("Sleeping Ute"),
                artist: Some("Grizzly Bear"),
                album: Some("Shields"),
                album_artist: Some("Grizzly Bear"),
                genre: Some("Indie Rock"),
                year: Some("2012-09-18"),
                track_no: Some(1),
                release_mbid: Some(SHIELDS_RELEASE),
                release_group_mbid: Some(SHIELDS_RELEASE_GROUP),
                cover: Some(COVER_B),
                ..Default::default()
            },
        ),
        (
            root.join("Grizzly Bear/Painted Ruins/01 Wasted Acres.mp3"),
            50,
            Meta {
                title: Some("Wasted Acres"),
                artist: Some("Grizzly Bear"),
                album: Some("Painted Ruins"),
                album_artist: Some("Grizzly Bear"),
                genre: Some("Indie Rock"),
                year: Some("2017"),
                track_no: Some(1),
                ..Default::default()
            },
        ),
        // No tags at all - has to survive the scan and land as NULLs.
        (root.join("loose/untagged.mp3"), 30, Meta::default()),
    ];

    let mut paths = Vec::new();
    for (path, frames, meta) in &files {
        write_mp3(path, *frames, meta);
        paths.push(path.clone());
    }

    // Non-audio files that must be ignored entirely.
    std::fs::write(root.join("Guitar/Tokyo/folder.jpg"), b"not audio").unwrap();
    std::fs::write(root.join("notes.txt"), b"not audio").unwrap();

    paths
}
