# Accepted limitations

Known, decided, and not scheduled. Anything with work attached lives in
[issues/upcoming/](../issues/upcoming/) instead.

- **No folder drag-and-drop ingest.** Adding music is a folder picker. What made
  this a limitation rather than a task was that `dragDropEnabled` had to stay
  `false` for in-app dragging to work at all; phase 74 removed that, and the
  work now lives in
  [85b](../issues/upcoming/85b-drop-files-and-folders.md).
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
- **A change under a watch folder is noticed by a poll**, within the chosen
  interval, not when it happens. Same trade as the output device above:
  `notify`/ReadDirectoryChangesW drops events on network and removable volumes
  and sees nothing that happened while the app was closed, so it would be a
  second code path beside the walk rather than a replacement for it. Fifteen
  minutes by default; Off, 5, 30 and 60 are the alternatives.
- **An unattended pass leaves an unplugged drive alone entirely.** A root that
  is not on disk contributes nothing to a pass — neither its files nor their
  absence — so songs on a drive that has been unplugged are neither marked
  missing nor removed until the user runs a Rescan.
- **A failed unattended pass is silent.** It was not asked for, so it is not an
  error popover; the line in `main.log` is where it says so.
- **A first release lookup over a large library takes two days.** Two
  MusicBrainz calls per release, one request in flight at a time and ten
  seconds between them, which is roughly forty-five hours for eight thousand
  releases — all but twenty minutes of that is the interval itself, and absorbed
  retries add to it. Deliberately far slower than their documented allowance: a
  503 there can mean their global budget is full rather than anything about this
  client, and slowing down has been measured not to buy requests, so the pass
  asks as little as it can rather than as much as it may. The gate is
  process-wide, so **an open lookup dialog waits behind the pass** — up to ten
  seconds before its request even goes out. A library already tagged with
  release MBIDs pays none of it.
- **A release MusicBrainz has nothing for is never looked up again.**
  Deliberate: MusicBrainz grows, so today's miss is next year's match, but
  re-searching every miss on every launch would be the best part of a day
  that finds nothing, forever. There is no manual re-lookup yet.
- **A release the pass was unsure about has nowhere to be reviewed yet.** It is
  recorded, with its candidates, and nothing was written to it — but there is no
  screen that offers it, and no readout saying a pass is running at all. Until
  there is, the log is the only place either shows.
- **No shuffle, and no repeat-all.** Repeat is one song, on or off. Deliberate.
- **A playlist cannot hold the same track twice**, by schema. iTunes allows it;
  reporting "added 6 of 10" is the better answer.
- **Orphaned covers accumulate again after the one prune.** `covers` is pruned
  at the end of the normalizing pass and never afterwards, so a song removed
  later leaves its artwork behind. At a normalized 37 KB a cover this is no
  longer the megabyte-a-row it was.
- **A tag edit cannot be taken back.** There is no undo: 82a removed the
  journal rather than bounding it, because a single-level undo over an
  unattended pass's thousands of batches reverts whichever release the pass
  finished with rather than the user's own last edit. What guards an automatic
  write is the lookup's confidence threshold and the releases it declines to
  write at all.
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
- **The release lookup is MusicBrainz only.** Discogs was considered and is the
  secondary everyone reaches for on electronic and vinyl, but it needs a
  mandatory token, a stored credential and a Settings control to give a second
  opinion on records this library mostly is not.
- **A lookup matches on text, not on audio.** AcoustID would match a file whose
  tags say nothing, and its Rust port would survive `unsafe_code = "forbid"` —
  but fingerprinting means decoding two minutes of every file, so it is the
  answer for what text search cannot match rather than the first pass.
- **A lookup is one release a second**, because MusicBrainz enforces its rate
  limit at the IP address and blocks rather than throttles. A selection of a
  hundred releases is therefore a minute and a half of searching even before
  anybody reads a result.
- **The confirm dialog pairs files with tracks one to one**, in track order,
  with arrows to swap two rows. There is no drag reorder and no way to map two
  files onto one track.
