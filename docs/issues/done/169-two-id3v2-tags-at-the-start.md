# 169 — Two ID3v2 tags at the start of a file

Some mp3s have one ID3v2 tag followed directly by a second, then the audio. In
`D:\Library` that is 935 of 65,694 files. Two things went wrong when they were
edited:

- **Second tag over 1,024 bytes (668 files): every save was refused.**

  ```
  err tags.write.fail stage=save tag=Id3v2/primary temp=<size>
    cause=failed to parse file <- no format could be determined from the provided file
  ```

  `Probe::open` reads the format from the extension; `Id3v2Tag::save_to_path`
  builds a `VerifiedFile` (`util/io.rs:252`), which sniffs the content. It skips
  the first tag, then searches for a frame sync only through
  `DEFAULT_MAX_JUNK_BYTES` (1,024). The `ParseOptions` in `WriteOptions` never
  reach that sniff.
- **Second tag of 1,024 bytes or less (267 files): edits reverted.**
  `write_id3v2` replaces only the first tag, and the mpeg reader merges the
  second in with `FrameList::insert`, so the second tag's values win on the
  read-back.

## Fix

`write::drop_stacked_tags`, on the temp copy after the read and before
`save_tag`: when two or more ID3v2 tags sit back to back at the start (10 bytes
of header plus the size, plus 10 for a footer on v2.3/v2.4), cut them all off.
The tag handed to `save_tag` already holds the merged frames.

- Only when a file is written.
- One tag: the file is not touched.
- Anything else in front of the audio, including junk between two tags, is left
  to lofty.

## Tests

- `tests/tagwrite.rs`: a second tag over 1,024 bytes saves, one tag is left, and
  a frame only it held survives; a small second tag holding the edited field
  does not revert the edit.
- `write.rs` unit tests: `tag_len` per header, and `drop_stacked_tags` leaves a
  single tag and junk-separated tags byte for byte.
- [gotchas](../../knowledge/gotchas.md#tag-writing) entry.
