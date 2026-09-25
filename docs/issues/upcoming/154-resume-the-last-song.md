# 154 — Resume the last song

Across restarts, remember the last loaded track and its position. On launch it
is loaded paused at that position; Play continues from there.

- Stored in `settings` (`src-tauri/src/db/settings.rs`) like volume, written on
  track change, pause, seek and quit — not every playhead tick.
- Track removed from the library or file missing: nothing restored.
- A restore is not a new play: no play-log row, no scrobble, no now-playing
  update until Play.
- Queue: restore the track only, or its queue context too — decide.

Interacts with [153](153-no-player-bar-until-something-plays.md): a restored track
is loaded, so the bar shows.

## Testing

- Rust: key round-trip; missing track clears it.
- e2e: play, seek, restart app, track shown paused at the position.
