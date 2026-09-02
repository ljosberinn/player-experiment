# Accepted limitations

Known, decided, and not scheduled. Anything with work attached lives in
[issues/upcoming/](../issues/upcoming/) instead.

- **No folder drag-and-drop ingest.** Adding music is a folder picker. What made
  this a limitation rather than a task was that `dragDropEnabled` had to stay
  `false` for in-app dragging to work at all; phase 74 removed that, and the
  work now lives in
  [85](../issues/upcoming/85-drop-files-and-folders.md).
- **No crash reporting off the machine.** A local panic log covers the failure
  class; a network reporter contradicts the product.
- **Installers are unsigned.** SmartScreen warns on first run of each version.
- **mp3 only.** The schema and `lofty` both allow flac/m4a later with no
  migration.
- **No gapless playback.** The join is down to roughly 10ms, not to nothing:
  sample accuracy needs the next decoder appended to the same `rodio::Player`,
  which costs the one-`Player`-per-track design the engine relies on.
- **An output device change is noticed by a poll**, once a second, not by
  `IMMNotificationClient`. Implementing that COM interface means `unsafe`, and
  the crate forbids it - the same trade as DPAPI below. A device switch is
  therefore heard up to a second late, and a scrubber drag inside that second
  is refused with an error rather than served.
- **The output device is always the OS default.** Settings cannot pin one.
- **No shuffle, and no repeat-all.** Repeat is one song, on or off. Deliberate.
- **A playlist cannot hold the same track twice**, by schema. iTunes allows it;
  reporting "added 6 of 10" is the better answer.
- **Orphaned covers accumulate again after the one prune.** `covers` is pruned
  at the end of the normalizing pass and never afterwards, so a song removed
  later leaves its artwork behind. At a normalized 37 KB a cover this is no
  longer the megabyte-a-row it was.
- **Undo does not restore artwork.** `covers` holds a 500px JPEG re-encode
  rather than the bytes a file carried, so restoring from it would bake a
  thumbnail into the mp3. An undo leaves the file's picture exactly as the edit
  left it, and an edit that replaced or removed artwork cannot be taken back.
  `TagSnapshot.cover_hash` is still written and no longer read.
- **Stored artwork is not the file's artwork.** Anything larger than 500px is
  downscaled and everything decodable is re-encoded at q85, so `cover://`
  serves a smaller picture than the mp3 holds. A cover the user picks still
  reaches the file at full resolution — `read_cover` reads the path the edit
  names and never consults `covers`.
- **Removing the song that is playing blanks the transport, mid-song.**
  `QueueEntry` carries a path and a duration, so playback is not interrupted -
  but `db::playback::snapshot` fills `track` from the row by id, so the next
  `player://state` renders "Nothing playing" over audio that is still going,
  until the queue moves on. Accepted over stopping the music for a library
  edit, or refusing to remove one row out of a selection.
- **A removal cannot be undone, only forgotten.** File ▸ Forget Removed Songs
  lifts the tombstones so a rescan re-adds the files; the rows they had, and
  the ids, play counts and playlist places on them, are gone.
- **The undo journal is unbounded** — one row per track per edit, forever.
- **Dragging is mouse-only**, but nothing behind it is any more: the Menu key
  opens the row menu on the selection, Alt+Arrow nudges it within a playlist,
  and Delete removes from one. What has no keyboard route is the gesture, not
  the actions. Load-bearing since phase 74 rather than incidental: in-app
  dragging routes each `pointermove` to whatever is under the pointer, which
  Chromium's implicit pointer capture for touch and pen would undo.
- **The frameless window is not covered end to end** — the e2e build pins
  `decorations: true` or the embedded driver never sees the webview.
- **e2e cannot perform an OS drag** — a file from Explorer onto the artwork
  square. In-app dragging is covered from a dispatched `PointerEvent` sequence
  down. No test asserts that sound came out, or that the OS delivers a media key
  to an unfocused window.
- **`npm audit` reports a dev-only advisory** in `serialize-javascript` via the
  `@wdio/*` chain. Production dependencies are clean; not force-fixing.
- **The last.fm session key is stored unencrypted**, in one `settings` row,
  labelled as such in the code and in the Settings pane. Decided in
  [plans/lastfm.md](../plans/lastfm.md): DPAPI would cost the crate's
  `unsafe_code = "forbid"` permanently, the credential is a revocable
  scrobbling token rather than a password, and encryption under a constant
  compiled into the binary is worth nothing while looking like protection.
- **Disconnecting from last.fm is local only.** The API has no method to revoke
  a session key, so the app forgets it and the pane says where to revoke it
  properly.
