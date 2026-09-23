# 139 — The review dialog has room

Four changes to the MusicBrainz lookup ([ReleaseLookup.tsx](../../../src/features/tagsource/ReleaseLookup.tsx)).

**Local track numbers.** The mapping's File cell draws title and duration only
([ReleaseLookup.tsx:591](../../../src/features/tagsource/ReleaseLookup.tsx#L591)).
Prefix it the way `RemoteCell` does
([ReleaseLookup.tsx:654](../../../src/features/tagsource/ReleaseLookup.tsx#L654)):
`track.track_no`, with `disc_no-` when any selected file is on a disc above 1,
`—` when the file has none. Visible in every stage, since `tracks` is local.

**Total on disk.** The File head states how many files the release has on disk
(`tracks.length`), the MusicBrainz head the candidate's track count once one is
picked, so a mismatch reads off the heads
([ReleaseLookup.tsx:569](../../../src/features/tagsource/ReleaseLookup.tsx#L569)).
The subject line's `N files` / `x of N files mapped` stays.

**Five candidates.** `.lookup-results` has no cap; the pane scrolls it with
everything else ([app.css:1520](../../../src/styles/app.css#L1520)). Cap it at
five rows' height and scroll inside it (`overflow-y: auto; min-height: 0`).
A result is a fixed three lines, so the cap is a calc, not a measurement.
Search returns up to 15 (`SEARCH_LIMIT`,
[musicbrainz.rs:38](../../../src-tauri/src/tagsource/musicbrainz.rs#L38)).

**Bigger box.** Width is the generic `min(912px, 92vw)`
([library.css:1323](../../../src/styles/library.css#L1323)), height
`min(720px, 86vh)` ([app.css:1372](../../../src/styles/app.css#L1372)).
`.dialog.lookup` states both:

- height `max(min(720px, 86vh), 80vh)` — 80% on a large window, never shorter
  than today on the default 864px one, where 80vh is 691px;
- width wide enough that the eight Write boxes
  ([mapping.ts:34](../../../src/features/tagsource/mapping.ts#L34)) sit in one
  row at the default window — roughly 800px of pane at today's sizes, so about
  `min(1200px, 92vw)`. Measure after 129, which grows both the boxes and the
  window. At the minimum window they may wrap.

`App.css.test.ts` moves with it
([App.css.test.ts:938](../../../src/App.css.test.ts#L938)): the height regex
expects `min(`, and the scroller list becomes the queue, the pane and
`.lookup-results`. `docs/knowledge/frontend.md` quotes `min(720px, 86vh)` and
912px.

## Verification

- Every File row starts with its track number; a two-disc release reads `1-3`.
- The File head counts the files; the MusicBrainz head counts the picked
  release's tracks.
- Fifteen candidates show five, the rest scroll within the list; the covers
  and mapping below stay in place.
- At the default window size the Write boxes are one row; on a maximised 1440p window the
  dialog is ~80% of its height.
- Footer does not move between stages.
