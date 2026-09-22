# 124 — Letting FLAC into the library

`scan::AUDIO_EXTENSIONS` is `["mp3"]`, and the comment above it says widening
it "is the only change other formats need". That is wrong in two places and
silently wrong in a third.

## The decoder is not linked

`rodio` is `default-features = false, features = ["playback", "mp3"]`, and the
lock file carries `symphonia-bundle-mp3` and no other codec. A FLAC added
today would scan, tag, sort and appear in the library, and fail at
`audio::sink::decode` with `cannot decode` the moment it was played — a row
that looks identical to every other one and cannot be played.

Add `"flac"` to the feature list. Seeking is the part to check rather than
assume: `Player::get_pos` and the scrubber's seek go through symphonia, and a
FLAC with no seek table seeks by estimation.

## The tag writer assumes ID3v2, and FLAC does not refuse it

`write::write_one` falls back to `Tag::new(TagType::Id3v2)` for a file that
carries no tag at all. On a FLAC that does not error: lofty's `FlacFile` has
an `id3v2_tag` slot and `write_to` saves it (`flac/mod.rs`), so the write
succeeds and produces a FLAC with an ID3v2 tag in front of it. Apex reads it
back, because lofty reads it back, so nothing here looks wrong — and every
other player and tagger ignores it, because it is not where FLAC keeps tags.

**A silent success is the failure mode**, which is why this is the piece to do
first. The fallback has to come from the file's own type: `VorbisComments` for
FLAC, `Id3v2` for MPEG. `TaggedFile::file_type` is what decides, and
`FileType::primary_tag_type()` already answers it.

The rest of the writer is less bad than it reads:

- **`save_tag`'s early return is correct for FLAC.** The ID3 branch exists
  because lofty's `Tag` → `Id3v2Tag` conversion drops the two MusicBrainz ids
  and they have to be carried across as TXXX by description. Vorbis comments
  map both directly — `MUSICBRAINZ_ALBUMID` and `MUSICBRAINZ_RELEASEGROUPID`,
  `tag/item.rs` — so a generic `Tag::save_to_path` keeps them. **The hack does
  not need duplicating.** Assert that it does not, or it will be duplicated by
  the next person who reads only the comment.
- **`repair_languages` stays ID3-only.** It fixes the COMM language field,
  which Vorbis comments do not have.
- **`shape` reports ID3 frame ids** and is the diagnostic a refused save
  carries. On a FLAC it will describe nothing. Either widen it or say in
  `Fields` which tag kind was being written, so a FLAC failure is not reported
  in the vocabulary of a format it is not.
- **Cover art needs checking, not changing.** lofty puts every picture in the
  Vorbis tag when it converts a `FlacFile`, so `tag.pictures()` reads and
  `Tag::set_picture` writes, both through the path the editor already uses.

## The path budget shrinks

`layout::has_path_budget` sizes its `MAX_PATH` margin from the longest entry in
`AUDIO_EXTENSIONS`. `flac` is one UTF-16 unit longer than `mp3`, so a library
root accepted today can be rejected after the list widens — at the picker, in
Settings, on a root that already holds music. Decide whether that is acceptable
or whether the budget belongs per file rather than per library.

## What already adapts, and should be left alone

- **Reading is format-agnostic.** `tags::read` is `lofty::Probe` throughout:
  duration, bitrate, sample rate, every tag and the cover come back the same
  way for a FLAC.
- **The drill-in's gutter already names it.** `query::format_sql` generates its
  `CASE` arms from `AUDIO_EXTENSIONS`, so widening that list is the whole
  change — and a release half MP3 and half FLAC already reports no container,
  which [120](../done/120-grouped-releases.md) settled.
- `is_audio_file`, `release_identity`, the mover, the exporter and the smart
  playlist fields are all extension-agnostic already.

## What the schema does not hold

- **No bit depth.** 16-bit and 24-bit FLAC are the same row. Out of scope
  unless a column is wanted, but it is the one property a FLAC library is
  usually sorted on.
- **`tracks.bitrate` stays honest** — lofty reports a FLAC's average, around
  900 — but `stats::worst_by_bitrate` orders by it ascending, so in a mixed
  library every lossy release outranks every lossless one and the panel means
  "lossy" rather than "badly encoded". Decide whether it narrows by container
  or keeps the whole library and is renamed.

## The fixtures are the work with no shortcut

Both suites synthesize MPEG by hand and neither can be pointed at a FLAC:
`e2e/fixtures.ts` writes ID3v2.3 frames in front of silent frames, and
`src-tauri/tests/fixture/mod.rs` writes ID3v2.4 in front of 417-byte frames and
reads the result back with `MpegFile::read_from`. A FLAC needs a real
STREAMINFO block and at least one real subframe, which is not something to
assemble in a helper.

Commit one small real FLAC as a binary fixture and build the variants from it
with lofty, the way `tagwrite` already mutates its mp3s after writing them.
The variants that matter: no tag at all (the silent-ID3v2 case above), Vorbis
comments with both MusicBrainz ids, and one with a picture.

## Verification

- A FLAC scans, plays, seeks and scrubs.
- An untagged FLAC edited through the tag editor comes back carrying **Vorbis
  comments and no ID3v2 block**. This is the assertion the whole issue exists
  for, and it passes today for the wrong reason.
- A FLAC's MusicBrainz ids survive a write that never mentions them, the way
  the mp3 test asserts it — and `save_tag` still takes its generic branch.
- A lookup writes a FLAC's tags and its cover.
- A release of two FLACs and two MP3s reports no container in the drill-in
  gutter, and one of four FLACs reports `FLAC`.
- `has_path_budget` rejects the roots it should and no others.
- An MP3 library behaves exactly as it does now — every existing test still
  passes unchanged, which is what says the file type is being read rather than
  assumed in a new place.
