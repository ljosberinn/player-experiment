# 16 — Row status column, and files that go missing

Merged in #35.

A narrow unlabeled first column: an animated speaker for the playing row, a red
exclamation for a file that is gone, empty otherwise. The icon was the small
part; the state behind it was the phase.

- **Migration 4** adds `tracks.missing_since` with a **partial** index. A scan
  now *marks* a vanished file instead of deleting its row, and deletion becomes
  an explicit user action. An unplugged drive is a temporary condition rather
  than data loss — previously it destroyed every playlist entry pointing at it,
  beyond recovery.
- The scan plan reports `missing` and `returned`; already-marked files are left
  out, so the timestamp says when a file went, not when it was last looked for.
- `Event::LoadFailed(track_id)` joins `Event::Error(String)` — the message is for
  the user and the id is what marks the row; one string cannot be both. A failed
  play marks its track without waiting for a scan.
- **The phase 6 test written to pin the old behaviour was inverted**, which is
  what it was for.
- The remove affordance only exists when there is something to remove, behind
  `ConfirmDialog`, and its wording names the cost that is easy to miss — the
  playlist entries.
- Caught in review: the playing speaker was `var(--accent)` on a row whose
  background is `var(--accent)`, so it vanished under selection. Both markers
  take `color: inherit` there, and a CSS guard requires it. The glyphs carry the
  meaning without the colour.
- `App.css.test.ts` gained `ANIMATION_ALLOWED` — a one-entry exception list, plus
  a check that the exception stands down under `prefers-reduced-motion`. An
  exception that ignores the OS setting is phase 13's rule coming back through a
  side door.
