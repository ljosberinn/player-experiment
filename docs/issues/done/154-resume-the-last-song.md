# 154 — Resume the last song

A launch loads the last track paused at its position, in the queue it was
played from; Play continues, Next moves on through that queue.

- `settings`: `player.queue` (ids, written by `player_play`) and
  `player.resume` (`{index, positionMs}`, written on each `StateChanged` and on
  `RunEvent::Exit`, deleted on stop). Neither is exportable.
- Stop or the queue running out: nothing restored.
- Track gone from the library: nothing restored. File missing: marked missing,
  no error dialog. Either way the key is gone.
- Not a new play: no play-log row, scrobble or now-playing until Play; a track
  restored past halfway is not counted again; `started_at` is the first resume.
- A Play that beats the restore at launch wins.

With [153](153-no-player-bar-until-something-plays.md): a restore is paused, so
the bar shows.

## Tests

- Rust: engine restore (paused, not counted twice, clock, loses to a Play,
  silent failure, clamped); resume-point round trip and corrupt values;
  `take_restore` after songs before it left, and with its own track gone.
- e2e: `playback.test.ts` via `e2e_restore_playback` — a spec cannot restart
  the app.
