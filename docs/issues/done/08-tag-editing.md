# 8 — Tag editing: atomic writer and undo journal

Merged in `571a4c2`.

- **Absent means "leave alone", empty means "clear"** on every `TagEdit` field.
  That is what makes a bulk edit over disagreeing tracks safe: fields showing
  "Mixed" stay absent and survive untouched.
- **A file is never edited in place.** Tags go onto a copy beside the original,
  which replaces it in one rename, so a crash leaves either the old file or the
  new one. The temp file keeps the original extension as a **prefixed** marker —
  lofty picks its writer from the extension, and `01 Maki.mp3.player-tmp` is not
  something it will write mp3 tags into. A test asserts the extension.
- Rows are re-read from the file afterwards, with `mtime` and `size`, so an
  incremental rescan finds nothing to do.
- One bad file does not undo the good ones; failures are counted, reported, and
  not journalled.
- **Undo is one level and is not itself undoable**, and it restores every field
  rather than only changed ones — an edit that added a value has to be cleared.
- Cover mime types are sniffed from the bytes, not the extension.
- The undo journal references cover art by hash, which is why `covers` is never
  pruned.
