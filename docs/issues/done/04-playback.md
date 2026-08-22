# 4 — Playback: engine, transport, play counts

Merged in `eb24e87`.

A dedicated audio thread owning the `rodio` sink behind an `mpsc` command enum,
`player://` events, transport controls, a draggable scrubber, volume that
survives a restart, queue advance and play counts.

- The queue is a list of ids sent to Rust with the activated index; paths are
  looked up backend-side.
- One `rodio::Player` per track, dropped and recreated on load.
- A missing audio device installs a null sink and reports why on
  `player://error` — the app still runs.
- **"Played" means 50% of the track** (`PLAYED_FRACTION`), matching the last.fm
  rule so counts and scrobbles cannot disagree.
