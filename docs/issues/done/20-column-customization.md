# 20 — Column customization

Merged in #30. The other half of what phase 3's entry claimed and did not build.

- **Click sorts, drag reorders, separated by four pixels.** They share one
  pointer press, so a mode would be the alternative and a mode is worse. Above
  the threshold the following `click` is swallowed — `pointerup` fires first, and
  otherwise every reorder would also sort by whatever it was dropped on.
- Dropping is measured against header midpoints with the dragged column excluded
  from the count; including its own width means a wide column never lands where
  the pointer is.
- Resizing commits once, on release. Live width is local state.
- **Hiding the last column is refused** — an empty table has no headers, so no
  header menu, so no way back.
- **Hiding the sorted column moves the sort** to the first visible one and
  re-queries. `relevance` and `position` are exempt; they have no header anyway.
- **Per view.** `playlists.columns_json` had existed unwritten since migration 1.
  A playlist with no layout inherits the library's, so `None` stays
  distinguishable from "configured to show nothing".
- **The stored layout is opaque to Rust** — which columns exist is a frontend
  fact. `parseColumnConfig` assumes nothing: unknown ids dropped, duplicates
  collapsed, unusable widths ignored, anything unparseable falls back to a working
  table.
- Not added to the settings export allowlist: local chrome, and omission is the
  safe direction.
- **jsdom has no `PointerEvent`**, so `fireEvent.pointerMove(el, {clientX})`
  delivered `null` and every pointer-driven component looked broken while being
  correct in a browser. The test setup now installs a `MouseEvent` subclass.
