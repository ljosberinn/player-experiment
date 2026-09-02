# Architecture

Apex is a local-only desktop music player for libraries of tens of thousands of
mp3s. That scale drives every decision: SQLite is the source of truth (never an
in-memory array of tracks), queries are paged, rows are virtualized, and audio
decoding happens off the webview thread.

Tauri v2 — Rust core plus a WebView2 frontend. The only network at runtime is
the updater and, once an account is connected, last.fm — opt-in, off by default,
and behind a single trait (`lastfm::transport::Transport`) so nothing above it
knows HTTP exists.

```
src-tauri/src/
  db/         rusqlite: schema, queries, playlists, settings, covers, tag values
  scan/       walkdir + rayon ingest, incremental by (mtime, size)
  tags/       lofty read/write, atomic writer, undo journal
  audio/      symphonia + rodio player thread, command/event channels
  smart/      filter tree -> parameterized SQL
  export/     JSON export
  lastfm/     scrobbling: the transport seam, api_sig, the rules, the queue
  commands/   #[tauri::command] surface
  crash.rs    panic hook, bounded log
  palette.rs  dominant colours from cover bytes
src/
  features/   library, playlists, player, editor, smart, shell, updater, crash, export
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

**Every write long enough to notice runs on a worker thread**, through
`commands::blocking`, and reports on a channel of its own: a scan on
`scan://progress`, a tag edit and its undo on `tags://progress`, an export on
`export://progress`. The domain functions take an `on_progress` closure rather
than a Tauri handle, so each stays testable with no running app.

- **The play queue is a list of ids sent to Rust**, not a view the backend
  re-derives: `player_play` takes the ordered ids of the current view plus the
  activated index, and paths are looked up backend-side, so a queue cannot carry
  stale metadata.
- **One `rodio::Player` per track**, dropped and recreated on load. `Drop`
  already stops the sound, so per-track is cheaper than working around append
  queue semantics.
- **A missing audio device is not fatal.** `RodioSink::open` failing installs a
  null sink behind the same interface and reports why on `player://error` —
  headless CI is exactly this case.
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

A replacement cover travels to the backend as a **path** (`CoverEdit::Replace`),
whichever way it was chosen. A dropped image has no path — an HTML5 drop hands
the page a `File` — so `stage_dropped_cover` takes the bytes as the whole invoke
payload, checks them, and writes one fixed-name file into the cache directory,
handing back its path. The bytes cross once, at drop time; the save re-reads and
re-checks the file like any other.
