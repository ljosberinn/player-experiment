# 144 — A tag write corrupts the artwork

Writing the MusicBrainz cover to *Du hast mich schon verstanden* (Prezident,
2018) leaves every track showing a flat gray square with a red and green
streak along its top edge. The review dialog previewed the cover correctly.

## Cause

The file's ID3v2 header has the **unsynchronisation** flag set (flags byte
`0x80`). lofty 0.25.1 keeps that flag and writes it back, but writes every frame
body raw.

1. When lofty reads the tag, the header flags go into the companion tag. They
   survive the split to a generic `Tag`, and `Id3v2Tag::from(tag)` in
   `write::save_tag` puts them back.
2. `create_tag_header` writes `flags.as_id3v24_byte()`, which includes `0x80`
   (`lofty/src/id3/v2/header.rs:61`). No frame body is unsynchronised on the way
   out.
3. When the tag is read back, a v2.4 tag with the flag set marks every frame
   unsynchronised (`lofty/src/id3/v2/frame/read.rs:67`), so the reader drops
   each `00` that follows an `FF`.
4. JPEG entropy data escapes every `FF` byte as `FF 00`. With those `00` bytes
   gone, the decoder loses sync after a few rows. Everything below them is
   gray.
5. The rescan stores what it decoded: `covers.normalize` re-encodes the gray
   picture, and the library draws that from then on.

The preview was right because it reads the staged `chosen-cover.jpg` over
`cover://`, and no tag is involved.

Frames carry the same fault one level down. The per-frame unsync bit (`0x0002`)
on carried frames is written back as it was read, and those frames are also
written raw.

## Evidence

From `01 - Kein Song Gegen Pegida.mp3`, after the write:

| | |
| --- | --- |
| Header | `ID3` v2.4.0, flags `0x80`, tag size 63,050 |
| APIC payload | 60,533 B, byte-identical to `coverartarchive.org/release/0fa224a5-803c-406a-be40-d74014f43a90/front-500` and to the staged `chosen-cover.jpg` |
| `FF 00` pairs in the JPEG | 443, and the reader strips every one |
| Carried TXXX frames | 19 with frame flags `0x0002`; the frames lofty rebuilt have `0x0000` |
| `covers` row `899a2f5f…` | 9,532 B JPEG, palette gray `127,127,127`, green `16,135,16`, red `195,42,39` |

The source image is a valid baseline JPEG: 500×500, SOF0, ends in EOI.

## Scope

- Any save to a file with this flag damages whatever art it has, not only a
  cover replacement: lofty reads the existing APIC correctly, then writes it
  back raw under the same flag.
- Only when the tag also has a frame lofty keeps out of the generic `Tag`
  (TXXX, PRIV, …). Without one there is no companion tag, and
  `Id3v2Tag::from` starts from default flags (`lofty/src/id3/v2/tag.rs:986`).
- It depends on the file, not the release. The flag comes from whatever tagged
  the file before the app did.
- Tag types other than ID3v2 are not affected.
- In the library as of 2026-09-23, 14 of 65,692 mp3s have the flag, all of
  them v2.4:

  | Files | Folder |
  | --- | --- |
  | 10 | `Prezident\Du Hast Mich Schon Verstanden - 2018 - Album` |
  | 3 | `Ganja Hitler\Einen Sieg erringen durch das Marihuana - 0000 - Album` |
  | 1 | `Tibetan Monks\Unknown Release - 0000 - Album` |

## Fix

`drop_unsynchronisation` in `save_tag`, after `Id3v2Tag::from(tag)`, clears
`unsynchronisation` on the tag flags and on every frame's `FrameFlags`.

Dropping the flags is always correct. lofty never unsynchronises on write, so
no frame it writes is unsynchronised. Unsynchronisation exists for decoders
that predate ID3v2 and has no other use.

The same family as the unwritable dates of [100](../done/100-why-a-tag-write-failed.md)
and the languages of [105](../done/105-a-comment-lofty-will-not-write-back.md):
lofty accepts a value on read that it cannot write back correctly. Unfixed in
0.25.4 and on upstream `main` as of 2026-09-25; not yet reported upstream.

## Repair

No migration is needed. Once the fix is in, writing the cover again to an
affected release replaces the damaged APIC. Its bytes hash differently, so the
rescan stores a new `covers` row, and `collect_orphans` removes the gray one.

Art that was already on a flagged file before a metadata-only write is lost,
and nothing in the file can recover it. Writing a cover is the only way back.

## Tests

In `tests/tagwrite.rs`, on `fixture::write_unsynchronised_mp3` (v2.4, header
flags `0x80`, a TXXX with frame flag `0x0002`):

- A cover containing `FF 00` is written and reads back byte-identical.
- With an APIC already on the file, a genre edit leaves the picture
  byte-identical.
- After either write, neither the header nor any frame claims
  unsynchronisation.

## Verification

- Write the MusicBrainz cover to *Du hast mich schon verstanden* again. The
  browse tile and the tag editor show the red Prezident cover.
- Another player (foobar2000, or Explorer's thumbnail) shows the same cover
  from the file.
