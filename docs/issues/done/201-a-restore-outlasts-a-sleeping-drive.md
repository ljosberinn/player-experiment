# 201 — A restore outlasts a sleeping drive

```
09:42:56 ok  db.open
09:42:56 err playback.load   track=64131 error=the file would not open
09:43:57 ok  scan.watch      added=0 updated=0 missing=0 returned=1 unreadable=141 ms=45735
```

D: is a USB disk. NTFS logged its mount at 09:43:03, seven seconds after the
restore tried to open the file. The file hadn't changed, and the first watch
pass found it again (`returned=1`).

One failed open at launch cost the session: the resume point was deleted
before the load, the player came up empty, the present file was marked
missing, and the sink's error was thrown away.

## Shape

- Wait for the drive. Before sending `Command::Restore`, the restore thread
  checks the track's file. If the file and the watch folder holding it are
  both absent (`scan::watch::unmounted_root`), it polls that folder for up to
  60s, logs `playback.wait folder= mounted=`, and then restores. A file
  that's absent while its folder is present goes ahead at once.
- After a wait the resume point is read again, and the restore is dropped if
  it changed. A Play during the wait saves its own queue, and the engine's
  `Stopped` check can't see a Play whose loads all failed.
- A failed restore sends `Event::RestoreFailed` with the sink's error, not
  `LoadFailed`, so nothing is marked missing; the watch pass decides that. The
  log shows `err playback.restore track= error=`, and there's no dialog.
- The resume point survives a failed restore:
  - `playback::restore` (was `take_restore`) reads it and leaves it.
  - `remember`, and with it the exit write, leave it alone while the engine
    has no queue. Any Play fills the queue, so a Play that fails still
    replaces it.
  - `playback::restore` drops it once its track has left the library or is
    marked missing.

A retired drive's tracks are never marked missing by the watch pass, which
skips absent roots. Its resume point is retried each launch (a background wait
and one log line) until the user plays something.

Out of scope: a sink or device error (no output device, `sink.rs:234`, `:342`)
also arrives as `LoadFailed`, and marks a present file missing on any load.
