# 51 — Drop an image onto the artwork square

Dropping a JPEG or PNG onto the cover - or onto the placeholder from
[phase 50](50-tag-editor-artwork-block.md) - should set it as the
replacement, the same state `Choose Artwork…` produces.

The obstacle is that the editor's cover travels as a **path**:
`CoverEdit::Replace { path }`, which `tags/write.rs`'s `read_cover` opens with
`std::fs::read`. A drop into the page is an HTML5 `drop` and hands over a `File`
- bytes, no path, on Windows and in Tauri v2 generally. The native drag-drop
event that would carry paths is unavailable: `dragDropEnabled` must stay
`false` or in-app dragging stops working at all, and it cannot be toggled at
runtime. See [gotchas](../knowledge/gotchas.md) and
[limitations](../knowledge/limitations.md).

So this needs a bytes route:

- A second variant, `CoverEdit::Replace`-by-bytes, sharing `read_cover`'s size
  cap and magic-byte sniff. The sniff is the reason not to trust the drop's
  `File.type`, which comes from the extension.
- Base64 over IPC for something up to `MAX_COVER_BYTES` is the part to size
  before committing to it.

Rejecting a drop needs to say why - wrong format, too large - and the editor's
error line is where the numeric-field problems already go.

Accept only files. `hasTrackIds` guards the row drags; a song dragged from the
table is not artwork.
