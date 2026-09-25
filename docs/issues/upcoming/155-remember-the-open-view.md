# 155 — Remember the open view

Across restarts, reopen the view last open: library tab, playlist, drill-in
(`browse`), Statistics tab and path.

- Stored in `settings`, written on navigation.
- Target gone (playlist deleted, drill-in emptied): fall back to Songs.
- Search text is not restored.
- Back history starts empty.

## Testing

- Rust: key round-trip.
- Frontend: stale target falls back to Songs.
- e2e: open a playlist, restart, it is open.
