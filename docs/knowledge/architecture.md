# Architecture

Apex is a local-only desktop music player for libraries of tens of thousands of
mp3s. That scale drives every decision: SQLite is the source of truth (never an
in-memory array of tracks), queries are paged, rows are virtualized, and audio
decoding happens off the webview thread.

Tauri v2 — Rust core plus a WebView2 frontend. The network at runtime is the
updater; last.fm, once an account is connected; and the release lookup, when
somebody opens it. All three are opt-in and none runs on launch, on scan or on
play. Each of the latter two is behind a trait of its own
(`lastfm::transport::Transport`, `tagsource::transport::Transport`) so nothing
above them knows HTTP exists.

```
src-tauri/src/
  db/         rusqlite: schema, queries, playlists, settings, covers, tag values
  scan/       walkdir + rayon ingest, incremental by (mtime, size)
  tags/       lofty read/write, atomic writer
  audio/      symphonia + rodio player thread, command/event channels
  smart/      filter tree -> parameterized SQL
  export/     JSON export
  lastfm/     scrobbling: the transport seam, api_sig, the rules, the queue
  tagsource/  MusicBrainz + Cover Art Archive lookup: transport seam, the
              process-wide rate limiter, candidate scoring, the unattended
              pass (one release in `pass`, the thread in `worker`)
  library/    the Library folder: `layout` is where a file goes, as a pure
              function of a release and one of its tracks; `mover` puts one
              release there, files and rows in one transaction
  commands/   #[tauri::command] surface
  crash.rs    panic hook, bounded log
  log.rs      every operation, one line each, rotated
  palette.rs  dominant colours from cover bytes
src/
  features/   library, playlists, player, editor, tagsource, smart, shell,
              updater, crash, export
  components/ui/  chrome primitives
  ipc/        the only module that calls invoke; bindings/ is generated
e2e/          WebdriverIO specs plus the harness (fixtures, contrast, screenshot, viewport)
```

## Rules that hold everywhere

- **`commands/` is a thin seam** — argument parsing and delegation only, so the
  domain modules stay unit-testable with no Tauri runtime.
- **Types cross IPC once.** Declared in Rust with `#[derive(TS)]`, emitted to
  `src/ipc/bindings/`. CI fails on drift; `npm run bindings` regenerates. Never
  hand-write an IPC payload type. `i64` fields are annotated `number`, not
  ts-rs's default `bigint` — they arrive as JSON and `JSON.parse` never produces
  a bigint.
- **`src/ipc/` is the only caller of `invoke`.** Everything else takes a typed
  function.
- **Every Tauri API needs an ACL entry** in `src-tauri/capabilities/default.json`.
  See [gotchas](gotchas.md) — this class of bug has shipped four times.

## Threading and events

One dedicated **scrobbler thread** owns the last.fm transport and drains an
`mpsc` channel of jobs, the same shape as the player: the player thread produces
`Played` and `NowPlaying` and must never wait on a socket, so it hands over a
track id and moves on. In a build with no last.fm key the thread does not exist.

One dedicated audio thread owns the `rodio` sink and receives an `mpsc` command
enum. It emits `player://position` (throttled ~4/s), `player://state`,
`player://ended`, `player://error`. Scanning runs on a `rayon` pool and emits
`scan://progress` and `library://changed`. Neither ever blocks a command handler.

**A watch folder is polled, not watched.** A `library-watch` thread wakes every
15 seconds, reads `library.watchInterval` from `settings` — so a change in
Settings applies without a restart and needs no channel — and runs one
incremental pass when the interval is up, plus one shortly after launch, which
is what notices whatever moved while the app was closed. Not
`notify`/ReadDirectoryChangesW: an event stream drops events on network and
removable volumes and sees nothing that happened while the app was closed, so
it would need the startup walk anyway and be a second code path rather than a
replacement. Two rules make an unattended pass safe to run at all:

- **A root that is not on disk is skipped, not walked.** `walk` yields nothing
  for a missing root and `plan` would then mark every track under it missing —
  correct when the user asked for a scan, ruinous on a timer. So the pass
  filters roots by existence and passes the absent ones to `plan`, which leaves
  their tracks alone. A manual Rescan keeps the old behaviour: the user asked
  for the answer, and those marks are what feeds Remove Missing.
- **A pass that changed nothing says nothing.** It emits no `scan://progress`
  while there is no work (which would flash "Scanning 0 of 0"), and announces
  on `library://changed` only when `added + updated + missing + returned` is
  non-zero.

**One lock serializes everything that rewrites rows from files on disk.**
`scan::ScanLock`, managed beside `Db`, taken by `scan_library`,
`tagsource_apply`, the poll, the release lookup pass and `library::mover`. The poll `try_lock`s
and skips the pass entirely; a user-asked scan waits, because a Rescan that
silently did nothing is worse than one that starts its walk late. **The lookup
pass takes it per write, never for the pass** — it rewrites the files a scan
reads its `(mtime, size)` from, so each write has to be behind the lock, but
holding it for the whole pass would block every scan for the best part of a
day. **The mover takes it per release** for the same reason, and rewrites
`tracks.path` in the same transaction as the rename: `insert_track` is
`ON CONFLICT(path)`, so a move a rescan discovered would be a new row plus an
old one marked missing, at the cost of the play count, `added_at` and every
playlist the track was in.
Poison-tolerant: a panicking scan must not leave the
library unscannable for the rest of the session.

**A second background thread looks releases up.** `release-lookup` wakes on the
same fifteen seconds, reads `lookup.unattended` from `settings`, and works
through every release `release_lookup` has no row for: two MusicBrainz calls
each. It reads the setting between releases and not only on waking, so turning
the switch off cancels a pass in flight and turning it back on resumes from the
table rather than from the top; a setting that cannot be read is logged and is
not taken for a switch that is off. Above `score::UNATTENDED_THRESHOLD` it
writes the release's tags; below it, it records the release for a person to
decide and writes nothing. **Each release it decides announces itself on
`library://changed`** — written or queued, and per release rather than per
sweep, because a sweep runs for hours and may not end at all, and a view told
only at the end of one is a view that never hears. Queuing counts because the
sidebar's review count is drawn from that row; the rate is unchanged either way,
since written and queued are one release's two outcomes and never both.
`commands::invalidate` is what keeps it affordable. A dry run announces nothing,
having written nothing.

**It also reports where it stands on `task://progress`**, per release attempted
and `null` when the sweep ends, whatever ended it. Its own channel rather than
one of the per-write ones: this is a task measured in days, drawn at the foot of
the sidebar for its whole life, and the payload carries a label because the
channel has more than one producer. The estimate comes from the last hundred
releases rather than from the whole pass — one whose files already carry an MBID
costs nothing and a searched one costs two rate-limited requests, so an average
over the run describes a pass that is not the one running.

**Waking and sweeping are two cadences.** The switch is answered every fifteen
seconds because that is what makes it feel immediate, and it costs one keyed
row. A sweep costs two group-bys over every track in the library, so the gap
between sweeps doubles — to a ten-minute ceiling — whenever one finds nothing to
do or ends on a failure, and snaps back to fifteen seconds the moment one gets
through releases. A release a scan has just added therefore waits up to ten
minutes, which is nothing beside a pass measured in hours.

**The limiter holds one request at a time, ten seconds apart.** Not the one a
second [MusicBrainz documents](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting),
because they decline with a 503 from three separate buckets — per user agent,
per address and a global three hundred a second — and a client inside its own
allowance still meets 503s when theirs is full, indistinguishably. Slowing down
was measured and does not buy requests: releases reached before the first fatal
503 were 72 at 1.1s, 26 at 3s and 35 at 5s, with roughly one request in twelve
still being re-asked at the slowest of those. So the interval is not a rate
expected to avoid 503s; it is the least the pass can ask of a service it depends
on the spare capacity of. The gate is held for the whole request rather than
only the gap before it, so the interval is measured from when an answer came
back; a request that could work later is asked again twice, with the limiter
rather than the caller deciding how long that takes — and the count of those goes
in the log, on the release line and totalled on the sweep line, because a retry
that works leaves no other trace and the interval it costs reads as a slow
request.

`APEX_LOOKUP_DRY_RUN` runs the whole thing and writes neither files nor rows,
which is how the threshold is tuned against a real library. **The rows are the
real pass's cursor and cannot be the dry run's**, so a dry run pages
`lookup::pending` by offset instead, skips the tag seed — the one row it would
otherwise leave behind — and logs `would-write` and `would-queue` where a real
pass logs `written` and `queued`. That offset is the thread's rather than the
sweep's, so a sweep a 503 ended does not send the survey back to the first
release.

**Every write long enough to notice runs on a worker thread**, through
`commands::blocking`, and reports on a channel of its own: a scan on
`scan://progress`, a tag edit on `tags://progress`, an export on
`export://progress`. The domain functions take an `on_progress` closure rather
than a Tauri handle, so each stays testable with no running app.

`task://progress` is not one of those three. Those report on writes that finish
in a minute, from the content header; that one reports on a task measured in
days, from the foot of the sidebar, and carries its own label because it has
more than one producer.

**Every write that commits announces itself on `library://changed`**, through
`commands::announcing` — a scan, a tag write, the three removal commands, and
each of the eight playlist commands. A bare ping with no payload:
nearly every write changes both the tracks and the playlists, so a scope would
say "both" at almost every site while being one more thing two stores have to
agree on. Only on success, since a rejected write changed nothing. This is the
one invalidation channel — a mutation does not tell each view what to reload,
it says the library moved and the views re-ask.

**The ping is coalesced before it leaves**, in `commands::invalidate`. Leading
edge plus trailing edge: an isolated write is announced the moment it commits,
and a write that keeps committing is announced once per five-second window
until it stops. That is for the writes that run for hours — the release lookup
pass commits a release every couple of seconds, and one ping per commit
is one full re-query of the open view and one recount of every playlist per
commit. The frontend's `INVALIDATE_DEBOUNCE_MS` still runs underneath and
composes with it; it cannot solve this on its own, because by the time the
pings arrive they are already further apart than the debounce.

The cost sits on the other side of the window: a lone write landing inside one
is announced by that window's trailing ping rather than at once, up to five
seconds later. A scan is the case to watch, since it announces once at the end
and so has no second ping to arrive sooner.

## What is written down

**`main.log`, beside `library.sqlite3` and `crashes.log`** — one folder holds
everything this app has put on the machine, and `data_dir()`'s e2e override
carries all three, so a test build logs into its own directory. `crash.rs`
covers the process dying and nothing else, and the progress channels are gone
the moment the window closes; this is what is left to read when a scan dropped
a folder, a tag write half-landed or a scrobble never arrived.

One line per operation: `timestamp outcome operation key=value…`, with the
`AppError` display string on a failure — the same string the user was shown, so
a screenshot and the log line agree. A `Mutex<Option<File>>` in Tauri state and
one whole line per lock, because the `rayon` pool, the player thread and the
scrobbler thread all write into it. No `log` or `tracing` crate: what those buy
is levels and filtering, and the set of operations is a product decision rather
than a runtime knob. `format` and `rotate` are pure functions over a path, so
both are tested against a `tempfile` like `crash::format`.

**Rotation is checked before each write.** Current size plus the line over 5MB
renames `main.log` to `main_prev.log`, overwriting whatever was there. Two
files, 10MB, no third generation and no timestamped names to sweep up. The
handle is closed before the rename, because Windows will not move a file this
process still holds open.

What gets a line:

- **Every mutation and every long job** — roughly what already goes through
  `commands::announcing` and `commands::blocking`, plus the background work
  that goes through neither: the watch-folder pass (`scan.watch`, including the
  passes that found nothing), the cover-normalize pass, and each scrobble and
  now-playing submission.
- **One line per release the lookup pass resolves or queues** (`lookup.release`,
  with the score), and one per sweep (`lookup.sweep`). **Silence for a release
  MusicBrainz has nothing for** — eight thousand lines about what was written is
  nothing next to a threshold that cannot be diagnosed after the fact, and eight
  thousand more about records nobody has heard of is noise.
- **Every `Err`, reads included.** A read is `Op::quiet`: a `query_tracks` that
  fails leaves a trace, and the thousands that succeed do not — a line per page
  the table asks for would rotate the file past whatever is being investigated.
- **From playback, only what changes state**: the track load and the `Played`
  mark. Not pause, resume, seek, next, previous, volume, mute or repeat.
- **Not the UI preference writes** — zoom, columns, sidebar sections, window
  geometry. They are a control's position, not an operation.

**The session key is never written**, at any level, in any error string. Paths
and the last.fm username do land in the file; it never leaves the machine it
was written on, which is the same reason the crash log has nothing to scrub.

Reachable from Settings ▸ Activity Log, which reveals it through `reveal.rs`
beside `reveal_crash_log`: a log nobody can find is not one.

- **The play queue is a list of ids sent to Rust**, not a view the backend
  re-derives: `player_play` takes the ordered ids of the current view plus the
  activated index, and paths are looked up backend-side, so a queue cannot carry
  stale metadata.
- **One `rodio::Player` per track**, dropped and recreated on load. `Drop`
  already stops the sound, so per-track is cheaper than working around append
  queue semantics.
- **The gap between tracks is two costs, paid separately.** A tick is the only
  thing that notices a track ran out, so `Engine::next_tick` shortens the poll
  from 250ms to 10ms over the last second of a track; `player://position` keeps
  its own 4/s floor, measured in playback position rather than the poll rate.
  The load itself is prefetched - `AudioSink::prepare` opens the next file on a
  scratch thread a few seconds out, and `load` uses the result only on an exact
  path match, so a skip or a queue edit invalidates it by missing.
- **A missing audio device is not fatal.** `RodioSink::open` failing installs a
  null sink behind the same interface and reports why on `player://error` —
  headless CI is exactly this case.
- **Playback follows the OS default output device.** An `output-watch` thread
  polls `cpal`'s default output every second and sends `Command::OutputChanged`
  when its `DeviceId` moved since the last poll, or when the cpal error
  callback flagged the open stream as dead. `AudioSink::reopen_output` then
  swaps in a stream on the new default and reports whether anything changed;
  the engine reloads the current entry, seeks back to where it was, and
  restores play or pause. Same play throughout — nothing is re-announced or
  re-scrobbled — and no device left to move to stops with an error.
- **"Played" means 50% of the track.** One constant (`PLAYED_FRACTION`) behind
  play counts and scrobbling alike. A repeat loop counts as a play, and
  `Event::Played` carries the wall-clock second the track *started* — derived
  from `now - position_ms` it would be wrong after any pause or seek.

## Cover art

`covers(hash, mime, bytes, palette)` deduped by content hash, referenced by
`tracks.cover_hash`. Bytes are **never** part of a row payload over IPC; they
are served through a custom `cover://<hash>` protocol handler so the webview
caches them. Mime types are sniffed from the bytes, not the extension
(`tags::write::check_cover`, which also caps the size).

**`bytes` is not what the file carried.** `db::covers::store` fits every cover
inside 500px and re-encodes it as JPEG q85 — artwork was 96% of a real
library's database, and re-encoding it is 81% off. **The hash stays the hash of
the source bytes**, so `tracks.cover_hash` and the scan's parallel hashing are
untouched and an already-stored hash returns without decoding anything; the
column simply stops describing its own bytes. Anything that will
not decode, and anything the re-encode would grow, is stored verbatim.

Covers stored by an earlier build are converted by the `cover-normalize`
thread `lib.rs` spawns beside the player — chunked, resumable through two
`settings` keys, and silent, since the picture on screen does not change. It
finishes by pruning covers no track references and running `VACUUM`, which is
what actually returns the pages to the filesystem. Both are only safe because
nothing reads artwork back out of `covers` at all — the bytes go to the window
and nowhere else.

A replacement cover travels to the backend as a **path** (`CoverEdit::Replace`),
whichever way it was chosen, and both ways **stage**: `stage_dropped_cover`
takes the bytes as the whole invoke payload (a drop has no path — an HTML5 drop
hands the page a `File`), `stage_picked_cover` copies the file the picker named.
Both check first and write the same fixed-name file into the cache directory.
The save re-reads and re-checks it like any other path.

Staging both routes is what makes a pending choice previewable: the webview
cannot read a path, so `cover://staged` — the one path under that protocol that
is not a hash — serves the staging file, `no-store`, with a version in the query
string, since the file's name is fixed and its contents are whatever was chosen
last.
