# Architecture

Apex is a local-only desktop music player for libraries of tens of thousands of
mp3s. That scale drives every decision: SQLite is the source of truth (never an
in-memory array of tracks), queries are paged, rows are virtualized, and audio
decoding happens off the webview thread.

Tauri v2 — Rust core plus a WebView2 frontend. The network at runtime is the
updater; last.fm, once an account is connected or a history import is asked
for; and the release lookup, when somebody opens it. All three are opt-in and
none runs on launch, on scan or on play. Each of the latter two is behind a trait of its own
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
  lastfm/     scrobbling: the transport seam, api_sig, the rules, the queue,
              the history import, loving a track
  tagsource/  MusicBrainz + Cover Art Archive lookup: transport seam, the
              process-wide rate limiter, candidate scoring, one release's
              lookup in `pass`
  library/    the Library folder: `layout` is where a file goes, as a pure
              function of a release and one of its tracks; `mover` puts one
              release there, files and rows in one transaction; `survey` is
              what the library still needs; `worker` is the thread that does
              both steps; `ingest` is what an OS drop leaves behind
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
- **A file write the user named goes through a command**, not
  `@tauri-apps/plugin-fs`. `export_library` walks the library behind
  `export://progress`; `save_text_file` takes a string a panel already built.
  The plugin would arrive with a capability and an fs scope over whatever path
  the save dialog returned, which is a permission surface the app does not
  otherwise have.

## Threading and events

One dedicated **scrobbler thread** owns the last.fm transport and drains an
`mpsc` channel of jobs, the same shape as the player: the player thread produces
`Played` and `NowPlaying` and must never wait on a socket, so it hands over a
track id and moves on. In a build with no last.fm key the thread does not exist.

**A history import is not the scrobbler's.** `lastfm_import` runs
`lastfm::import` through `commands::blocking` on the shared transport, one run
at a time, and reports on `lastfm://import`. It needs the build's API key and no
session, sleeps a quarter-second between pages, and stops after three failed
attempts at one page with its cursor committed, so the next Import resumes. It
announces on `library://changed` whether it finished or stopped: every page it
got through is committed and linked.

**Neither is a love.** `lastfm_love` runs `lastfm::love` through
`commands::blocking`, one signed request per song - `track.love` has no batch
form. It is the one last.fm call the user pressed a control to make, so unlike
a scrobble it is not queued and its failure is reported. It writes
`db::loved` first and puts the row back if the request is refused, stops at the
first refusal rather than working through the rest, and answers with the loved
set as it now stands so the window never has to guess. A key last.fm rejects is
forgotten there, and the command emits `lastfm://disconnected` when the session
it started with is gone by the end.

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

**A second background thread looks releases up and files them.** `library-pass`
wakes on the same fifteen seconds and reads two settings: `lookup.unattended`
and `library.organize` with `library.root`. It works through every release with
either step left to do, and does both in one visit — looked up first, then moved
to where `library::layout` says the tags the lookup just wrote belong. **One
pass rather than two**, because placing a release means reading the tags the
lookup writes: as two passes a gate would stall the backfill behind forty-five
hours of lookups, no gate would move 8,044 releases twice, and either way
`task://progress` would have two producers whose labels overwrite each other.

It reads both settings between releases and not only on waking, so turning one
off cancels its own step in a pass that is running and leaves the other going; a
setting that cannot be read is logged and is not taken for a switch that is off.
Above `score::UNATTENDED_THRESHOLD` the lookup writes the release's tags; below
it, it records the release for a person to decide and writes nothing — and the
release is filed either way, from its own tags, because waiting for an identity
that is never coming is a release that never moves.

**Two ways over that bar, because the two scores measure different halves.** The
fetched score takes the text match for granted and spends its weight on the
per-track durations; the search score is the text MusicBrainz actually matched
and knows nothing of the lengths. A release the search answered with exactly one
candidate is written when *that* score clears the threshold, because a single
candidate is nothing the durations could be telling apart and a queue entry
offering a choice of one is the clicking the pass exists to avoid. The track
count still has to agree on either path — the write maps tracks onto files by
position. A write that took the second path logs `sole=true`, without which its
`score` field reads as a threshold that leaks.

**What is left to do is derived, not recorded.** `library::survey` walks the
library once, groups consecutive rows into releases and asks two questions of
each: whether `release_lookup` has a row, and whether every file of it already
sits at the target `library::mover` would compute. No resume table and no
migration: the state is in the paths, so it survives a quit, a kill and the
setting being turned off and on again. A release that will not move is logged,
skipped and not offered again for the length of that run; the release the player
has a file open on goes to a tail tried once at the end of the sweep.

**A lookup that rewrites a release's tags renames it, and the sweep carries the
new name.** The key the survey found the release by stops naming anything the
moment the write lands, so the set of what this run has been through takes the
name the release ends its visit with — otherwise the next batch's survey hands
the same release back under its new name and searches it a second time. The
deferral carries it for the same reason: one filed under the name the release
arrived with finds no files and leaves the release where it is. Finding no rows
under a name is its own outcome rather than a move of nothing, so a sweep cannot
count it as a release filed.

**A lookup that exhausts its three attempts defers the release the same way
rather than ending the sweep's lookups.** One 503 says nothing about the next
request — something near a third of requests to MusicBrainz are declined, so
three in a row is ordinary — and parking the step on the first one left 34 of
38 sweeps in an evening ending within five seconds of it.

**Both kinds of deferral are drained at the end of every batch**, not at the end
of the sweep: a sweep runs the library to exhaustion, about ninety hours, so a
tail would strand an album the user is playing for the length of one and would
hold every declined release in the library by the time it ran. A release still
playing goes back on the list and is asked again next batch — the player holds
at most the playing track and the prepared next, so that list cannot grow — and
one that declines a second time is dropped, which keeps no row, so the next
sweep has it back. The drain refuses to place a release whose lookup never
reached it: filing it under the tags the lookup was about to replace is a
release the next sweep moves again. The backstop against a network that really is down
is a run rather than the first failure — three consecutive failures park the
lookup for the rest of the sweep, and any lookup that reaches a verdict resets
the count.

**The run counts only failures the service did not answer.** A 503 is
MusicBrainz replying, and it replies that way from three separate buckets, so
nothing about the next request can be read off one: a decline defers its release
and counts in `failed`, and never touches the run in either direction. That is
the whole of the exception — every other status is a gateway or a proxy
answering rather than the service, and will go on answering the same way, as
will a database that is locked. Counting declines made the threshold trip six
times in six hours on a service that answered every time.

**The run outlives the sweep it parked.** A count that opened at zero every
sweep could not detect an outage at all: the next sweep comes fifteen seconds
later while there is placement work, and would spend another three lookups
learning the same thing. Parking does not carry, so each sweep probes with one
lookup — a verdict clears the run, a failure parks it again. `run` on the sweep
line is what the threshold is read back against, and sits at zero on a network
that is up; `failed` beside it says what the declines cost, which is not the
same question.

**Each release it touches announces itself on `library://changed`** — written,
queued or moved, once per release rather than once per step, and per release
rather than per sweep, because a sweep runs for hours and may not end at all,
and a view told only at the end of one is a view that never hears. Queuing counts
because the sidebar's review count is drawn from that row. `commands::invalidate`
is what keeps it affordable. A dry run announces nothing, having written nothing
and moved nothing.

**The Library folder is a watch folder, and cannot stop being one while the
filing is on.** `scan::plan` marks missing every known row it did not walk, so a
library organised into a folder nobody watches is a library marked missing in
full on the next scan. Picking a root adds it to `watch_folders` and
`scan::remove_watch_folder` refuses it until the switch goes off.

**An OS drop makes no rows.** `library::ingest` watches the folders it was
given, houses the loose files, lifts the tombstone each file ends on, and stops
there; the scan the frontend runs behind it is what inserts, from tags it reads
itself. So there is never a row pointing outside every watch root - the order is
move, then scan, not insert then move. A file already under a root does not move
at all, and one that is not needs the Library folder on, because there is
nowhere else to put it. It lands at the root's **top level** rather than at
83a's target: that layout is a function of a release, and a file with no row
cannot answer it without giving a second answer to where a file goes.
`library::worker` files it properly on its next sweep.

**It also reports where it stands on `task://progress`**, per release attempted
and `null` when the sweep ends, whatever ended it. Its own channel rather than
one of the per-write ones: this is a task measured in days, drawn at the foot of
the sidebar for its whole life, and the payload carries a label because that
label names which steps are switched on. The total is what the survey found left
to do, which is the number the fraction reaches. The estimate comes from the last
hundred releases rather than from the whole pass — one whose files already carry
an MBID costs nothing and a searched one costs two rate-limited requests, and a
sub-second move beside a ten-second lookup is only more of that, so an average
over the run describes a pass that is not the one running.

**Waking and sweeping are two cadences.** The switches are answered every fifteen
seconds because that is what makes them feel immediate, and it costs two keyed
rows. A sweep sorts every row in the library, so the gap
between sweeps doubles — to a ten-minute ceiling — whenever one finds nothing to
do or ends on a failure, and snaps back to fifteen seconds the moment one gets
through releases. A release a scan has just added therefore waits up to ten
minutes, which is nothing beside a pass measured in hours.

**The limiter holds one request at a time, a second and a half apart.** A
little over the one a second
[MusicBrainz documents](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
They decline with a 503 from three separate buckets — per user agent, per
address and a global three hundred a second — so a client inside its own
allowance still meets 503s when theirs is full, indistinguishably, and no
interval can prevent those. Between 1.1s and 5s slowing down bought nothing
measurable: releases reached before the first fatal 503 were 72 at 1.1s, 26 at
3s and 35 at 5s. Ten and then twenty seconds were picked past the end of that
measurement anyway, on the argument that the pass should ask as little as it
can; neither was measured, and ten left every sweep over the real library
ending on a release whose three attempts were all declined. So the interval is
the documented rate plus headroom, and the declines it cannot prevent are the
retry's problem — what it buys is a pass measured in hours rather than days,
which is the only number the interval controls. The gate is held for the whole request rather than
only the gap before it, so the interval is measured from when an answer came
back; a request that could work later is asked again twice, with the limiter
rather than the caller deciding how long that takes — and the count of those goes
in the log, on the release line and totalled on the sweep line, because a retry
that works leaves no other trace and the interval it costs reads as a slow
request.

`APEX_LOOKUP_DRY_RUN` runs the whole thing and writes neither files nor rows,
which is how the threshold is tuned against a real library. **The library is the
real pass's cursor and cannot be the dry run's** — it writes no rows and moves no
files, so every survey would hand it the same release. It keeps its own set of
what it has reported on instead, skips the tag seed (the one row it would
otherwise leave behind), and logs `would-write`, `would-queue` and `would-move`
where a real pass logs `written`, `queued` and `moved`. That set is the thread's
rather than the sweep's, so a sweep that ended early does not send the rehearsal
back to the first release.

**Every write long enough to notice runs on a worker thread**, through
`commands::blocking`, and reports on a channel of its own: a scan on
`scan://progress`, a tag edit on `tags://progress`, an export on
`export://progress`, a last.fm import on `lastfm://import`. The domain functions take an `on_progress` closure rather
than a Tauri handle, so each stays testable with no running app.

`task://progress` is not one of those four. Those report on writes that finish
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
  passes that found nothing), the cover-normalize, MusicBrainz-id and
  album-regroup passes, and each scrobble and now-playing submission.
- **One line per release the pass resolves or queues** (`lookup.release`, with
  the score), one per release it moves (`library.place`, with the counts), and
  one per sweep (`pass.sweep`). **Silence for a release
  MusicBrainz has nothing for** — eight thousand lines about what was written is
  nothing next to a threshold that cannot be diagnosed after the fact, and eight
  thousand more about records nobody has heard of is noise. Those silences
  break the failure runs the file appears to hold, which is why the run itself
  is on the sweep line and is not counted off `lookup.release`.
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

Reachable from Settings ▸ About ▸ Activity Log, which reveals it through `reveal.rs`
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
`settings` keys, and silent, since the picture on screen does not change.

The same thread then sweeps, every launch and behind no flag: a track removal,
a tag write that replaces or drops artwork, and a rescan of a file retagged
outside the app each leave a row nothing points at, and an orphan is 37 KB.
The sweep takes the scan lock, because `covers::store` returns a hash it found
without writing anything and so holds no write lock of its own. It is only
safe because nothing reads artwork back out of `covers` at all — the bytes go
to the window and nowhere else.

`VACUUM` is what actually returns the pages to the filesystem, and it is
gated on `freelist_count × page_size` passing 32 MB: it cannot run in a
transaction and rewrites the whole file, so a gigabyte of rewriting to reclaim
one orphan is not a trade worth making on every launch. The lock is dropped
before it, since it moves no row.

The `musicbrainz-tags` thread beside it reads the release and release-group
ids and the release type off every file once, for the reason
[the data model](data-model.md) gives. It takes the scan lock a chunk at a
time, so a scan or a move cannot rewrite a row between the read and the write.
Nothing announces: the columns it fills are read by the lookup pass and the
mover rather than drawn anywhere.

The `album-regroup` thread is the third of these, and the smallest: it folds
the play log's album spellings together once per `plays::FOLD_VERSION`, off a
`settings` marker in the same shape. No scan lock — it reads `plays` and
writes `album_groups`, and touches neither a file nor a track row — and
nothing announces, because the Statistics view reads the grouping when it next
opens. The fold itself is in [the data model](data-model.md); what matters
here is that a library which has already imported its history would otherwise
never run the pass again, so the fold carries a version rather than a flag.

A replacement cover travels to the backend as a **path** (`CoverEdit::Replace`),
whichever way it was chosen, and either way **stages**: `stage_picked_cover`
copies the named file — picked or dropped, since an OS drop carries a path —
checking it first and writing the same fixed-name file into the cache directory.
The save re-reads and re-checks it like any other path.

Staging is what makes a pending choice previewable: the webview
cannot read a path, so `cover://staged` — the one path under that protocol that
is not a hash — serves the staging file, `no-store`, with a version in the query
string, since the file's name is fixed and its contents are whatever was chosen
last.
