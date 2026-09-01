# 67 — Show the artwork that is about to be written

A chosen replacement shows only a caption; the square still holds what is on
the files. [Phase 51](51-drop-artwork-into-the-editor.md) left this out, and
dropping an image onto a square that does not change is the state it left
behind.

## Both routes stage, so both can be shown

The webview cannot read a path — the asset protocol is off — so what is
previewable is what the backend can serve. Phase 51 already stages a dropped
image; the picker does not, and a preview for one route only would make the two
look like different features.

- **`stage_picked_cover(path)`** beside `stage_dropped_cover`: reads the file,
  through the same `check_cover`, into the same staged file. The picker now
  refuses a 40 MB TIFF while the dialog is open rather than at save time, and
  `CoverEdit::Replace` carries the staged path whichever route chose it.
- **`cover://staged`** — the one path under that protocol that is not a hash.
  Served from the cache directory, `no-store`, since the name is fixed and its
  contents change. The version in the query string is what actually busts the
  webview's cache between two drops.

## The editor

`stagedCoverUrl(version)` and a counter bumped on each staged result. While a
replacement is pending the square shows it; the caption stays, because what the
save will do is not something a picture says.

A picked image can now be refused, so `onPickCover` may reject like
`onDropCover` — one path through both.
