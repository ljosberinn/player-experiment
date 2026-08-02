# iTunes-inspired local music player — implementation plan

## Context

A **local-only desktop music player** whose layout and information density echo
iTunes 11 (source sidebar / centered LCD status display / segmented tab bar /
dense sortable table), styled in a modern flat idiom rather than
skeuomorphically.

The hard constraint is scale: a library of **tens of thousands of mp3s** must
load fast, use little RAM, search instantly, and support bulk tag edits. That
constraint drives every decision below — SQLite as the source of truth (never an
in-memory array of tracks), row virtualization, paged queries, and audio
decoding off the webview thread.

Out of scope permanently: movies, TV shows, podcasts, apps, tones, store, device
sync. No code signing (local-only).

### Decisions taken

| Area | Choice |
| --- | --- |
| Shell | Tauri v2 (Rust core + webview) |
| Frontend | React 19 + TypeScript + Vite, TanStack Table/Virtual, Zustand |
| Audio | Rust: `symphonia` decode + `rodio`/`cpal` output, IPC-controlled |
| Storage | SQLite (`rusqlite`, bundled) + FTS5 |
| Tags | `lofty` — atomic temp+rename writes, plus an undo journal |
| Library sync | Manual/explicit scan, incremental by (mtime, size) |
| UI | iTunes 11 layout, modern flat styling, dark mode |
| CI | Full gate on every PR |

---

## Architecture

```
src-tauri/                     Rust core (the "engine")
  db/         rusqlite, migrations, FTS5, queries
  scan/       walkdir + rayon ingest, incremental
  tags/       lofty read/write, atomic writer, undo journal
  audio/      symphonia + rodio player thread, command/event channels
  smart/      filter-tree -> parameterized SQL compiler
  export/     JSON export
  commands/   #[tauri::command] surface (thin; delegates to modules above)
src/                           React frontend
  features/library|playlists|player|editor|search
  components/ui/               chrome primitives (sidebar, LCD, tabbar, table)
  ipc/                         typed wrappers over invoke/listen
```

**Rule:** `commands/` is a thin, testable seam — argument parsing plus
delegation only, so the domain modules stay unit-testable without a Tauri
runtime. Types are declared once in Rust (`ts-rs` derive) and emitted to
`src/ipc/bindings/`; the frontend never hand-writes an IPC payload type.

**Threading:** one dedicated audio thread owns the `rodio` sink and receives an
`mpsc` command enum (`Play(track_id) | Pause | Resume | Stop | Seek(ms) |
SetVolume(f32)`); it emits `player://position` (throttled ~4/s),
`player://state`, `player://ended` Tauri events. Scanning runs on a `rayon` pool
and emits `scan://progress`. Neither ever blocks a command handler.

### Data model (SQLite)

- `tracks(id, path UNIQUE, mtime, size, duration_ms, title, artist, album,
  album_artist, genre, year, track_no, disc_no, comment, bitrate, sample_rate,
  has_cover, added_at, play_count, last_played_at)`
- `covers(hash PRIMARY KEY, mime, bytes)` + `tracks.cover_hash` — dedupes album
  art across a whole album. Cover bytes are **never** part of a row payload over
  IPC; they are served through a custom `cover://<hash>` protocol handler so the
  webview caches them.
- `playlists(id, name, kind: 'static'|'smart', filter_json, sort_json,
  columns_json, created_at)`
- `playlist_tracks(playlist_id, track_id, position)` — static playlists only;
  gapped `position` integers so a drop is one UPDATE, not a table renumber.
- `tag_undo(id, batch_id, track_id, prev_tags_json, applied_at)`
- `tracks_fts` — FTS5 external-content table over
  title/artist/album/album_artist/genre/comment, kept current by triggers.
- `settings(key, value)` — watch folders, volume, last view, window geometry.

Indexes on `(album_artist, album, disc_no, track_no)`, `(artist)`, `(year)`,
`(added_at)`.

### Smart playlists

A persisted filter tree, not a SQL string:

```ts
type Rule = {
  field: TrackField;
  op: "eq" | "neq" | "contains" | "startsWith" | "gt" | "lt" | "between" | "inLast";
  value: JsonValue;
};
type Group = { combinator: "and" | "or"; children: (Rule | Group)[] };
```

`smart/compile.rs` turns a `Group` into a parameterized `WHERE` clause plus a
bind vector. Because the query runs against live tables, "all albums by X after
2012" self-updates the moment new tracks are ingested — no materialization, no
invalidation logic. The compiler rejects unknown fields (whitelist enum) so no
user input reaches SQL as text, and nesting depth is capped to bound recursion.

### Table performance

- Per page: `SELECT … WHERE <filter> ORDER BY <sort> LIMIT ? OFFSET ?` behind a
  small window cache in the frontend; TanStack Virtual renders ~40 rows
  regardless of library size.
- Row count comes from a separate `COUNT(*)`, so the scrollbar is correct
  without loading rows.
- Selection is an id `Set` plus an anchor for shift-range, so "select all 50k"
  never materializes 50k row objects.
- The "global playlist" (Music) is simply the unfiltered query — no special case.
- Per-playlist visible/ordered columns live in `playlists.columns_json`; the
  global view stores its own row in `settings`.

---

## Branch & CI workflow

`main` is off limits — PR only. One feature branch per phase
(`feat/01-scaffold`, `feat/02-db-scan`, …), squash-merged via PR.

Server-side protection is unavailable: GitHub gates branch protection *and*
rulesets behind Pro for private repositories, so the API returns 403 for both.
A `.githooks/pre-push` hook refuses pushes to `main` instead, wired up by the
`prepare` npm script. It is advisory only — see the README. Applying a real
ruleset is a one-liner once the repo is public or on a paid plan.

`.github/workflows/ci.yml` runs on `pull_request` and `push: main`:

1. **frontend** (ubuntu) — `tsc --noEmit` for `src/` and `e2e/`, Biome check,
   `vitest run --coverage` against an 80% threshold.
2. **rust** (windows) — `cargo fmt --check`, `cargo clippy --all-targets -D
   warnings`, `cargo test`, and a check that the committed `src/ipc/bindings/`
   still matches the Rust types.
3. **cargo-deny** (ubuntu) — advisories, licenses, sources, bans.
4. **e2e** (windows) — `tauri build --debug --no-bundle` plus a
   WebdriverIO/`tauri-driver` smoke suite.

Caching: `Swatinem/rust-cache`, `actions/setup-node` npm cache. A concurrency
group cancels superseded runs.

**Inspecting CI state** — `gh` is installed and authenticated, so no extra
tooling is needed: `gh pr checks <n>`, `gh run list --branch <b>`,
`gh run watch <id>`, `gh run view <id> --log-failed`.

**CI is the gold standard for e2e.** The WebDriver suite is not run locally;
`tauri-driver` hangs on this machine and has to be killed manually. Diagnose e2e
through Actions logs and artifacts instead.

---

## Testing strategy

| Layer | Tool | What |
| --- | --- | --- |
| Rust unit | `cargo test` | smart-filter → SQL compilation (incl. injection attempts, depth cap), incremental-scan diffing, playlist reordering math, JSON export shape |
| Rust integration | `cargo test` + `tempfile` | temp SQLite: migrations up, ingest a fixture dir, FTS search hits, tag write → re-read round-trip, undo restores prior bytes, atomic write survives a simulated failure |
| Audio | `cargo test` | player state machine against a mock sink trait — transitions, seek and volume clamping; decode/output is not asserted in CI |
| Frontend unit | Vitest | filter-tree editor reducer, selection model, column config, formatting |
| Frontend component | Vitest + RTL | table (mocked IPC): sort, multiselect, keyboard nav, drag-to-playlist; tag editor incl. mixed-value bulk fields; transport controls |
| E2E | WebdriverIO + `tauri-driver`, CI only | launch, scan a fixture folder, play, edit a tag, create a playlist |
| Perf guard | `cargo test` | ingest 10k synthetic rows and assert a sorted page query plus count stays inside a fixed budget |

Fixture mp3s are generated by a script (silent audio, known tags) and committed,
so tag round-trip tests are deterministic and no copyrighted audio enters the
repo.

---

## Status — 2026-08-02

Phases 1–3 are merged to `main`; phase 4 (playback) is in review. Next up is
**phase 5 (search)**.

| | Phase | State |
| --- | --- | --- |
| 1 | Scaffold + CI gate | ✅ merged (`75dd29c`) |
| 2 | Library core: schema, scan, queries | ✅ merged (`571b5c7`) |
| 3 | Shell UI: chrome + virtualized table | ✅ merged (`423d029`) |
| 4 | Playback: engine, transport, play counts | 🔄 in review (`feat/04-audio`) |
| 5+ | Search onwards | not started |

**What works today.** Point the app at a folder, scan it, and browse the result:
sortable virtualized table over a paged SQL query, FTS5 search from the toolbar,
multi-select, cover art over the `cover://` protocol, live scan progress. With
phase 4, double-clicking a row plays the whole view from that point: transport
buttons, a draggable scrubber, volume that survives a restart, automatic queue
advance, and play counts written back to the library.

**Test counts.** 93 Rust (72 unit, 16 integration against generated mp3s,
5 perf guards) and 166 frontend at 99.4% lines. CI runs
frontend / rust / cargo-deny / e2e on every PR; all four green on `main`.

### Decisions taken since this plan was written

- **Custom title bar.** `decorations: false` with our own drag region and
  window buttons, so transport, status display and search share one bar.
- **Placeholder rows.** Pages not yet fetched render skeleton rows; scrolling
  never blocks on IPC. Pages beyond a radius of the viewport are evicted, which
  a test pins by walking all 250 pages of a 50k library.
- **`all_track_ids` command.** "Select all" needs ids, not rows — routing it
  through the paged query would have silently capped a 50k selection at 1000.
- **`i64` fields are annotated `number`, not ts-rs's default `bigint`.** These
  cross as JSON and `JSON.parse` never produces a bigint, so the default
  described a value the frontend never receives.
- **Real `<table>` markup**, not divs with ARIA roles, after Biome's a11y rules
  correctly objected. `aria-rowcount` carries the true library size even though
  only a window is in the DOM.
- **Git hooks** (`.githooks/`, wired by the `prepare` script): pre-commit runs
  Biome on staged files and `cargo fmt --check`; pre-push adds repo-wide Biome,
  typecheck and rustfmt on top of the `main` block. Added after a Biome failure
  reached CI because its exit code went unread locally.
- **The play queue is a list of ids sent to Rust**, not a view the backend
  re-derives. `player_play` takes the ordered ids of the current view plus the
  index that was activated; paths and durations are looked up backend-side, so
  a queue can never carry stale metadata.
- **One `rodio::Player` per track**, dropped and recreated on each load, rather
  than one long-lived player with an append queue. `Player::clear` blocks until
  the mixer drains and `Drop` already stops the sound, so per-track is both
  simpler and cheaper than working around the queue semantics.
- **A missing audio device is not fatal.** `RodioSink::open` failing puts a
  null sink behind the same interface and reports the reason on
  `player://error`, so the app still runs (headless CI is exactly this case)
  and the user gets the message on first play rather than silence.
- **"Played" means 50% of the track**, matching the last.fm rule in phase 10 so
  play counts and scrobbles can never disagree about what counts.

### Known gaps carried forward

- **e2e runs against a decorated window.** `decorations: false` stops the
  embedded WebDriver from ever seeing the Tauri webview — scripts execute but
  `__TAURI_INTERNALS__` never appears, so the harness times out. `tauri.wdio.conf.json`
  therefore pins `decorations: true` for the e2e build only. Cost: the frameless
  window, custom title bar, drag region and window buttons are **not covered
  end-to-end**; they have component tests only. Worth revisiting if
  `@wdio/tauri-service` gains a fix.
- **`@wdio/native-utils` is pinned via `overrides` to 2.5.0.** `@wdio/tauri-service@1.2.0`
  imports a symbol from the 2.4.0 it pins, which 2.4.0 does not export — the
  package cannot be imported as published. Drop the override once upstream
  repins.
- **Footer totals are counts only.** Duration and size need a library-wide
  aggregate query that does not exist yet.
- **Column reorder/resize** is data-driven in `columns.ts` but has no UI.
- **`main` is not protected server-side** — GitHub gates that behind Pro for
  private repos. The pre-push hook is advisory only.
- **No audio is asserted end to end.** GitHub's Windows runners have no output
  device, so CI exercises the engine, the queue and the IPC surface against a
  fake sink and only checks that the transport is live in e2e. Decoding is
  covered — the integration tests run every fixture mp3 through the shipped
  `rodio`/symphonia decoder — but "sound actually came out" is a manual check.
- **Nothing repeats or shuffles yet**, and there is no visible queue: the queue
  is whatever view was playing from. Both are natural additions once playlists
  land in phase 6.

---

## Implementation phases

Each phase is one branch and one PR, green CI required.

**1 — Scaffold** `feat/01-scaffold` — ✅ **merged** ([PR #1](https://github.com/ljosberinn/player-experiment/pull/1))
Tauri v2 + Vite + React + strict TS, Biome, Vitest, ts-rs binding generation,
the CI workflow, `cargo-deny` policy, branch protection. Deliverable: window
opens, CI green.

**2 — Library core** `feat/02-db-scan` — ✅ **merged** ([PR #2](https://github.com/ljosberinn/player-experiment/pull/2))
Migrations, the schema above, `walkdir` + `rayon` scan with `lofty` tag read,
cover extraction/dedupe, incremental rescan, `scan://progress` events. Commands:
`add_watch_folder`, `scan`, `query_tracks`, `count_tracks`. The perf guard lands
here.

**3 — Shell UI** `feat/03-shell` — ✅ **merged** ([PR #3](https://github.com/ljosberinn/player-experiment/pull/3))
Sidebar, LCD status display, segmented tab bar, virtualized table with
resizable/reorderable/toggleable columns, sorting, selection model, scan
progress. Reads real data from phase 2.

**4 — Playback** `feat/04-audio` — 🔄 **in review**
Audio thread, transport (play/pause/stop/next/prev), seek via the LCD scrubber,
volume, position events, play counts, keyboard shortcuts.

*As built.* `src-tauri/src/audio/` splits into `engine.rs` (a passive state
machine: queue advance, seek clamping, the 50% play-count rule, giving up after
five unreadable files in a row), `sink.rs` (the `AudioSink` trait plus the
`rodio` and null implementations) and `mod.rs` (the thread that ticks the engine
every 250 ms and forwards events). Nothing in `audio/` knows about Tauri or
SQLite; `lib.rs` wires events to `player://state`, `player://position` and
`player://error`, and writes play counts. Volume persists through the `settings`
table. Frontend: `src/features/player/` (store, shortcut mapping, window-level
key handler), a real `<input type="range">` scrubber, and row activation by
double-click or Enter.

**5 — Search** `feat/05-search`
FTS5 triggers, debounced search box scoped to the current view, ranked results.

**6 — Playlists** `feat/06-playlists`
Static playlist CRUD, drag-and-drop of a multi-selection onto a sidebar
playlist, reordering within one, per-playlist column config.

**7 — Smart playlists** `feat/07-smart`
Filter-tree editor UI (nested and/or groups), the SQL compiler, live
re-evaluation.

**8 — Tag editing** `feat/08-tags`
Single and bulk editor (mixed-value "—" fields that only write when touched),
cover art replace/remove, atomic writer, undo journal and an "Undo last edit"
affordance. DB rows update in the same transaction as the file write batch.

**9 — Export & polish** `feat/09-export`
JSON export (full library / selection / playlist, documented stable schema),
settings persistence, window geometry, dark mode pass, empty and error states.

**10 — last.fm scrobbling** `feat/10-lastfm`
Depends on phase 4 (playback), since both triggers are positions in a track.

- **Now playing**: after **5 seconds** of continuous playback, send
  `track.updateNowPlaying`. Fire-and-forget — it is not queued or retried,
  because it describes a moment that has passed by the time a retry lands.
- **Scrobble**: once playback passes **50% of the track's length**, submit
  `track.scrobble` with the timestamp the track *started*. One scrobble per
  play; seeking backwards past the threshold must not submit twice.
- **Credentials**: a settings pane takes the user's last.fm API key and shared
  secret, then runs the desktop auth flow (`auth.getToken` → open the
  authorize URL in a browser → `auth.getSession`) to obtain a session key.
  Only the session key is needed after that.
- **Storage**: credentials live in `settings`, not in exported JSON. The
  export writer must have an explicit denylist so a key cannot leak into a
  library export.
- **Offline queue**: scrobbles that fail to send are persisted in a
  `scrobble_queue` table and retried on the next successful call. `now playing`
  never enters the queue.
- **Signing**: every authenticated call needs an `api_sig` — an md5 of the
  sorted parameters plus the shared secret. Wrong ordering is the classic
  failure here, so the signature builder gets its own unit tests against
  known-good vectors.

Testing: the last.fm client is written against an injected HTTP transport so
every test runs offline — trigger timing (5s / 50%, no double-submit on
seek-back), signature construction, queue-and-retry on failure, and that a
too-short or skipped track produces neither call. A single opt-in test hitting
the real API stays `#[ignore]`d.

**Note on scope**: this is the product's first outbound network dependency —
everything else is local-only. It must stay entirely optional: with no
credentials configured, no request is ever made and no code path changes.

**Note on last.fm's own rule**: the service's documented guidance is to
scrobble at 50% *or 4 minutes, whichever comes first*, and to skip tracks
under 30 seconds. **The 4-minute cap is explicitly not adopted** — 50% is the
sole trigger, so an hour-long mix scrobbles at 30 minutes, not at 4. Decided
2026-08-02. This is also the rule `audio/engine.rs` already counts plays by
(`PLAYED_FRACTION`), and the two must not drift apart.

The 30-second floor is a separate question and is still worth adding: it costs
nothing and matches what every other client does.

**11 — Crash & error reporting** `feat/11-sentry`
Optional, opt-in Sentry integration via
[`tauri-plugin-sentry`](https://github.com/timfish/sentry-tauri) (crate
`tauri-plugin-sentry`, npm `tauri-plugin-sentry-api`). Depends on nothing;
sequenced last because it is diagnostics, not product.

*Why it fits.* The plugin initializes `@sentry/browser` in the webview but
routes its events and breadcrumbs **through Rust over `invoke`** rather than
over HTTP. That gives three things a plain browser SDK cannot:

- One event stream. A React render error and a `rusqlite` failure during a 50k
  scan land in the same issue list with the same OS/device/release context, and
  breadcrumbs from both sides are merged into one timeline.
- Native crash reports. The optional `minidump` feature (via
  `sentry-rust-minidump`) captures hard crashes — the audio thread, `symphonia`
  decode on a malformed mp3, a panic inside the `rayon` scan pool. This is
  exactly the failure class that is otherwise invisible: the window disappears
  and no JS handler ever runs.
- No CSP change. Because the browser transport is IPC, `connect-src` never has
  to be opened to `*.sentry.io`; the current `default-src 'self'` policy stands
  as written.

*Steps.*

1. `src-tauri/Cargo.toml`: `sentry = "0.42"`, `tauri-plugin-sentry = "0.5"`
   (with `features = ["minidump"]` once step 6 is decided). **`sentry` must be
   pinned to 0.42** — see the version-lag note below.
2. `npm i tauri-plugin-sentry-api` (only needed for the manual-init path in
   step 5; the default injection path needs no npm package).
3. Add `"sentry:default"` to `permissions` in
   [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json).
4. In [src-tauri/src/lib.rs](src-tauri/src/lib.rs), before
   `tauri::Builder::default()`: build the client with `sentry::init`, hold the
   guard for the process lifetime, then `.plugin(tauri_plugin_sentry::init(&client))`.
   Set `release` from `env!("CARGO_PKG_VERSION")` and `environment` from the
   build profile so dev noise is separable.
5. Decide injection: default auto-injection is one line; `init_with_no_injection()`
   plus a frontend `Sentry.init({ ...defaultOptions })` is needed to add
   `tracesSampleRate`, `beforeSend`, or the React error-boundary integration.
   Prefer the manual path — the scrubbing in step 8 has to run on both sides.
6. Minidumps: `tauri_plugin_sentry::minidump::init(&client)` **restarts the
   current executable** in crash-reporter mode, so everything above that call
   runs twice. Keep it as the first statement in `run()`, and verify it against
   the `wdio` feature build before enabling it in CI.
7. DSN: read from a build-time env var (`option_env!`), not a literal. It is not
   a secret, but absent-DSN must be a supported state — see step 8.
8. **Opt-in and scrubbing.** This is the second outbound network dependency
   after last.fm, and the more sensitive one: file paths, folder names, track
   titles and artists are personal data, and Sentry captures them incidentally
   through error messages, breadcrumbs and `rusqlite` errors carrying a path. So:
   a settings toggle defaulting to **off**, no client initialized at all while
   it is off, and a `before_send`/`before_breadcrumb` pair that replaces any
   absolute path with its basename hash and drops event `extra` wholesale. The
   `settings` denylist that already keeps last.fm credentials out of JSON export
   covers the DSN too.
9. `deny.toml`: `sentry` pulls in `reqwest` and a TLS stack, so re-run
   `cargo deny check` and expect new advisories/licenses to triage. Licenses are
   fine as-is (`tauri-plugin-sentry` and `sentry-rust-minidump` are
   `MIT OR Apache-2.0`, `sentry` is `MIT` — all already on the allow list).
10. Tests: `before_send` scrubbing gets unit tests against fabricated events
    containing a real-looking Windows path; a disabled-toggle test asserts no
    client is constructed. Nothing in CI may talk to sentry.io.

*Caveats, weighed.*

- **Version lag.** `tauri-plugin-sentry` 0.5.0 (Sept 2025) pins `sentry ^0.42`
  while `sentry` is at 0.49. Taking the plugin means holding `sentry` back two
  years of releases, and the two must agree or the shared types stop lining up.
- **Unreleased fix on master.** The most recent commit (Feb 2026, "disable
  tauri's default features") is not in any published version. Consuming it needs
  a git dependency, which `deny.toml`'s `[sources] unknown-git = "deny"` forbids
  — relaxing that is a deliberate decision, not a workaround to slip in.
- **Maintenance.** Single-maintainer project, 234 stars, ~126k recent crate
  downloads, no release in 11 months. Healthy enough to adopt, not healthy
  enough to depend on for a fast Tauri-3 or `sentry` 0.5x migration.
- **The minidump child process** is a second copy of the app in the process
  list; expect antivirus curiosity on Windows and a conversation with the e2e
  harness. Without the `ipc` feature, native crashes arrive with no breadcrumbs,
  user or tags — bare stack only.
- **Alternative if the above sours:** `@sentry/browser` in the webview plus
  `sentry` in Rust, initialized independently. Loses the merged context and the
  CSP-free transport, gains an unpinned `sentry` and one less dependency to
  track. Worth keeping in the back pocket.

**12 — Online tag lookup (MusicBrainz + Discogs)** `feat/12-tag-sources`
Depends on phase 8 (tag writing) — this only produces a candidate tag set; phase
8's atomic writer and undo journal apply it.

*How Mp3tag does it, and whether we can.* Mp3tag's mechanism is public, not
reverse-engineered: the [Web Sources
Framework](https://docs.mp3tag.de/tag-sources/development/) reads plain-text
`*.src` (plus optional `*.inc`/`*.settings`) files from a `sources` folder. Each
declares `[BasedOn]`, `[IndexUrl]` (the search endpoint, `%s` = user input),
`[AlbumUrl]`, `[Encoding]`, `[WordSeparator]`, then a small stack-based parser
script that walks the response; since the JSON extension (`json_foreach`,
`json_select`, `json_select_many`) it prefers a site's JSON API over scraping
its HTML. The shipped `Discogs.src` is exactly this, pointed at the public
Discogs API. So Mp3tag has no private arrangement with either service — it is an
ordinary API client with a data-driven request/parse layer.

We should **call the same public APIs directly** from Rust rather than port the
`.src` DSL. The DSL exists so non-programmers can add sources without a rebuild;
our equivalent is two typed clients, and that trade only flips if we ever want
user-contributed sources.

- **MusicBrainz** — no authentication for reads. `GET
  /ws/2/release?query=…&fmt=json` to search, `GET
  /ws/2/release/<mbid>?inc=recordings+artist-credits+labels&fmt=json` for the
  tracklist. Free for non-commercial use. Two hard rules: **max 1 request/sec**
  (IP-level, exceeding it gets the IP blocked) and a **meaningful User-Agent**
  identifying the app, version and a contact URL. Both go in the client, not at
  call sites — a shared rate-limiter guard, and a UA built from
  `CARGO_PKG_NAME`/`CARGO_PKG_VERSION`.
- **Cover art** — [Cover Art Archive](https://musicbrainz.org/doc/Cover_Art_Archive/API),
  keyed by the same release MBID (`https://coverartarchive.org/release/<mbid>`).
  No auth, no key. Feeds straight into the existing `covers` table and
  `cover://<hash>` protocol.
- **Discogs** — richer for electronic/vinyl releases, but authentication has
  been mandatory since Aug 2014. 25 req/min unauthenticated, 60 req/min
  authenticated; **image URLs require authentication at all**. Registering an
  app is free. The wrinkle for an open-source client is that OAuth 1.0a wants a
  consumer key *and secret* baked into the binary, where it is not actually
  secret. Avoid that: use **Discogs personal access token**, entered by the user
  in the same settings pane as the last.fm credentials and stored the same way
  (`settings`, on the export denylist). Discogs then stays a strictly opt-in
  second source, and the feature is fully useful with MusicBrainz alone.

*Cost:* nothing. Both services are free at this scale; only Discogs needs the
user to hold an account.

*Shape.* `src-tauri/src/tagsource/` with a `TagSource` trait
(`search(query) -> Vec<ReleaseSummary>`, `fetch(id) -> ReleaseDetail`) and one
impl per provider, over an injected HTTP transport so tests run offline exactly
like the last.fm client. Commands: `tagsource_search`, `tagsource_fetch`. The UI
mirrors Mp3tag's flow because it is the right one — search per album, pick a
result, then a **confirm dialog** mapping remote tracks to selected files (with
manual reorder) and per-field checkboxes, so nothing is written unreviewed.
Never automatic, never bulk-applied without confirmation.

*Testing:* recorded JSON fixtures for search/lookup parsing incl. multi-disc and
various-artists releases; the rate limiter asserted to serialize concurrent
calls at ≥1s spacing; a missing/404 cover treated as "no cover", not an error;
UA header asserted present. One `#[ignore]`d live test per provider.

*Note on scope:* third outbound network dependency, and like the other two it
must be inert when unused — no request unless the user opens the lookup dialog.

**13 — Native feel pass** `feat/13-native-feel`
A dedicated pass over the whole UI to stop it reading as a web page in a
window. The tells are mostly things to *remove*:

- **No hover effects.** Rows, cells and list items do not light up under the
  pointer. Hover states are a web affordance for "this is a link"; a desktop
  list communicates through selection and focus instead. Buttons keep a
  pressed state, and genuinely clickable chrome (sort headers, sidebar items)
  keeps focus rings — those are accessibility, not decoration.
- **No transitions or animations** on hover/selection/expansion. State changes
  are instant, the way a native list view changes.
- **Selection, not hover, is the highlight.** Selected rows stay tinted when
  the window loses focus (dimmed, as Explorer and Finder do) rather than
  clearing.
- **Text is not selectable** outside actual text inputs (`user-select: none`
  on chrome and rows), and the caret never appears over a list.
- **No pointer cursor** on non-text UI: `cursor: default` everywhere except
  text fields and drag handles.
- **No browser focus/scroll artefacts**: no bounce or overscroll glow, no
  focus outline on click (`:focus-visible` only), no native drag-image on
  rows, no context menu where the app does not provide one.
- **Density and hit targets** checked against Explorer/iTunes rather than
  against web defaults; system font stack and font smoothing verified on
  Windows.

*Testing:* an assertion pass in the component tests that no rule under the
table/sidebar/chrome selectors declares a `:hover` background, plus a manual
walkthrough on the checklist above. Cheap to test, easy to regress.

*Placement:* deliberately after the features, not before — every phase adds
chrome, and doing this once at the end is cheaper than policing it per PR.

---

## Verification

- `npm run tauri dev` — window opens in under a second to interactive.
- Point it at a real folder of tens of thousands of mp3s: scan reports progress
  and completes; scrolling the full table stays smooth; memory stays flat while
  scrolling (budget: under ~400 MB with a 50k library).
- Play/pause/seek/volume behave; position updates without stutter while
  scrolling.
- Create a static playlist, drag a 200-track multiselection onto it, reorder,
  reload — order persists.
- Create "artist = X and year > 2012", add a matching album to disk, rescan —
  the playlist grows with no manual refresh.
- Bulk-edit genre on 500 tracks, verify with an external tag tool, then undo and
  re-verify.
- Export JSON, validate against the documented schema.
- `cargo test` and `vitest run` pass locally; the full gate incl. e2e passes in
  GitHub Actions.

---

## Open items

- **e2e harness.** External drivers (`tauri-driver` + `msedgedriver`) never got
  past `session not created: DevToolsActivePort file doesn't exist`, with both a
  hand-rolled version-matched driver and the provisioning from Tauri's own
  WebDriver CI. Replaced by `@wdio/tauri-service` on its default `embedded`
  provider, which runs the WebDriver server inside the app and removes external
  drivers entirely. The instrumentation is gated behind the `wdio` cargo feature
  plus a `--config` capability overlay so release builds never contain a
  WebDriver server. Verified building locally; the suite itself is verified in
  CI.
- mp3-only ingest to start; the schema and `lofty` both allow flac/m4a later
  without migration.
- Gapless playback is out of scope for phase 4; the Rust-side engine keeps the
  door open.
- `npm audit` reports a dev-only advisory in `serialize-javascript` via the
  `@wdio/*` chain. Production dependencies are clean; not force-fixing.
