# 139 — The review dialog has room

Four changes to the MusicBrainz lookup ([ReleaseLookup.tsx](../../../src/features/tagsource/ReleaseLookup.tsx)).

**Local track numbers.** The mapping's File cell leads with `track.track_no` the
way `RemoteCell` does, with `disc_no-` when any selected file is on a disc above
1, `—` when the file has none. Visible in every stage, since `tracks` is local.

**Both counts in the heads.** `File · N` (files on disk), `MusicBrainz · N` once
a release is picked (`detail.tracks.length`). The subject line's `N files` /
`x of N files mapped` stays.

**Five candidates.** `.lookup-results` is capped at five rows and scrolls inside
itself; search returns up to 15 (`SEARCH_LIMIT`). The cap is a calc, which
needs a result to be a fixed three lines: `.lookup-result` states its own face
(Archivo 13.5px/1.3), a `--menu-border` edge, and truncates each line. It
previously drew in the engine's Arial inside an outset bevel.

**Bigger box.** `.dialog.lookup` is `min(1200px, 92vw)` by
`max(min(792px, 86vh), 80vh)`. The eight Write boxes take 852px of pane, which
1200px gives at the default 1560×950 window; at the 1136px minimum they wrap.
Height is unchanged at the default window and 80% on a tall one.

## Verification

- Every File row starts with its track number; a two-disc release reads `1-3`.
- The File head counts the files; the MusicBrainz head counts the picked
  release's tracks.
- Fifteen candidates show five, the rest scroll within the list; a long title
  truncates rather than growing its row.
- At the default window size the Write boxes are one row; on a maximised 1440p
  window the dialog is ~80% of its height.
- Footer does not move between stages.
