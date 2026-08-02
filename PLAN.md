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

## Implementation phases

Each phase is one branch and one PR, green CI required.

**1 — Scaffold** `feat/01-scaffold` — *in review, [PR #1](https://github.com/ljosberinn/player-experiment/pull/1)*
Tauri v2 + Vite + React + strict TS, Biome, Vitest, ts-rs binding generation,
the CI workflow, `cargo-deny` policy, branch protection. Deliverable: window
opens, CI green.

**2 — Library core** `feat/02-db-scan`
Migrations, the schema above, `walkdir` + `rayon` scan with `lofty` tag read,
cover extraction/dedupe, incremental rescan, `scan://progress` events. Commands:
`add_watch_folder`, `scan`, `query_tracks`, `count_tracks`. The perf guard lands
here.

**3 — Shell UI** `feat/03-shell`
Sidebar, LCD status display, segmented tab bar, virtualized table with
resizable/reorderable/toggleable columns, sorting, selection model, scan
progress. Reads real data from phase 2.

**4 — Playback** `feat/04-audio`
Audio thread, transport (play/pause/stop/next/prev), seek via the LCD scrubber,
volume, position events, play counts, keyboard shortcuts.

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
