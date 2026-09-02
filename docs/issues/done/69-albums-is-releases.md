# 69 — Albums is Releases

The Library section's second item is called Albums. A release is what it holds:
an EP, a single, a split and a compilation are all in there, and none of them is
an album.

**Label only.** `BrowseKind` is the IPC wire type and `"albums"` reaches the
browse query, the navigation history and the remembered scroll offset. Renaming
the identifier churns all of that for a word nobody reads. The Rust
`BrowseKind::Albums`, the `browseOffsets` key and the `albums` icon id stay.

**Does not change:** the Album column, the Album smart-playlist field, the tag
editor's Album input, or `tracks.album`. Those name the ID3 frame, which is
still called that.

## The two strings

[store.ts:83](src/features/library/store.ts#L83) — `VIEW_TITLES.albums`. One
edit covers three renderings: the view heading
([App.tsx:336](src/App.tsx#L336)), the drill-in breadcrumb "‹ All Albums"
([App.tsx:352](src/App.tsx#L352)), and the history arrows' tooltip fallback
([HistoryNav.tsx:22](src/features/library/HistoryNav.tsx#L22)).

[LibraryNav.tsx:22](src/components/ui/LibraryNav.tsx#L22) — the sidebar item,
which carries its own copy of all four labels. This is the duplicate
`VIEW_TITLES` was moved out of `App.tsx` to prevent; drop `VIEWS[].label` and
read `VIEW_TITLES[id]` so there is one list again.

Then two nouns that are not in either list:

- [viewSummary.ts:38](src/features/shell/viewSummary.ts#L38) — `"album"` →
  `"release"`, giving "12 releases" and "No releases".
- [browse.ts:13](src/features/library/browse.ts#L13) — `unknownLabel("albums")`
  → "Unknown Release", surfacing on an untagged tile and in the arrows' tooltip.
  The rationale comment above it cites "Unknown Album" as the string that must
  not collide with a real album named that; after the rename the collision is
  gone, so rewrite the comment rather than leaving it describing the old
  hazard. Same for the collision case at
  [browse.test.ts:26-29](src/features/library/browse.test.ts#L26-L29).

## Tests

Unit, all asserting the literal word:
[chrome.test.tsx:374, 383, 396](src/components/ui/chrome.test.tsx#L374),
[App.test.tsx:1000](src/App.test.tsx#L1000),
[HistoryNav.test.tsx:82](src/features/library/HistoryNav.test.tsx#L82) ("Back to
Unknown Album"), [browse.test.ts:19-29](src/features/library/browse.test.ts#L19-L29),
and [viewSummary.test.ts:22-65](src/features/shell/viewSummary.test.ts#L22-L65).

Five e2e specs select the sidebar item by its text:
[smoke](e2e/specs/smoke.test.ts#L72) (also asserts the item's own text),
[navigation-history](e2e/specs/navigation-history.test.ts#L56) (also asserts the
title "Forward to Albums" at
[:74](e2e/specs/navigation-history.test.ts#L74)),
[library:428](e2e/specs/library.test.ts#L428),
[browse-scroll](e2e/specs/browse-scroll.test.ts#L83) (five call sites), and
[browse-layout:61](e2e/specs/browse-layout.test.ts#L61).

The `browse-albums-wide` / `browse-albums-narrow` screenshot names are artifact
filenames, not UI, and renaming them breaks the comparison against what is
already committed. Leave them.

## Docs

[design.md:62 and :65](docs/knowledge/design.md#L62) and
[frontend.md:45](docs/knowledge/frontend.md#L45) name the sidebar item. The
design source calls it Albums, so this is a deliberate departure — carry it back
there too.
