# 202 — Junk before the audio does not refuse a save

```
err tags.write.fail path=D:\Library\Peste Noire\Macabre Transcendance... - 2002 - EP\03 - 666 Millions D'Esclaves Et De Déchets.mp3
  stage=save size=11101627 tag=Id3v2/primary
  cause=failed to parse file <- no format could be determined from the provided file
  os=- temp=11101627 frames=12 pics=1 picbytes=64841 dates=TDRC=2002
```

Fails on every attempt. Reproduced against a copy with lofty 0.25.4.

After the first ID3v2 tag the file holds 1,515 bytes of ASCII (a track listing
from an mp3 joiner) and then a second 256-byte ID3v2 tag. The first frame
sync is 1,771 bytes past the end of the first tag.

- The read (`Probe::open`) takes the type from the `.mp3` extension, and
  `find_next_frame` searches without a limit, so the read works.
- The save sniffs the content. `TagExt::save_to` calls `VerifiedFile::new`,
  which ignores the extension, and `check_mpeg_or_aac` searches only
  `max_junk_bytes` (1,024 by default) past the first tag. The second tag
  counts as junk. No frame turns up, so the save is refused before anything
  is written.
- No lofty save takes a known type, because `VerifiedFile` is `pub(crate)`.
  The junk window is the only lever.
- `drop_stacked_tags` doesn't apply, because the two tags are not back to
  back.

## Shape

- One const of 16 KiB for the window, passed by both saves in `save_tag`
  (`write.rs:651`, `:687`):
  `WriteOptions::default().parse_options(ParseOptions::new().max_junk_bytes(N))`.
  4 KiB was enough for the reproduced file. Keep N bounded, for two reasons:
  - `search_for_frame_sync` and `find_id3v2_in_junk` read the unbuffered
    `File` one byte per syscall. On an untagged file, `find_id3v2_in_junk`
    scans all N bytes.
  - A chance `ID3` inside the window of an untagged file becomes the range
    the save replaces.
- The save replaces only the first tag, so the junk and the second tag stay
  byte for byte. Every later save needs the same window.
- `VerifiedFile::new` honours the options only since lofty 0.25.3, so the
  `Cargo.toml` floor is `0.25.3`, and the gotcha that said the sniff never
  sees them is rewritten.
- `drop_stacked_tags`'s doc comment says "over 1,024 bytes". Point it at the
  const instead.
- `temp_beside`'s doc comment and its test (`write.rs:706-708`, `:925-926`)
  say lofty picks its writer from the extension. Only the read at
  `write.rs:434` uses the extension; the save sniffs.
- A test: a fixture in `tests/fixture/mod.rs` with more than 1,024 bytes of
  junk and a second tag before the first frame, saved twice through
  `write::apply_to_each` and read back. Assert that the bytes after the first
  tag are unchanged.
