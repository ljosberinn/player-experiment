# 30 — A seeded library in e2e

Merged in #45. Closes the hole phase 27 named: every spec ran against an **empty**
library, so nothing had ever looked at a row — and the row is where the defects
land.

Three things stood between the suite and a populated library, all of them "a CI
runner is not a desktop":

- **Getting music in.** "Add Folder…" opens an OS picker WebDriver cannot answer,
  so the test invokes `add_watch_folder` directly through `window.__TAURI__` — the
  one command the suite drives itself. After that it clicks Rescan and the app's
  own path runs. The mp3s are generated in Node at spec time (silent MPEG-1 frames
  behind a hand-written ID3v2.3 tag, ~180 lines, no dependency): no encoder, no
  blobs in git, no licensing question. Six tracks over three artists, chosen so
  title order and artist order interleave differently — a sort assertion that held
  under both would prove nothing — plus a `.jpg` and a `.txt` the scanner must
  ignore.
- **Playing anything.** A runner has no audio device, so the app falls back to
  `NullSink`, where every load fails by design and no row could ever be marked
  playing. `SilentSink` accepts every load and advances position on a wall clock,
  selected by an environment variable only a `wdio`-feature build reads.
- **Isolation.** `PLAYER_E2E_DATA_DIR`, set per spec in `beforeSession`, so the
  spec that seeds six tracks does not break the one asserting on an empty library
  — or, on a developer's machine, use *their* library. The seeded spec asserts the
  empty state **before** it writes, so a silently-ignored override fails as itself
  rather than as a wrong row count.

What rows are now asserted to do: carry what the scanner read (whole rows at once,
so a shifted column is legible in the failure), count six and ignore the two
non-audio files, sort both ways, extend a selection with shift, mark the row being
played and name it in the status display — and keep the playing marker at 3:1 both
on and off the selected row, in both themes.

Fixtures live in `e2e/.tmp`, gitignored and rebuilt per run.
