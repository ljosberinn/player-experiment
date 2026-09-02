# 86 — Every operation in a logfile

When a scan drops a folder, a tag write half-lands or a scrobble never arrives,
there is nothing to read. `crashes.log`
[29](../done/29-crash-log.md) covers the process dying and nothing else, and the
`scan://progress` and `tags://progress` channels
[61](../done/61-one-status-channel.md) are gone the moment the window closes.

So every operation that touches the backend is written down.

**`main.log`, beside `library.sqlite3` and `crashes.log`.** One folder holds
everything this app has put on the machine — `crash.rs`'s reasoning, unchanged.
`data_dir()` already honours the e2e override, so a test build logs into its own
directory rather than the developer's real one.

**Rotation is checked before each write**: the current size plus the line over
5MB renames `main.log` to `main_prev.log`, overwriting whatever was there, and
starts a new `main.log`. Two files, 10MB, no third generation and no
timestamped names to sweep up.

**No `log` or `tracing` crate.** A module with a `Mutex<File>` in Tauri state,
the same call `crash.rs` made. One whole line per lock: the `rayon` scan pool,
the player thread and the scrobbler thread all write, and a half-line from one
inside another's is worse than no line. `format` and `rotate` stay pure
functions over a path so they are testable with `tempfile`, like
`crash::format`.

`time` and `chrono` are both already in `Cargo.lock` transitively, so a readable
timestamp costs a direct dependency line and no new crate.

```
2026-09-02T14:03:11Z ok  scan            added=412 updated=3 removed=0 ms=8140
2026-09-02T14:05:02Z ok  tags.write      tracks=17 cover=replaced ms=940
2026-09-02T14:05:44Z err playlist.delete id=12 error=playlist not found
```

Timestamp, outcome, operation, then `key=value`. A failure carries the
`AppError` display, which is the string the user was shown, so a screenshot and
the log line say the same thing.

## What is logged

- **Every mutation and every long job**: scan, watch-folder add, the three
  removal commands, tag write and undo, cover replace and both staging routes,
  the eight playlist commands, filter and order edits, export, last.fm connect
  and disconnect, each scrobble and now-playing submission, the cover-normalize
  pass. Roughly the set that already goes through `commands::announcing` and
  `commands::blocking`, plus the background work that goes through neither.
- **Every `Err`**, reads included — a `query_tracks` that fails leaves a trace
  even though its successes do not.
- **From playback, only what changes state**: the track load, and the `Played`
  mark at `PLAYED_FRACTION` that bumps the count and feeds the scrobbler. Not
  pause, resume, seek, next, previous, volume, mute or repeat — a minute of
  fiddling with the transport would rotate the file past the scan that is
  actually being investigated.
- **Not the UI preference writes** — zoom, columns, sidebar sections, window
  geometry. They are a control's position, not an operation.

**Later phases log their own sites.** The file moves in
[83](83-the-library-folder.md) and the ingest in
[85](85-drop-files-and-folders.md) are exactly the long, partially-completing,
filesystem-touching work this exists for; neither is a dependency in either
direction.

## The session key is never written

Paths and the last.fm username land in the file. The session key does not, at
any level, in any error string. The file never leaves the machine it was written
on — same as the crash log, and the same reason there is nothing here to scrub.

## Reaching it

Reveal `main.log` from Settings, through `reveal.rs`, beside `reveal_crash_log`.
A log nobody can find is not one.
