# 155 — Remember the open view

Across restarts, reopen the view last open: library tab, playlist, drill-in
(`browse`), Statistics tab and path.

- Stored in `settings` (`library.view`), written on navigation.
- Target gone: land where the same case lands mid-session. Deleted playlist →
  library, same tab; emptied drill-in → its group list.
- Search text is not restored.
- Back history starts at the restored view.

## Testing

- Rust: key not exportable.
- Frontend: restore, stale targets, unreadable value, a click during restore.
- e2e: open a playlist, reload, it is open.
