# 204 — A bad tag item does not hide the file

All 141 `scan.unreadable` files. Each fails on one item lofty 0.25.4 can't
parse, and that fails the whole file in every `ParsingMode`. Upstream has
nothing newer, and #685 (the APE case) is open with no reply.

**APE (37 files, seven albums).** The values are Latin-1
(`Les Cr\xE9ations Clandestines`). `ape/tag/read.rs:50-58` decodes them as
UTF-8, and the error propagates through `mpeg/read.rs:173`. Every sampled file
also starts with an ID3v2.3 tag, which is the primary tag the app reads.

```
failed to parse Mpeg file <- failed to parse Ape tag <- failed to parse APE tag item 'Publisher'
  <- failed to decode UTF-8 sequence <- invalid utf-8 sequence of 1 bytes from index 6
```

**ID3v2 frames (104 files).** Only header errors are skipped outside Strict
(`frame/read.rs:47-57`), and a content error fails the tag (`:269-284`).

| Cause | Frames | Files | Bytes |
|---|---|---|---|
| UTF-16 odd length | TALB, TIT2, TLAN, TCOM, TPE3, TLEN | 44 | a real value plus a stray `00`; garbage `01 FF FE FE`; unsynchronised bytes with no unsync flag |
| invalid BOM | COMM | 18 | BOM plus UTF-16 "eng" written where the language goes |
| lone surrogate | TOPE | 1 | junk |
| failed to fill whole buffer | APIC, POPM, RVA2 | 17 | truncated picture; garbage; an RVAD body under an RVA2 id |
| unexpected character | TDRC | 24 | v2.3 `TYER` = `"2014\0" "2014"`, upgraded to TDRC |

## Shape

An app-side `Read + Seek` view over the file, used only after a plain read
fails, so a healthy file costs nothing. The read goes through
`Probe::with_file_type(view, FileType::from_path(path))`. The view is used in
three places: `tags::read`, `tags::musicbrainz_tags` and the write probe
(`write.rs:434`, over the temp copy). Without the probe, every edit of a
recovered file fails at `stage=probe`.

- **APE.** The view splices the APE tag out of the stream when it fails a trial
  parse. Its footer sits 32 bytes before ID3v1 and carries the tag's size and
  whether a header precedes it. The whole range goes, not just the preamble.
  Otherwise `last_frame_offset` covers the APE body and the duration is off.
  Not looked for behind Lyrics3v2: lofty never matches that marker
  (`id3/mod.rs:96`), so such an APE tag is never read and cannot fail one.
- **ID3v2**, every leading tag, since lofty merges them.
  - The app walks the frame headers itself. Sizes are syncsafe in v2.4 and
    plain in v2.3.
  - Each frame is trial-parsed: one frame in an in-memory mp3 (a tag header
    of the same version, the frame and a silent MPEG frame) through `Probe`.
  - The view leaves out the frames that fail and rewrites the tag size.
  - The raw bodies are kept, and `save_tag` puts them back as
    `Frame::Binary(BinaryFrame::new(id, body))`, so a save loses nothing.
    Kept Binary, they also avoid the frame that decodes but won't encode
    (105). A v2.3 id is upgraded with `upgrade_v3`, since the save writes
    v2.4.
  - A kept frame is dropped when the edit changed that id's frames (the tag
    before and after `mutate`, both as `Id3v2Tag`), so an edited TIT2 doesn't
    sit beside the old one, a cleared field stays clear, and a refused COMM
    survives beside a readable one. By id because `FrameList::insert`
    compares whole frames.
- **Salvage**, as byte fixes in the view:
  - drop the stray trailing `00` of an odd-length UTF-16 value;
  - cut `TYER`/`TDRC` at the first NUL.
  The value is then typed, and the next save writes it clean.
- **Give up**, leaving the file unreadable as today, on tag-level
  unsynchronisation, an extended header, v2.2, or a refused frame with a
  format flag (compressed, encrypted, unsynchronised, grouped, data length
  indicator). Their raw bytes don't round-trip as a plain `BinaryFrame`. Also
  when the read through the view still fails.
- The save rewrites only the ID3v2 region, so the APE tag and everything
  after the first tag stay byte for byte.
- Log what the view hid, from the scan: `tags.salvaged path= ape=1
  frames=TIT2,APIC fixed=TYER`. The scan's callback takes a `scan::Remark`
  for this and `scan.unreadable`.
- The record in `unreadable_files` carries the app version (194), so the
  release with this reads the 141 files again by itself.
- Tests: one fixture per table row plus a Latin-1 APE item. Each is read,
  saved with an edit, and read back. The kept frames' bytes must survive.
  The scan tests' unreadable fixture becomes a bare-URL `WXXX` with the
  grouping flag, since the plain one is now salvaged.
- Drop the view once lofty fixes #685 and the frame-content case.
