//! Builds real, parseable mp3 files for the integration tests.
//!
//! Generated rather than committed: no encoder dependency, no binary blobs in
//! git, and no question about the licensing of the audio.

// Compiled separately into each integration test that includes it, and no one
// test uses all of it.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use lofty::config::WriteOptions;
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

    tag.save_to_path(path, WriteOptions::default())
        .expect("write tags");
}

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
