//! Reading a file lofty refuses over one tag item.
//!
//! lofty 0.25 fails the whole file, in every `ParsingMode`, on an APE item
//! that is not UTF-8 (lofty-rs#685) and on an ID3v2 frame whose content does
//! not parse. [`read`] goes through a view of the file with those left out,
//! and hands back what it left out so a save can put it back. Drop it once
//! lofty skips both.

use std::fs::File;
use std::io::{self, BufReader, Cursor, Read, Seek, SeekFrom};
use std::ops::Range;
use std::path::Path;

use lofty::config::ParseOptions;
use lofty::file::{FileType, TaggedFile};
use lofty::id3::v2::{upgrade_v3, BinaryFrame, Frame, FrameId};
use lofty::probe::Probe;

use super::write::tag_len;

/// What a read through the view left out or changed, for the log.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Salvaged {
    /// The APE tag, all of it.
    pub ape: bool,
    pub hidden: Vec<String>,
    /// Read after one of [`FIXES`].
    pub fixed: Vec<String>,
}

impl Salvaged {
    fn is_empty(&self) -> bool {
        !self.ape && self.hidden.is_empty() && self.fixed.is_empty()
    }
}

pub struct Salvage {
    pub salvaged: Salvaged,
    /// The hidden frames as raw ID3v2.4 frames, for a save to write back.
    pub kept: Vec<Frame<'static>>,
}

/// Reads `path` through the view, or `None` when the view changes nothing or
/// lofty refuses it too.
pub fn read(path: &Path, options: ParseOptions) -> Option<(TaggedFile, Salvage)> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let mut salvage = Salvage {
        salvaged: Salvaged::default(),
        kept: Vec::new(),
    };
    let mut parts = Vec::new();

    // Every leading tag, since lofty merges them all.
    let mut at = 0;
    while let Some(tag) = leading_tag(&mut file, at, len) {
        let end = at + tag.len() as u64;
        match repair(&tag) {
            Some(repaired) => {
                salvage.salvaged.hidden.extend(repaired.hidden);
                salvage.salvaged.fixed.extend(repaired.fixed);
                salvage.kept.extend(repaired.kept);
                parts.push(Part::Bytes(repaired.tag));
            }
            None => parts.push(Part::File(at..end)),
        }
        at = end;
    }

    match ape_range(&mut file, at, len) {
        Some(ape) if !ape_parses(&mut file, &ape) => {
            salvage.salvaged.ape = true;
            parts.push(Part::File(at..ape.start));
            parts.push(Part::File(ape.end..len));
        }
        _ => parts.push(Part::File(at..len)),
    }

    if salvage.salvaged.is_empty() {
        return None;
    }
    let view = View::new(file, parts);
    let tagged = Probe::with_file_type(BufReader::new(view), FileType::from_path(path)?)
        .options(options)
        .read()
        .ok()?;
    Some((tagged, salvage))
}

/// The ID3v2 tag at `at`, footer included, if one starts there.
fn leading_tag(file: &mut File, at: u64, len: u64) -> Option<Vec<u8>> {
    let mut header = [0u8; 10];
    file.seek(SeekFrom::Start(at)).ok()?;
    file.read_exact(&mut header).ok()?;
    let size = tag_len(&header)?;
    if at + size > len {
        return None;
    }
    let mut tag = vec![0u8; size as usize];
    file.seek(SeekFrom::Start(at)).ok()?;
    file.read_exact(&mut tag).ok()?;
    Some(tag)
}

/// A tag rewritten without the frames lofty refuses.
struct Repaired {
    tag: Vec<u8>,
    hidden: Vec<String>,
    fixed: Vec<String>,
    kept: Vec<Frame<'static>>,
}

/// The frame flags that put bytes ahead of the content or change it, by
/// version: ID3v2.3 3.3.1 and ID3v2.4 4.1.2.
const FORMAT_FLAGS_V3: u16 = 0x00E0;
const FORMAT_FLAGS_V4: u16 = 0x004F;

/// `tag` without the frames that fail it, or `None` when it parses as it is or
/// cannot be rewritten.
///
/// Gives up on what a frame's raw bytes do not survive being moved under: a
/// tag-wide unsynchronisation, an extended header, ID3v2.2's frame layout, and
/// a refused frame whose flags change its bytes.
fn repair(tag: &[u8]) -> Option<Repaired> {
    let version = tag[3];
    let flags = tag[5];
    if version < 3 || flags & 0xC0 != 0 || parses(tag) {
        return None;
    }
    let (synchsafe, format_flags) = if version == 4 {
        (true, FORMAT_FLAGS_V4)
    } else {
        (false, FORMAT_FLAGS_V3)
    };

    let body = &tag[10..10 + size(&tag[6..10], true) as usize];
    let mut repaired = Repaired {
        tag: Vec::new(),
        hidden: Vec::new(),
        fixed: Vec::new(),
        kept: Vec::new(),
    };
    let mut frames = Vec::new();
    let mut at = 0;
    while at + 10 <= body.len() && body[at] != 0 {
        let header = &body[at..at + 10];
        let id = std::str::from_utf8(&header[..4]).ok()?;
        if !id
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            return None;
        }
        let content_len = size(&header[4..8], synchsafe) as usize;
        let frame_flags = u16::from_be_bytes([header[8], header[9]]);
        // A frame that runs past the tag is the last one: what is there of it
        // is all there is to keep.
        let end = (at + 10 + content_len).min(body.len());
        let content = &body[at + 10..end];
        at = end;

        let frame = raw_frame(header, content, synchsafe);
        if parses(&with_header(tag, &frame)) {
            frames.extend(frame);
            continue;
        }
        if frame_flags & format_flags != 0 {
            return None;
        }
        let fixed = FIXES.iter().find_map(|fix| {
            let content = fix(id, content)?;
            let frame = raw_frame(header, &content, synchsafe);
            parses(&with_header(tag, &frame)).then_some(frame)
        });
        match fixed {
            Some(frame) => {
                frames.extend(frame);
                repaired.fixed.push(id.to_owned());
            }
            None => {
                let upgraded = if synchsafe { None } else { upgrade_v3(id) };
                let kept_id = FrameId::new(upgraded.unwrap_or(id).to_owned()).ok()?;
                repaired.hidden.push(id.to_owned());
                repaired
                    .kept
                    .push(Frame::Binary(BinaryFrame::new(kept_id, content.to_vec())));
            }
        }
    }

    if repaired.hidden.is_empty() && repaired.fixed.is_empty() {
        return None;
    }
    // The footer goes: it repeats a header that no longer holds.
    repaired.tag = with_header(tag, &frames);
    repaired.tag[5] &= !0x10;
    Some(repaired)
}

/// An ID3v2 size: synchsafe as lofty reads it, masking rather than refusing a
/// set high bit, or plain for an ID3v2.3 frame.
fn size(bytes: &[u8], synchsafe: bool) -> u32 {
    let raw = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    if !synchsafe {
        return raw;
    }
    ((raw & 0x7F00_0000) >> 3) | ((raw & 0x7F_0000) >> 2) | ((raw & 0x7F00) >> 1) | (raw & 0x7F)
}

fn encode_size(size: usize, synchsafe: bool) -> [u8; 4] {
    let size = size as u32;
    if !synchsafe {
        return size.to_be_bytes();
    }
    [
        ((size >> 21) & 0x7F) as u8,
        ((size >> 14) & 0x7F) as u8,
        ((size >> 7) & 0x7F) as u8,
        (size & 0x7F) as u8,
    ]
}

/// `header`'s frame around `content`, with the size it now has.
fn raw_frame(header: &[u8], content: &[u8], synchsafe: bool) -> Vec<u8> {
    let mut frame = header[..4].to_vec();
    frame.extend(encode_size(content.len(), synchsafe));
    frame.extend(&header[8..10]);
    frame.extend(content);
    frame
}

/// A tag of `frames` under `tag`'s header.
fn with_header(tag: &[u8], frames: &[u8]) -> Vec<u8> {
    let mut out = tag[..6].to_vec();
    out[5] &= !0x10;
    out.extend(encode_size(frames.len(), true));
    out.extend(frames);
    out
}

/// Whether lofty reads `tag` at the start of an mp3.
fn parses(tag: &[u8]) -> bool {
    let mut mp3 = tag.to_vec();
    mp3.extend(silent_frame());
    mpeg_parses(mp3)
}

/// Whether lofty reads an mp3 of these bytes, under the options every read
/// shares.
fn mpeg_parses(mp3: Vec<u8>) -> bool {
    Probe::with_file_type(Cursor::new(mp3), FileType::Mpeg)
        .options(ParseOptions::new().read_properties(false))
        .read()
        .is_ok()
}

/// One frame of silent MPEG-1 Layer III, so a probe has audio to find.
fn silent_frame() -> Vec<u8> {
    let mut frame = vec![0xFF, 0xFB, 0x90, 0xC0];
    frame.resize(417, 0);
    frame
}

/// Byte fixes for the frames taggers get wrong the same way, tried in order on
/// a frame lofty refuses. Each returns new content, or `None` when it does not
/// apply.
type Fix = fn(&str, &[u8]) -> Option<Vec<u8>>;
const FIXES: [Fix; 2] = [stray_utf16_byte, year_past_nul];

/// UTF-16 text with one byte too many, a `00` after the value.
fn stray_utf16_byte(id: &str, content: &[u8]) -> Option<Vec<u8>> {
    let utf16 = matches!(content.first(), Some(1 | 2));
    // The encoding byte is one, so an odd run of text makes an even frame.
    let odd_text = content.len().is_multiple_of(2);
    (id.starts_with('T') && id != "TXXX" && utf16 && odd_text && content.last() == Some(&0))
        .then(|| content[..content.len() - 1].to_vec())
}

/// A year with something after a NUL, as in a v2.3 `TYER` of `2014\02014`.
fn year_past_nul(id: &str, content: &[u8]) -> Option<Vec<u8>> {
    if id != "TYER" && id != "TDRC" {
        return None;
    }
    let (&encoding, text) = content.split_first()?;
    let cut = if matches!(encoding, 1 | 2) {
        text.as_chunks::<2>()
            .0
            .iter()
            .position(|unit| unit == &[0, 0])?
            * 2
    } else {
        text.iter().position(|&byte| byte == 0)?
    };
    let mut fixed = vec![encoding];
    fixed.extend(&text[..cut]);
    Some(fixed)
}

/// Where the APE tag ahead of an ID3v1 tag lies, header included, when there
/// is one after `audio_start`.
///
/// Lyrics3v2 is not looked behind: lofty 0.25 never matches its marker
/// (`id3/mod.rs`, a 9-byte literal against an 8-byte slice), so an APE tag
/// behind one is never read and cannot fail a read.
fn ape_range(file: &mut File, audio_start: u64, len: u64) -> Option<Range<u64>> {
    let mut end = len;
    if len >= 128 {
        let mut marker = [0u8; 3];
        file.seek(SeekFrom::Start(len - 128)).ok()?;
        file.read_exact(&mut marker).ok()?;
        if &marker == b"TAG" {
            end -= 128;
        }
    }

    let mut footer = [0u8; 32];
    file.seek(SeekFrom::Start(end.checked_sub(32)?)).ok()?;
    file.read_exact(&mut footer).ok()?;
    if &footer[..8] != b"APETAGEX" {
        return None;
    }
    let field = |at: usize| u32::from_le_bytes(footer[at..at + 4].try_into().unwrap());
    // The size covers the items and the footer; the header is separate.
    let header = if field(20) & 0x8000_0000 != 0 { 32 } else { 0 };
    let start = end.checked_sub(u64::from(field(12)) + header)?;
    (start >= audio_start).then_some(start..end)
}

/// Whether lofty reads the APE tag at `range` at the end of an mp3.
fn ape_parses(file: &mut File, range: &Range<u64>) -> bool {
    let mut mp3 = silent_frame();
    let audio = mp3.len();
    mp3.resize(audio + (range.end - range.start) as usize, 0);
    let read = file
        .seek(SeekFrom::Start(range.start))
        .and_then(|_| file.read_exact(&mut mp3[audio..]));
    // A tag that cannot be read here is no tag to hide.
    read.is_err() || mpeg_parses(mp3)
}

enum Part {
    File(Range<u64>),
    Bytes(Vec<u8>),
}

impl Part {
    fn len(&self) -> u64 {
        match self {
            Part::File(range) => range.end - range.start,
            Part::Bytes(bytes) => bytes.len() as u64,
        }
    }
}

/// The file as a run of its own ranges and replacement bytes, so the audio is
/// never copied.
struct View {
    file: File,
    parts: Vec<Part>,
    len: u64,
    pos: u64,
}

impl View {
    fn new(file: File, parts: Vec<Part>) -> Self {
        let len = parts.iter().map(Part::len).sum();
        Self {
            file,
            parts,
            len,
            pos: 0,
        }
    }
}

impl Read for View {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut start = 0;
        for part in &self.parts {
            let len = part.len();
            if self.pos < start + len {
                let within = self.pos - start;
                let max = buf.len().min((len - within) as usize);
                let read = match part {
                    Part::Bytes(bytes) => {
                        let within = within as usize;
                        buf[..max].copy_from_slice(&bytes[within..within + max]);
                        max
                    }
                    Part::File(range) => {
                        self.file.seek(SeekFrom::Start(range.start + within))?;
                        self.file.read(&mut buf[..max])?
                    }
                };
                self.pos += read as u64;
                return Ok(read);
            }
            start += len;
        }
        Ok(0)
    }
}

impl Seek for View {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let target = match pos {
            SeekFrom::Start(offset) => Some(offset),
            SeekFrom::End(delta) => self.len.checked_add_signed(delta),
            SeekFrom::Current(delta) => self.pos.checked_add_signed(delta),
        };
        self.pos = target
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "seek before the start"))?;
        Ok(self.pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_round_trip_in_both_encodings() {
        for size_value in [0, 127, 128, 0x0FFF_FFFF] {
            assert_eq!(
                size(&encode_size(size_value, true), true),
                size_value as u32
            );
            assert_eq!(
                size(&encode_size(size_value, false), false),
                size_value as u32
            );
        }
    }

    #[test]
    fn a_stray_byte_goes_only_from_utf16_text() {
        assert_eq!(
            stray_utf16_byte("TALB", &[1, 0xFF, 0xFE, b'a', 0, 0]),
            Some(vec![1, 0xFF, 0xFE, b'a', 0])
        );
        assert_eq!(stray_utf16_byte("TALB", &[3, b'a', 0]), None, "UTF-8");
        assert_eq!(
            stray_utf16_byte("TALB", &[1, 0xFF, 0xFE, 0xFE]),
            None,
            "no 00"
        );
        assert_eq!(stray_utf16_byte("APIC", &[1, 0, 0, 0]), None, "not text");
    }

    #[test]
    fn a_year_ends_at_its_first_nul() {
        assert_eq!(
            year_past_nul("TYER", b"\x002014\x002014"),
            Some(b"\x002014".to_vec())
        );
        assert_eq!(
            year_past_nul("TYER", &[1, 0xFF, 0xFE, b'2', 0, 0, 0, b'2', 0]),
            Some(vec![1, 0xFF, 0xFE, b'2', 0])
        );
        assert_eq!(year_past_nul("TYER", b"\x002014"), None, "nothing to cut");
        assert_eq!(year_past_nul("TALB", b"\x00a\x00b"), None);
    }

    #[test]
    fn the_view_reads_and_seeks_across_its_parts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file");
        std::fs::write(&path, b"0123456789").unwrap();
        let file = File::open(&path).unwrap();
        let mut view = View::new(
            file,
            vec![
                Part::Bytes(b"ab".to_vec()),
                Part::File(2..4),
                Part::File(7..10),
            ],
        );

        let mut all = Vec::new();
        view.read_to_end(&mut all).unwrap();
        assert_eq!(all, b"ab23789");

        view.seek(SeekFrom::End(-2)).unwrap();
        let mut tail = [0u8; 2];
        view.read_exact(&mut tail).unwrap();
        assert_eq!(&tail, b"89");
        assert!(view.seek(SeekFrom::Current(-10)).is_err());
    }
}
