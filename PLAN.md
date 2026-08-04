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

## Status — 2026-08-04

Everything planned through phase 31 is merged to `main` except the two
external-service phases, which are awaiting a decision rather than work.
**v0.3.0 is released** (PR #28, tag `v0.3.0`); release-please is holding a
0.4.0 pull request open with everything since.

Phase 10 (last.fm) has a plan of its own in `docs/PLAN-lastfm.md` and a
go/no-go question at the end of it. Phase 12 (online tag lookup) has neither
yet.

| | Phase | State |
| --- | --- | --- |
| 1 | Scaffold + CI gate | ✅ merged ([#1](https://github.com/ljosberinn/player-experiment/pull/1)) |
| 2 | Library core: schema, scan, queries | ✅ merged ([#2](https://github.com/ljosberinn/player-experiment/pull/2)) |
| 3 | Shell UI: chrome + virtualized table | ✅ merged ([#3](https://github.com/ljosberinn/player-experiment/pull/3)) |
| 4 | Playback: engine, transport, play counts | ✅ merged (`eb24e87`) |
| 5 | Search: debounce, relevance ranking | ✅ merged (`843cbcf`) |
| 6 | Playlists: CRUD, drag-and-drop, reorder | ✅ merged (`8f10a3d`) |
| 7 | Smart playlists: filter compiler + editor | ✅ merged (`c067f57`) |
| 8 | Tag editing: atomic writer + undo journal | ✅ merged (`571a4c2`) |
| 9 | Export & polish: JSON export, window geometry | ✅ merged (`b26feae`) |
| 10 | last.fm scrobbling | ⬜ not started |
| 11 | Crash & error reporting | ❌ cut, by decision |
| 12 | Online tag lookup | ⬜ not started |
| 13 | Native feel: no web tells, drag badge | ✅ merged (`daae2cf`) |
| 14 | Library totals in the footer | ✅ merged (`e079457`) |
| 15 | Ingest ergonomics | ❌ cut, by decision |
| 16 | Row status column | ✅ merged ([#35](https://github.com/ljosberinn/player-experiment/pull/35)) |
| 17 | Context menus, drop-to-create playlist | ✅ merged (`8caf601`) |
| 18 | Tag and filter autocompletion | ✅ merged ([#39](https://github.com/ljosberinn/player-experiment/pull/39)) |
| 19 | Browse by album, artist and genre | ✅ merged ([#27](https://github.com/ljosberinn/player-experiment/pull/27)) |
| 20 | Column customization | ✅ merged ([#30](https://github.com/ljosberinn/player-experiment/pull/30)) |
| 21 | Density and zoom | ✅ merged ([#33](https://github.com/ljosberinn/player-experiment/pull/33)) |
| 22 | Media keys without focus | ✅ merged ([#32](https://github.com/ljosberinn/player-experiment/pull/32)) |
| 23 | In-app updates | ✅ merged ([#23](https://github.com/ljosberinn/player-experiment/pull/23), fixed in [#34](https://github.com/ljosberinn/player-experiment/pull/34)) |
| 24 | Base UI primitives | ✅ merged ([#36](https://github.com/ljosberinn/player-experiment/pull/36)) |
| 25 | Frontend render pass | ✅ merged ([#38](https://github.com/ljosberinn/player-experiment/pull/38)) |
| 26 | Licence and third-party notices | ✅ merged ([#40](https://github.com/ljosberinn/player-experiment/pull/40)) |
| 27 | Appearance assertions in e2e | ✅ merged ([#44](https://github.com/ljosberinn/player-experiment/pull/44)) |
| 28 | Server-side branch protection | ✅ merged ([#43](https://github.com/ljosberinn/player-experiment/pull/43)) |
| 29 | Local crash log | ✅ merged ([#46](https://github.com/ljosberinn/player-experiment/pull/46)) |
| 30 | A seeded library in e2e | ✅ merged ([#45](https://github.com/ljosberinn/player-experiment/pull/45)) |
| 31 | 150k rows in a real engine | ✅ merged ([#49](https://github.com/ljosberinn/player-experiment/pull/49)) |

**What works today.** Point the app at a folder, scan it, and browse the result:
sortable virtualized table over a paged SQL query, FTS5 search from the toolbar,
multi-select, cover art over the `cover://` protocol, live scan progress. Songs,
Albums, Artists and Genres all navigate (19), columns are per-view configurable
(20), and a file that has gone missing is marked rather than deleted (16).
Double-clicking a row plays the whole view from that point: transport buttons,
a draggable scrubber, volume that survives a restart, automatic queue advance,
play counts, and the four media keys working while the app is behind something
else (22). Right-click menus cover songs and playlists (17). Tag editing writes
through a temp-and-rename with one undo step per edit (8), smart playlists
compile a nested and/or filter to parameterized SQL (7), and JSON export follows
a [documented schema](docs/export-schema.md) (9). The app checks for updates,
downloads quietly, and installs only when the footer button is pressed (23, 34).
Density and zoom are user-controlled (21), and the menus, dialogs, sliders and
popovers are Base UI underneath (24).

**Test counts.** 271 Rust (215 unit, 43 integration against generated mp3s,
13 perf guards) and 653 frontend at 96.7% lines. CI runs
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
- **Searching switches the view to relevance ranking** and restores the previous
  column sort when the box is cleared — unless the user picked a column while
  searching, which is treated as an explicit override.
- **Relevance is a `SortField`, not a flag.** `bm25` is weighted so a title hit
  outranks one buried in a comment, and it ignores the sort direction: there is
  no useful "worst match first". Without a search there is nothing to rank, so
  it falls back to a real column rather than erroring.
- **Every query carries a token.** Responses check it before writing, so a slow
  first search can no longer overwrite the results of a later one — a race the
  paged loader had from the start and that debouncing only made likelier.
- **A playlist is a filter on the same query, not a query of its own.**
  `TrackQuery` gained `playlist_id`, which joins `playlist_tracks`. Paging,
  search-within, column sorting, "select all" and the play queue therefore work
  inside a playlist with no second code path, and `db::query` grew one `Scope`
  builder instead of a third variant of the same statement.
- **`Position` is a `SortField`**, exactly as `Relevance` is: a property of the
  query rather than of a track, valid only when a playlist is joined in, and
  falling back to a real column otherwise so a stored sort is harmless when the
  user clicks back to the library.
- **Placeholders are anonymous `?` bound in order.** The old code numbered them
  and branched on whether a search was present; a third optional clause would
  have made that unreadable. Clauses can now be added or dropped without
  renumbering the ones around them.
- **Positions are gapped by 1024.** A drop between two rows is one UPDATE per
  moved row. When a gap does run out the whole playlist is renumbered once,
  with a gap wide enough that the retry cannot fail for the same reason — the
  test drives twenty moves into the same spot to reach that path.
- **A playlist holds each track at most once.** The membership table is keyed
  on `(playlist_id, track_id)`. iTunes allows duplicates; the drop reporting
  "added 6 of 10, 4 already there" is a better answer than silently making a
  second copy of a song you already put there.
- **Changing source resets the view.** Opening a playlist clears the search and
  the selection and switches to its own order. Carrying a library search into a
  playlist is rarely what was wanted, and the two views do not even have the
  same sorts available.
- **Reordering is offered only in a playlist's own order.** Sorted by a column,
  the arrangement on screen is derived and a drop would have nothing to persist,
  so the table simply takes no drops.
- **Drag payloads travel under a private MIME type**, not `text/plain`, so a
  row cannot be dropped into a text field and a paste cannot be mistaken for a
  drag. `dragover` can only see the *types*, which is why the check and the
  read are separate functions.
- **A sidebar item is named for its destination, not its size.** The track
  count is visible but `aria-hidden`: a navigation item whose announced name
  changes every time a song is added is worse to use than one that does not.
- **The filter is stored as a tree, never as SQL.** The editor has to read it
  back, and a stored SQL string would be both unparseable for the UI and an
  injection surface the moment anything wrote to it.
- **`FilterValue` is typed, not a bare JSON value.** The compiler has to know
  whether it is binding text or a number, and a rule whose value does not match
  its field is a mistake worth reporting rather than coercing. Mismatches are
  refused at save time, not silently reinterpreted.
- **Exclusion rules spell out the NULL case.** `NULL <> 'Guitar'` is NULL, so
  the obvious translation of "artist is not Guitar" quietly drops every
  untagged file. `IsNot`, `DoesNotContain` and their kin all read
  `(col IS NULL OR …)`, and a test pins it.
- **`LIKE` patterns escape `%`, `_` and the escape character.** Otherwise
  searching for "50%" matches every title starting with "50".
- **Depth and rule count are capped** (10 and 200). Compilation recurses, so a
  corrupt or hand-edited `filter_json` would otherwise be a stack overflow, and
  SQLite caps bound parameters anyway.
- **An empty filter matches everything.** A smart playlist that has just been
  created has no rules yet; showing the whole library to narrow down beats
  showing nothing to look at.
- **`now` is passed into the compiler**, not read inside it, so "added in the
  last 7 days" is testable without waiting a week.
- **A smart playlist's count is its query's count.** Routed through the same
  `count_tracks` the view uses, so the sidebar and the table cannot disagree.
  It costs one extra count per smart playlist per sidebar reload.
- **A deleted playlist reads as an empty view, not an error.** Dropping the
  clause instead would show the whole library, which is worse than showing
  nothing while the sidebar catches up.
- **The editor stays open when the backend refuses a filter**, so a rejected
  save does not throw away what the user built.
- **Absent means "leave alone", empty means "clear".** Every `TagEdit` field is
  an optional string with that rule, numbers included. It is what makes a bulk
  edit over tracks that disagree safe: the fields showing "Mixed" stay absent
  and survive untouched on every track.
- **A file is never edited in place.** Tags go onto a copy beside the original,
  which then replaces it in one rename. A crash or a full disk leaves either
  the old file or the new one, never a truncated mp3. The temp file keeps the
  original extension as a *prefixed* marker — lofty picks its writer from the
  extension, and `01 Maki.mp3.player-tmp` is not something it will write mp3
  tags into. That cost an hour; the test now asserts the extension.
- **Rows are re-read from the file, not assumed from the edit.** The file is
  the source of truth, and a value lofty normalised on write would otherwise
  leave the row disagreeing with the disk until the next scan. `mtime` and
  `size` update in the same step, so an incremental rescan finds nothing to do.
- **One bad file does not undo the good ones.** A locked or vanished file in
  the middle of a 500-track edit is counted and reported; the rest are written.
  Failures are not journalled, so undo will not try to restore them.
- **Undo is one level and is not itself undoable.** A redo stack invites the
  "undo, edit, undo" confusion; one level of certainty is worth more here than
  two levels of guessing. Undo also has to *clear* a field the edit added,
  which is why a snapshot restores every field rather than only changed ones.
- **Cover mime types are sniffed from the bytes**, not trusted from the
  extension: a `.jpg` that is really a PNG would be stored mislabelled and fail
  to render.
- **The undo journal references cover art by hash**, and nothing prunes the
  `covers` table. That is what lets undo put removed artwork back.
- **Exported settings go through an allowlist, not a denylist.** See phase 9.
  Fail closed: an unknown key is not exported.
- **A smart playlist exports its filter, not its members.** A membership list
  would be a lie the moment the library changed. Exactly one of `trackIds` and
  `filter` is present, which tells a reader which kind it holds without having
  to trust `kind`.
- **The export scope is derived from the view, not asked in a dialog.** A
  selection beats an open playlist beats the library, and the button says
  which — so it is never a guess to be verified afterwards.
- **A maximized window stores the flag, not the bounds.** Storing the
  maximized rectangle would restore a manually-sized window that happens to
  fill the screen, which un-maximizing then cannot undo.

### Defects found on the first real build (2026-08-02)

Running the app against a real library surfaced three, all fixed in
`fix/table-refresh`:

- **The table sat on placeholder rows after any query change that left the row
  count alone.** `SongTable`'s fetch effect keyed on the visible range and the
  total; a re-sort changes neither, yet `refresh` had already dropped every
  cached page. Clearing a search back to the same count did the same thing. It
  dated from phase 3 and was mostly invisible until search made query changes
  frequent. The effect now also keys on `queryToken`, which is exactly "the
  query changed". Two tests pin it, and both fail without the fix.
- **A superseded count cleared `loading`**, reporting a query as finished while
  its replacement was still running.
- **The window caption buttons stopped short of the title bar's edges**,
  leaving a dead strip that swallowed clicks aimed at the corner — the bar's
  vertical padding sits outside its grid items, so `align-self: stretch` only
  filled the content box.

### Defects found on the second real build (2026-08-02)

Nine reports; four were defects, three were never built, one was already true
and one was a phase that had not merged yet.

- **Drag and drop could never have worked in the packaged app.** Tauri's
  `dragDropEnabled` defaults to **true**, and while it is on, the webview hands
  OS-level drag events to the native file-drop handler instead of the page —
  which kills HTML5 drag and drop inside the window on Windows. Everything
  built in phase 6 was correct and untestable in place. Fixed with
  `"dragDropEnabled": false`. **This has a consequence for phase 15** — see
  the note there. CI never caught it because WebDriver cannot perform an OS
  drag, which the plan already recorded as a gap; that gap has now cost a
  whole feature going unnoticed.
- **`selectAll` had no keybinding.** It was written in phase 3, tested, and
  left with **zero callers** — the capability existed and was unreachable.
  The player shortcuts deliberately ignore anything with a modifier held, so
  Ctrl+A could never have reached them. Now in its own
  `useSelectionShortcuts`, along with Escape to clear.
- **Neither dialog answered Enter or Escape.** Recorded as a known gap when
  the dialogs were built and deferred to phase 13; that was the wrong call —
  a form you cannot submit with Enter is broken, not unpolished. Fixed for
  both, with Enter left alone on buttons and selects so it does not hijack the
  control the user is operating.
- **Renaming a playlist had no visible affordance.** Double-click worked and
  was tested, but an invisible gesture is not an affordance. The open playlist
  now carries Rename, Delete and (for smart ones) Edit Filter buttons.
- **Creating a playlist switched the view to it.** Deliberate, and wrong: the
  new playlist is empty, so it hides the songs you were about to drag into it.
  It now stays put and puts the new row straight into rename, which is the
  only thing there is to do with it yet.
- **"Export doesn't work"** — phase 9 had not merged. It offers a save dialog
  with a location; nothing to fix.
- **"Export should not include artwork"** — the bytes never travelled, but
  `coverHash` did, and I read the instruction as narrower than it was. It is
  gone: no artwork field of any kind, and the test now asserts the *absence*
  of the hash and of the string "cover" anywhere in the document. The schema
  doc is updated to match. No version bump — schema 1 has not shipped.
- **Context menus and drag-to-empty-space-to-create** were never built. See
  phase 17.

### Defects found on the third real build (2026-08-02)

- **`dialog.save` was not in the capability file.** Tauri v2 gates every
  built-in API behind `src-tauri/capabilities/default.json`, and export called
  `save()` without `dialog:allow-save` — so it typechecked, passed its tests,
  and failed in the packaged app with *"command plugin:dialog|save not allowed
  by ACL"*. `dialog:allow-open` had been added back in phase 2 for the watch
  folder; nothing made the omission of its sibling visible.
- **Window geometry restore had the same hole**, found while fixing the first
  one and not yet reported by anyone: `core:default` grants the *reads*
  (`outerPosition`, `outerSize`, `availableMonitors`) but not `setPosition` or
  `setSize`. Phase 9's restore would have failed on every launch. Both added.
- **A guard now exists for the whole class**: `src/ipc/capabilities.test.ts`
  maps each Tauri API the source calls to the permission it needs and asserts
  the capability file lists it. It is a lookup table rather than an analysis —
  a call it does not know about still slips through — but it turns the failure
  from a runtime surprise into a red CI job, and it fails on `main` as it
  stood before this fix. The mocked suite cannot catch these on its own,
  because the mocks answer regardless of whether the permission exists.
- **Delete removed songs from a playlist only while a row had focus.** The
  handler was on the row, so it worked after clicking one and did nothing
  after Ctrl+A or after clicking the sidebar — the same "reachable in theory"
  shape as `selectAll`. A window-level fallback now handles it when focus is
  elsewhere, deferring to the row when the row already acted, and refusing on
  smart playlists, where there is no membership row to remove and Delete must
  never be read as "delete the file".
- **Tag autocompletion** was never built — new phase 18.
- **Actions in the wrong place** (right-click a playlist to edit or delete,
  right-click songs to locate on disk or edit) — already phase 17, which now
  also spells out that the stopgap buttons get removed there.

### Defects found on the fourth real build (2026-08-02)

- **Show in Explorer opened the Documents folder.** The token was right and
  the *escaping* was wrong: `Command::arg` applies standard C-runtime rules,
  which wrap an argument containing a space in quotes as a whole -
  `"/select,C:\My Music\a.mp3"`. Explorer parses its own command line, cannot
  read that, and answers an unparseable one by opening Documents. Fixed with
  `raw_arg` and the quotes around the path only. **My test asserted the wrong
  thing** - it checked that no quotes were added, which was precisely the
  broken behaviour - so it passed while the feature did not work. Verified
  this time by running both forms through `cmd /c echo` and reading the
  command line each produced, rather than by trusting the assertion.
- **A white flash at startup**, at the default size and position, before the
  window jumped to the stored one. The window now starts hidden
  (`"visible": false`) and is shown once the geometry has been applied. The
  `show()` call sits **outside** the try that restores: a window that never
  appears is a far worse failure than one in the wrong place.
- **`maximize()` was never permitted** - found by the capability guard the
  moment `show()` was added to its table, not by anyone using the app.
  Restoring a maximized window has silently failed since phase 9. That is the
  third ACL hole this guard has caught and the first it caught *before* it
  shipped.
- **The Songs / Albums / Artists / Genres tabs do nothing.** They are rendered
  `disabled` with a "Not implemented yet" tooltip and have been since phase 3.
  Now phase 19.
- **Columns cannot be customized.** See the correction on phase 3 above: that
  entry claimed resizable, reorderable and toggleable columns and was ticked
  as merged, which is how this went unnoticed. Now phase 20.

### Decisions from the fourth build (2026-08-02)

- **Build warnings fail CI.** `vite.config.ts` turns every rollup warning into
  a thrown error, and the frontend job runs `npm run build` rather than
  leaving the production build to happen only inside the e2e job's
  nine-minute log. Verified by reintroducing the dynamic-import warning and
  watching the build exit 1, not by trusting the config. Silencing a specific
  `warning.code` later is allowed, with a comment; loosening it back to the
  default handler is not.
- **`npm run tauri build` needing a manual PATH export was not a
  misconfiguration.** The persisted user PATH has `.cargo\bin` first, the
  registry value is `ExpandString`, and a fresh `cmd` resolves cargo. The
  failing shells were started before rustup wrote that entry and never saw it;
  a process gets its environment at launch. Confirmed working by the user once
  the terminal was replaced. Nothing to change.
### Fifth build (2026-08-02): fixed rather than planned

Small enough to do rather than schedule:

- **Right-clicking a playlist now opens it**, so the highlighted row is the
  one the menu will act on. There is no other cue saying which playlist Delete
  means.
- **Deleting a playlist asks first.** A new `ConfirmDialog` reusing the
  existing `.modal` chrome rather than the OS message box, which is a separate
  ACL-gated plugin call that looks nothing like the window it interrupts.
  **Cancel takes focus, not Delete**, so a reflex Enter destroys nothing, and
  the body says the songs stay in the library - that is the actual fear.
- **Play and Export are disabled on an empty playlist**, rather than offering
  to play nothing or write an empty file.
- **"Get Info" is now "Edit".** iTunes' name for it; not what it does.
- **The search field lost its focus ring.** Scoped to text inputs only - a
  caret already says where typing goes, and the ring stays on buttons and
  lists where it is the sole focus indication.
- **Double-clicking the title bar maximizes and restores**, using the same
  target guard as dragging so double-clicking the search box still selects a
  word.
- **The context menu had no visible edge and mis-spaced separators.** Both had
  the same root cause as the fix that introduced them: switching separators to
  `<hr>` left the browser default `border: 1px inset` in place, which drew a
  second brighter line and reserved space around it. `--menu-border` is a new
  variable because `--chrome-border` is nearly `--surface` in dark mode, which
  is why the panel had no edge at all.

### Sixth build (2026-08-02)

- **The toolbar jumped when playback started.** `.status-display` was
  `min-height: 42px`, and the playing state renders a title, a subtitle and a
  scrubber - taller than that, so the box grew and shoved the toolbar down.
  Now a fixed height sized to the playing state, with a stylesheet-guard
  assertion that it stays fixed.
- **Double-click to maximize did not work in the real build**, though it
  passed a green test. `startDragging` hands the drag loop to the OS, which
  swallows the mouseup and the second click, so a `dblclick` event never
  arrives on a bar that also drags - the `onDoubleClick` handler was dead code
  the moment it was written. jsdom delivers a synthetic `dblclick` happily,
  which is why the test passed. Both gestures now live in one `mousedown`
  handler keyed off `event.detail === 2`, the only signal available before the
  drag begins, and the test fires the events the OS actually produces.
- **The "Add to Playlist" flyout opened at the top of the menu** instead of
  beside the row that opened it. The submenu is `position: absolute` and its
  wrapper had no positioning context, so it resolved against the menu panel -
  the nearest positioned ancestor, the panel being `fixed`. One
  `position: relative` on the row, plus a stylesheet-guard assertion that the
  pair stays together, since the two rules are meaningless apart.
- **The caption buttons were oversized.** 44px wide and stretched down a bar
  tall enough to hold the status display, which made three large bands where
  an app wants a quiet corner. Now a compact 34x30 cluster after Discord's,
  still pulled flush with the top edge - the top-right corner has to stay
  hittable by throwing the pointer at it - with the reclaimed width given to
  the search field, as asked.
- **Media keys do not work unfocused** - correct for a window-scoped
  `keydown` listener, wrong for a music player. Now phase 22, which registers
  the media keys with the OS and deliberately does **not** register Space:
  global shortcuts are exclusive, so that would break the space bar in every
  other application.

### Seventh build (2026-08-02)

- **The app version is now in the footer**, read from the backend rather than
  baked in at build time - the Rust crate's version is the one the installer
  and every export report, so asking for it is what keeps the line honest if
  they ever disagree. The summary stays centred in the bar rather than in the
  space left beside it: a total that shifted when a version number gained a
  digit would be worse than one sitting slightly off-centre.
- **In-app updates** are phase 23, blocked on two decisions - see there. The
  short version: a private repo cannot serve update assets to a shipped binary
  without embedding a credential in it, and Tauri's updater requires a
  minisign key, which is free and unrelated to the Authenticode signing that
  was ruled out at the start.

### Releases and versioning (2026-08-02)

Installers are published from CI, versioned from the commit history.

- **release-please** reads the conventional-commit titles landing on `main` -
  which this repo has used from the start - and keeps **one open release pull
  request** holding the version bump and the changelog. Nothing publishes
  while that PR sits there; merging it cuts the tag and the GitHub release.
  That keeps the same review gate every other change goes through, rather
  than a tag appearing because somebody wrote `feat:` in a message.
- **`bump-minor-pre-major`**: while below 1.0.0, a `feat` bumps the minor and
  a breaking change does not jump to 1.0.0. Going 1.0 is then a deliberate
  act rather than an accident of wording.
- **The version lives in three files** - `package.json`, `tauri.conf.json`
  (installer name, Add/Remove Programs) and `Cargo.toml` (`CARGO_PKG_VERSION`,
  which reaches users through `get_app_info` and the `generator` block of
  every export). release-please updates all three, and `src/version.test.ts`
  asserts they agree, that the manifest matches, and that the config still
  lists every file carrying a version. Verified by drifting one and watching
  it fail.
- **`Cargo.lock` is deliberately excluded** from that check. Cargo rewrites it
  on the next build, so it lags by design rather than drifting, and asserting
  on it would fail every release for nothing.
- **The installers are unsigned**, which was settled at the start - local-only
  product, no code signing. Windows SmartScreen will warn on first run of each
  new version until it accrues reputation. Nothing to fix; worth knowing
  before wondering whether the build is broken.
- **Untested until it runs once.** A release workflow cannot be exercised by
  CI - the first real tag is the test. The YAML parses and the version guard
  is proven, but whether `release-please-action` picks up this config and
  whether the bundle paths are right are things only the first run answers.

### release-please on Node 24 (2026-08-03)

`release-please-action@v4` targets Node 20, which GitHub is deprecating and
currently force-runs on 24 with a warning on every release run. v5 exists for
exactly that: its only breaking change *is* the runtime bump.

- **Verified rather than assumed compatible.** The outputs this workflow gates
  on - `release_created` and `tag_name` - are not declared in `action.yml`;
  they are set at runtime from JS. Diffing that region of `src/index.ts`
  between v4.4.1 and v5.0.0 shows it byte-identical, so the `if:` condition on
  the installers job keeps behaving as it does today.
- release-please itself goes 17.3.0 -> 17.6.0 in the same bump.

### Density rebase and webview zoom (2026-08-03)

Phase 21, both halves.

**21a.** The type and spacing scale is multiplied by 1.2 and rounded to whole
pixels - base font 12px to 14px, row height 22 to 26 - so the default is right
and the slider is an adjustment rather than a correction. Applied by script
across the density-bearing properties only: borders, radii and shadows are
untouched, because a 1.2px hairline is a blurry hairline and a scaled radius
reads as a different shape rather than a bigger one.

- **The caption buttons are deliberately excluded.** They mirror the OS
  cluster rather than the app's content, and 44px-wide buttons were already
  rejected once as oversized; scaling 34x30 would have put them back at 41x36.
- **The virtualizer constants moved with the CSS.** `ROW_HEIGHT`, the browse
  tile and list metrics and the default column widths rebased together. A CSS
  row that grew while the estimate did not is what makes rows overlap and the
  scrollbar lie.
- **The scripted pass missed twelve declarations** that follow a comment rather
  than a `;` or `{` - including `.status-display`'s fixed height, which would
  have left the box too short for the text it now holds and reopened the layout
  shift phase 14 closed. Found by diffing against the committed file for
  density properties that had not changed.
- **Only `--control-height` became a variable.** `--row-height` and
  `--gutter` were added and then removed: nothing referenced them. Row height
  in particular belongs in `SongTable.tsx`, where the virtualizer reads it - a
  CSS copy would be a second number to keep in step.
- **The theme-parity guard now compares colours by value**, not every `--`
  name, since density variables have no dark variant and should not be forced
  to invent one. Verified by deleting a dark colour and watching it fail.

**21b.** `getCurrentWebview().setZoom()`, default 1.0, range 0.8-2.0.

- **Webview zoom, not CSS.** CSS pixel coordinates are unchanged by it, so
  `ROW_HEIGHT` stays 26 at any zoom and the virtualizer needs no knowledge of
  the setting. Text is laid out at the target size rather than stretched.
- **Applied before the window is shown**, inside the geometry restore that
  already owns that moment. Afterwards would mean watching the app resize
  itself on every launch.
- **Ctrl+plus / minus / 0 go through the same store as the slider**, so the two
  cannot disagree. Left unhandled, the webview may act on them itself and the
  slider would report a zoom that is no longer true. `=` counts as plus, which
  is how it arrives on most layouts.
- **Rounded to one decimal on every path.** 0.1 is not representable in binary,
  so stepping up from 0.8 lands on 0.9999999999999999 - the label would read
  100% while the value was not 1.
- **A rejected zoom is not persisted**, or the next launch would restore a
  setting that never applied.
- Capability `core:webview:allow-set-webview-zoom`, with a guard row proven to
  fail without it.

**Revised after the user's review (2026-08-03).** *"the new default for 100 is
good!"* - 21a is confirmed, so the rebased density stands. Two changes to the
control itself:

- **Moved to the bottom-left corner**, into column 1 of the status bar's grid,
  which was empty: the summary is centred in column 2 and the version ends
  column 3.
- **Two buttons instead of a slider**, with the value between them. The steps
  are 0.1 apart over a narrow range, which suits clicking better than dragging,
  and the buttons are the same gesture as the Ctrl+plus / Ctrl+minus that
  already worked. Each end disables its button rather than silently refusing.
- **That move broke the footer**, reported immediately: the version and the
  stepper dropped to a second line. Grid auto-placement only moves *forward*,
  so a child explicitly assigned to column 1 after one sitting in column 2
  cannot go back and starts a new row instead. Fixed by putting the stepper
  first in the DOM as well as leftmost on screen, and by pinning every status
  bar child to `grid-row: 1` so the layout no longer depends on DOM order.
  `App.css.test.ts` gained a guard for it - any `.statusbar-*` rule that sets
  a column must also state its row - verified by removing one and watching it
  name the offending selector.

### Media keys without focus (2026-08-03)

Phase 22, and the answer to *"pressing the play/pause keyboard hotkey without
app focus doesnt trigger it"*. The window-scoped bindings are untouched; this
is a second, narrower path for the four keys whose entire purpose is to work
while the app is behind something else.

- **The plugin grants nothing by default.** `tauri-plugin-global-shortcut`
  ships an empty `default` permission set on purpose - its authors treat a
  global shortcut as dangerous enough to be opted into one key at a time - so
  `global-shortcut:default` would have looked like a grant and been none.
  `allow-register` and `allow-unregister` are listed explicitly.
- **The capability guard caught itself being useless.** The two new rows were
  written with a Python here-doc, which turned a backslash-b into a literal backspace;
  the regex became a backspace followed by `register`, matched nothing, and the test passed
  vacuously. Found by deleting each permission and checking the guard went red
  - which it did not. Both rows now fail without their permission, verified one
  at a time.
- **`unregister` is listed before `register`, which is anchored on `await `.**
  The names overlap, so a bare `/register\(/` also matches every
  `unregister(` and each row would report the other's callers.
- **Not Space, and not the arrows.** A global shortcut is exclusive: the OS
  routes it to whoever claimed it and nobody else, so registering Space
  system-wide would break the space bar in every other application on the
  machine. A test asserts the list never grows into them.
- **Registered one key at a time.** The plugin's array form is all-or-nothing,
  so one key held by another player would cost the other three.
- **A failed registration is not an error.** Another media player holding
  `MediaPlayPause` is not a fault condition and not worth a banner; the app
  carries on without that key and releases only what it actually claimed -
  releasing a key it never held could take it from whoever does.
- **Unregistering also covers unmount-during-registration**, which would
  otherwise leave keys held by a window that has gone.
- **The one thing not proven here.** Whether the OS delivers a key while the
  window is unfocused cannot be tested in CI or jsdom. The registration list,
  the mapping, the failure path and the lifecycle are covered; the delivery
  needs a real build, like Show in Explorer before it.

### Column customization (2026-08-03)

Phase 20, and the other half of what phase 3's entry claimed and phase 3 did
not deliver. Reported twice: *"it's currently not possible to customize the
columns shown"* and *"it's currently not possible to reorder them, but sorting
does work"*.

- **Click sorts, drag reorders, separated by four pixels.** They share one
  pointer press, so a mode would be the alternative and a mode is worse. Below
  the threshold it is a click; above it, the following `click` is swallowed,
  because `pointerup` fires first and every reorder would otherwise also sort
  by whatever it was dropped on.
- **Dropping is measured against header midpoints**, and the dragged column is
  excluded from the count - including its own width means a wide column never
  lands where the pointer is.
- **Resizing commits once, on release.** Live width is local state; a store
  write per pointer move would persist a hundred layouts across one drag.
- **Hiding the last column is refused**, in the reducer and greyed in the menu.
  An empty table has no headers, so no header menu, so no way back.
- **Hiding the sorted column moves the sort** to the first visible one and
  re-queries. A view sorted by something invisible looks unsorted and has no
  header left to click. `relevance` and `position` are exempt - they are
  properties of the query and have no header either way.
- **Per view.** `playlists.columns_json` has been in the schema since phase 2
  and had never been written. A playlist with no layout of its own inherits the
  library's rather than opening bare, so `None` has to stay distinguishable
  from "configured to show nothing".
- **The stored layout is opaque to Rust.** Which columns exist is a frontend
  fact; mirroring `ColumnConfig` into the backend would be two definitions to
  keep in step for nothing. `parseColumnConfig` therefore assumes nothing:
  unknown ids are dropped, duplicates collapsed, unusable widths ignored, and
  anything unparseable falls back to a working table.
- **Not added to the settings export allowlist.** A column layout is local
  chrome, and the allowlist is built so that omission is the safe direction.
- **jsdom has no `PointerEvent`**, so `fireEvent.pointerMove(el, {clientX})`
  delivered `null` and every pointer-driven component looked broken while being
  correct in a browser. A `MouseEvent` subclass in the test setup fixes it for
  anything built later.

### Browsing by album, artist and genre (2026-08-03)

Phase 19. The three dead tabs are live, and the shape of it is one query plus
one condition rather than a second table.

- **`browse_groups` runs through the same `scope()` the songs table uses**, so
  a search or an open playlist narrows the album list exactly as it narrows the
  rows - without a second notion of what the current view contains. That reuse
  is the whole reason this is small.
- **Drilling in is `TrackQuery.browse`**, not a view of its own, so paging,
  sorting, select-all, the play queue and export keep working inside an album
  with no second code path.
- **`IS ?` rather than `= ?`.** A bound NULL equals nothing in SQL, so `=`
  would return an empty view for the untagged group; dropping the clause
  instead would return the whole library while looking like it worked. Both
  failure modes are silent, so both have tests.
- **Grouped on `coalesce(nullif(album_artist,''), nullif(artist,''))`** so a
  compilation stays one album rather than shattering per track, and a tag
  written as `""` is absent rather than its own group sorting above everything.
  Albums are keyed by title *and* artist: two artists with an eponymous album
  are two albums.
- **"Unknown Album" is a frontend label, not a stored value**, so an album
  genuinely named that stays distinguishable from an untagged one.
- **The group list deliberately ignores an open drill-in.** Otherwise opening
  an album collapses the album list to that album and there is no way back -
  which is why it has its own test.
- **Unpaged, virtualized anyway.** Ten thousand tracks is a few hundred albums;
  a window cache and a count query to render that would be machinery for
  nothing. A perf guard covers all three groupings, since this is the one query
  in the app with no `LIMIT` behind it.
- **The React key is two keys joined by U+001F.** With a space, album "A" by
  "B C" and album "A B" by "C" collide and React reuses one tile for the other.
- **The e2e suite now switches tabs**, because "three of four tabs do nothing"
  is exactly the class of defect a smoke test should have been catching.

### release-please vs the formatter (2026-08-03)

The first release PR failed `biome check`, and would have failed on every
release after it. release-please does not patch a version in place - it parses
the JSON, sets the field and re-serializes the whole file with its own printer.
That rewrote `"targets": ["msi", "nsis"]` across four lines and emitted the
manifest as `{".":"0.2.0"}`, both of which Biome then wanted to undo.

- **Irreconcilable by configuration.** Biome collapses that array because it
  fits in 100 columns; release-please always expands. No setting satisfies both.
- **The two files are now excluded from the formatter**, not from Biome
  entirely, so they are still linted - `Checked 89 files` is unchanged. Same
  principle already applied to `src/ipc/bindings`: a formatter should not own a
  file it does not write.
- **Reproduced before fixing.** Re-serializing the config the way release-please
  does produced exactly the two hunks CI complained about, which is what made it
  safe to claim the exclusion was the fix rather than hoping.

### e2e wall time (2026-08-03)

The smoke suite took **328s** for six assertion-only tests. It was not the
build and not the cache - the debug build is 61s and `rust-cache` restores in
27s. Every WebDriver command was stalling for exactly five seconds.

- **`@wdio/tauri-service` runs `ensureActiveWindowFocus` in a `beforeCommand`
  hook**, so the cost is paid *per command*, not per test. That helper reads
  the window states through `window.__TAURI__.core.invoke`, spin-waiting for it
  in 50ms steps and giving up after 5s. The real work underneath was 5ms - the
  `findElement` for the sidebar returned in `30.788` -> `30.793`.
- **The plugin has two halves and only one was installed.** `tauri-plugin-wdio`
  was in `Cargo.toml`, registered in `lib.rs`, and granted `wdio:default` - the
  README's steps 1-3. Step 4, `import '@wdio/tauri-plugin'` in the frontend
  entry, was missed, and that npm package was not even a dependency. It is what
  assigns `window.__wdio_original_core__`, the exact property the service polls
  for. Nothing was ever going to set it.
- **It also needs `app.withGlobalTauri`**, because the frontend half reads
  `window.__TAURI__?.core` to find what to snapshot, and this app imports
  `@tauri-apps/api` as ES modules. Both halves are required; the first attempt
  set only the config flag and the suite came back at 340s, unchanged.
- **Both are e2e-only.** `withGlobalTauri` sits in the wdio `--config` overlay
  next to `decorations`; the import sits behind `import.meta.env.VITE_E2E`,
  which CI sets on the build step alone, so rollup drops the branch everywhere
  else. Verified in both directions: the normal bundle is 284.42 kB with no
  match for `wdio`, the e2e bundle adds a 16.46 kB chunk that has it.
- **The failure was silent by design** - a `WARN` the suite continued past,
  with everything still green. Worth remembering that a passing suite can be
  hiding a broken assumption; only the wall clock showed it.
- `captureFrontendLogs` reads the same global and returns early without it, so
  console forwarding had never actually worked either.

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
- **Footer totals are counts only** — the duration reads "0 minutes" however
  large the library is, because `formatLibrarySummary` is called with a
  hard-coded zero. Scheduled as phase 14.
- **Column reorder/resize** is data-driven in `columns.ts` but has no UI.
- **Nothing can be dragged into the app.** Adding music is a folder picker
  only. Scheduled as phase 15.
- **A file that disappears is deleted from the library, not marked missing.**
  An unplugged external drive therefore destroys playlist entries pointing at
  it, and a rescan cannot restore them. Scheduled as phase 16, which is also
  what makes a "missing" indicator possible.
- ~~**`main` is not protected server-side**~~ — fixed in phase 28. The
  ruleset now requires all six checks; the pre-push hook is a fast-fail
  convenience rather than the enforcement.
- **No audio is asserted end to end.** GitHub's Windows runners have no output
  device, so CI exercises the engine, the queue and the IPC surface against a
  fake sink and only checks that the transport is live in e2e. Decoding is
  covered — the integration tests run every fixture mp3 through the shipped
  `rodio`/symphonia decoder — but "sound actually came out" is a manual check.
- **Nothing repeats or shuffles yet**, and there is no visible queue: the queue
  is whatever view was playing from.
- **Per-playlist column config is not built** — see phase 6's note. It waits on
  a UI for columns at all.
- **A playlist cannot hold the same track twice**, by schema. Deliberate, but
  worth revisiting if anyone ever wants a track to recur in a set.
- **Dragging is mouse-only.** There is no keyboard route to add a selection to
  a playlist yet; removing from one has Delete, and reordering has nothing.
  Phase 17's context menu is where that route belongs.
- **`dragDropEnabled` is off**, which is what makes in-app dragging work at
  all. Phase 15 needs it on. See the warning in that phase.
- **There is no context menu anywhere.** Scheduled as phase 17.
- **e2e cannot exercise dragging**, and that gap let phase 6 ship a feature
  that could not work in the packaged app. Anything that depends on an OS-level
  gesture needs a manual check on a real build before it is called done.
- **The editor's field/operator table is duplicated in TypeScript.**
  `filterTree.ts` mirrors `FilterField::kind` and the operator match in
  `smart/compile`. The backend validates every filter by compiling it before
  storing, so drift shows up as the editor offering a combination the backend
  refuses — annoying, never unsafe. Generating the table from Rust would remove
  the duplication if it ever bites.
- **A smart playlist has no sort of its own.** `playlists.sort_json` is still
  unused; a smart playlist opens in the library's default order and the user
  sorts by column. Belongs with the same work as `columns_json`.
- **Neither dialog has a focus trap or Escape-to-close.** Both are a `div` with
  `role="dialog"` rather than `<dialog>`, because the native element needs
  `showModal()` from an effect and jsdom does not implement it. Worth
  revisiting in the phase 13 native-feel pass.
- **`covers` is never pruned.** Undo depends on that, but it means artwork
  replaced a hundred times leaves a hundred rows. A vacuum that keeps anything
  referenced by `tracks` or `tag_undo` would be safe; nothing needs it yet.
- **The undo journal is unbounded.** Every edit adds a row per track and
  nothing trims it, so a library edited for years accumulates them. Capping it
  to the last N batches is a one-line delete whenever it matters.
- **Tag edits are single-threaded.** 500 files are written one after another on
  the IPC thread; the dialog has no progress and the window will sit still for
  a large batch. Worth moving to `spawn_blocking` with a progress event, the
  way scanning already is. **Export has the same shape** — it builds the whole
  document in memory on the IPC thread — and would want the same treatment at
  a large enough library.
- **There is no import.** Export is a one-way door: the schema is documented
  well enough to read, but nothing reads it back. Restoring play counts onto a
  rebuilt library is the obvious use and is not built.
- **`sort_json` and `columns_json` are both still unused.** Per-playlist sort
  and column configuration wait on a UI for columns at all.

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
Sidebar, LCD status display, segmented tab bar, virtualized table, sorting,
selection model, scan progress. Reads real data from phase 2.

> **Correction (2026-08-02).** This entry read "virtualized table with
> resizable/reorderable/toggleable columns" and was ticked as merged. The
> table shipped with a **fixed** column set: `ALL_COLUMNS` exists and
> `columnsFor` takes ids, but the only caller passes `DEFAULT_COLUMN_IDS` and
> there is no UI to change them. Sorting works; resizing, reordering and
> toggling never shipped. Now phase 20. Two of the original feature
> requirements - "adjustable column display" and "per playlist" - are still
> outstanding, and this line made them look done.

**4 — Playback** `feat/04-audio` — ✅ **merged** (`eb24e87`)
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

**5 — Search** `feat/05-search` — ✅ **merged** (`843cbcf`)
FTS5 triggers, debounced search box scoped to the current view, ranked results.

*As built.* The FTS5 table and its triggers landed with phase 2; this phase is
the query and the UI on top. `db::query::order_by` adds a `Relevance` sort over
weighted `bm25`, applied only when a search is actually running. The store
separates `searchInput` (every keystroke) from `search` (debounced 200 ms, or
immediate on Enter), and a per-query token makes stale counts and stale pages
unwritable. Escape and a clear button empty the box; a search with no hits gets
its own empty state rather than the "add a folder" one.

**6 — Playlists** `feat/06-playlists` — ✅ **merged** (`8f10a3d`)
Static playlist CRUD, drag-and-drop of a multi-selection onto a sidebar
playlist, reordering within one, per-playlist column config.

*As built.* `db/playlists.rs` owns the list and its ordered membership and
touches no track rows; the tracks a playlist points at come back through the
ordinary paged query with `playlist_id` set. Positions are gapped so a drop is
one UPDATE per moved row, with a one-off renumber when a gap runs out. Seven
commands (`list`/`create`/`rename`/`delete`/`add_to`/`remove_from`/`move_in`).
Frontend: `src/features/playlists/` with a store, a `PlaylistSidebar` that owns
its own drop targets and inline rename, and a pure `drag.ts` for the payload
and the above/below hit test. `SongTable` rows became draggable and, in a
playlist shown in its own order, drop targets.

*Not built: per-playlist column config.* `playlists.columns_json` exists in the
schema and stays empty. Columns are still data-driven with no UI to reorder,
resize or toggle them (a gap from phase 3), so persisting a per-playlist
arrangement would be storage for something the user cannot change. It belongs
with the column UI, wherever that lands.

**7 — Smart playlists** `feat/07-smart` — ✅ **merged** (`c067f57`)
Filter-tree editor UI (nested and/or groups), the SQL compiler, live
re-evaluation.

*As built.* `src-tauri/src/smart/mod.rs` is the whole compiler: pure, no
database, ~200 lines, and tested by running its output against a real library
rather than by asserting on the string it produced. `db::query::scope` resolves
a `playlist_id` to either a membership join (static) or a compiled `WHERE`
(smart), so a smart playlist needs no new query path — paging, search-within
and the play queue work on it unchanged, and its sidebar count goes through the
same `count_tracks` the view does, so the two cannot disagree.

Frontend: `src/features/smart/filterTree.ts` holds every tree edit as a pure
path-addressed function, and `SmartPlaylistEditor.tsx` is a dialog over it.
Field/operator compatibility is enforced in the editor *and* validated by the
backend, which compiles a filter before storing it.

**8 — Tag editing** `feat/08-tags` — ✅ **merged** (`571a4c2`)
Single and bulk editor (mixed-value fields that only write when touched),
cover art replace/remove, atomic writer, undo journal and an "Undo last edit"
affordance.

*As built.* `tags/write.rs` holds the writer. Migration 3 finally creates
`tag_undo`, which the original schema planned but never built. A `TagEdit`
carries every field as an optional string: absent means "leave it alone",
empty means "clear it" — that one distinction is the whole mixed-value
contract, and it is what lets a bulk edit over disagreeing tracks be safe.
Frontend: `features/editor/fields.ts` decides what a field shows across a
selection and what a save sends; `TagEditor.tsx` is a dialog over it, used
identically for one track and for five hundred.

*Correction to the plan's wording.* Files and database rows are **not** in one
transaction, because a filesystem write cannot join a SQL transaction. Files
are written first — they are what survives the app — and the rows follow in one
transaction afterwards, re-read from the files rather than assumed from the
edit.

**9 — Export & polish** `feat/09-export` — ✅ **merged** (`b26feae`)
JSON export (full library / selection / playlist, documented stable schema),
settings persistence, window geometry, dark mode pass, empty and error states.

*As built.* `src-tauri/src/export/` assembles the document through the same
query layer the UI uses, so an export of a playlist contains exactly what the
playlist showed — including a smart playlist's live evaluation. It pages, so a
library over the 1000-row query cap exports completely; there is a test for
that, because forgetting would truncate silently. The schema is published in
[docs/export-schema.md](docs/export-schema.md).

Window geometry persists through `settings`, with the parsing and the
on-screen check in a pure module: a remembered position on an unplugged
monitor is the ordinary way a window becomes unreachable.

*Deviation: an allowlist, not a denylist.* The plan specified a denylist so
last.fm and Discogs credentials could never reach an export. An allowlist gets
the same result and fails the safe way round — forgetting to deny a new
credential leaks it, while forgetting to allow a new preference merely omits
it. Every future secret is excluded by default rather than by memory.

*Not built: the dark mode pass and the "empty and error states" sweep.* Both
have been happening continuously — every phase added its own empty state, and
`prefers-color-scheme` has been in place since phase 3. What is left of that
item is a deliberate visual review, which is what phase 13 is for; doing it
twice would be doing it badly once.

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

**11 — Crash & error reporting** `feat/11-sentry` — ❌ **cut, by decision**

Cut on 2026-08-04, after the dependencies were added and built to check whether
the plan's caveats were real rather than theoretical. They were: `sentry` 0.42 -
two years behind 0.49, and pinned there by the plugin - pulls in `reqwest`,
`hyper`, `rustls` and a TLS root store. A network stack, in an application whose
entire premise is that it does not use the network.

The rest of the caveat list below argued the same way: a single-maintainer
plugin with no release in 11 months, an unreleased fix needing a git dependency
`deny.toml` forbids, and a minidump handler that restarts the executable and
would have to be explained to both the e2e harness and Windows antivirus.
Against that, what is bought is diagnostics for a local music player with one
user - who is also the person who would read the reports.

**If crash visibility is wanted later, the cheap version is local.** Catch
panics with `std::panic::set_hook`, write them to a log beside the database,
and surface the last one in the app. No network, no DSN, no opt-in toggle to
design, and nothing to scrub - step 8's scrubbing work existed entirely because
Sentry would have carried file paths, folder names and track titles off the
machine.

*The original plan follows, kept for the record.*

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

**13 — Native feel pass** `feat/13-native-feel` — ✅ **merged** (`daae2cf`)

*Built. What shipped:*

- **The webview's own context menu is gone** outside text fields —
  `useNativeFeel`, one document-level listener rather than a handler per
  element, so it covers the chrome, the empty space and anything added later.
  Text inputs keep theirs: Cut/Copy/Paste and the Windows IME entries are real
  functionality the app does not reimplement. A range or checkbox does not,
  since there is nothing to paste into one. Registered on the document, so the
  app's own menus have already run by the time it fires.
- **The hand cursor is gone** — all ten `cursor: pointer` declarations became
  `default`, with `cursor: text` given back to text fields, which the sweep
  would otherwise have flattened.
- **No transitions or animations**, `overscroll-behavior: none` so the window
  never rubber-bands as a document, and `:focus-visible` for the focus ring so
  it appears on keyboard focus but not on every click.
- **Selection survives losing focus**, dimmed via `color-mix` rather than
  cleared — alt-tabbing to check something should not lose the user's place.
- **A drag badge** — "7 songs" under the pointer instead of the default
  translucent screenshot of a full-width table row, which is unmistakably a
  web drag. Built off-screen rather than hidden, because `display: none` and
  `visibility: hidden` both make an element unrasterizable and the call would
  silently do nothing.

*The guard:* `App.css.test.ts` reads the stylesheet as text and asserts the
absences — no hover background outside the two allowed selectors (window
caption buttons, menu items), no `cursor: pointer`, no transition or
animation, a `:focus-visible` outline, `overscroll-behavior`, and **that every
colour variable defined in light mode is defined in dark mode too**. Absences
are exactly what nobody notices coming back, and jsdom applies no stylesheet,
so no component test can see any of this.

Two things it cannot reach, left to the manual checklist: density and hit
targets against Explorer/iTunes, and font smoothing on Windows.

---

*The original checklist follows.*

A dedicated pass over the whole UI to stop it reading as a web page in a
window. The tells are mostly things to *remove*:

- **No hover effects.** Rows, cells and list items do not light up under the
  pointer. Hover states are a web affordance for "this is a link"; a desktop
  list communicates through selection and focus instead. Buttons keep a
  pressed state, and genuinely clickable chrome (sort headers, sidebar items)
  keeps focus rings — those are accessibility, not decoration. **The window
  caption buttons are the deliberate exception**: minimize/maximize/close
  highlight on hover in every Windows title bar, and dropping that would read
  as broken rather than as native.
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

**14 — Library totals in the footer** `feat/14-totals` — ✅ **merged** (`e079457`)

*Built as specified, with two details worth recording:*

- `count_tracks` is now a thin wrapper over `library_stats` rather than a
  second query, so the scrollbar and the footer cannot describe different
  views. The store keeps both `stats` and `total`, the latter because the
  virtualizer reads it on every render; a test asserts they agree.
- `duration_ms` and `bytes` are `i64`, not the `u32` the count uses: a library
  passes four billion milliseconds at about seven hundred hours, and four
  billion bytes long before that. Pinned by a test that sums past both.
- The footer shows size, the toolbar display does not - it has room for two
  facts, not three. A zero size is omitted rather than rendered as "0 MB",
  which beside 237 songs reads as a bug rather than as a fact.

*The trap the plan called out was real:* `sum()` of no rows is NULL in SQLite,
not 0, and without the `coalesce` an empty library does not return zeroes, it
fails to decode. Three tests cover it - an empty library, a search that
matched nothing, and the untagged fixture row whose duration is NULL.

---

*The original sketch follows.*

The status bar and the toolbar display both promise "N songs, H hours" and
currently always say zero for the time, because no query produces the sum.

- New command `library_stats(query)` returning `{ tracks, duration_ms, bytes }`
  for the *current* view, so it reflects a search or a playlist rather than
  always the whole library. `tracks.size` is already stored by the scanner, so
  this is one `SELECT count(*), sum(duration_ms), sum(size)`.
- Folded into the existing count call rather than added alongside it: the two
  always change together, and a second round trip per query change would be
  waste. `count_tracks` becomes `library_stats` and the store keeps the whole
  struct.
- The footer then reads "5 songs, 50 minutes, 214 MB", and `formatBytes` —
  written in phase 3 and unused since — finally has a caller.

*Testing:* aggregates over a seeded library incl. an empty one (sum of no rows
is NULL in SQLite, not 0, which is the classic bug here), a filtered view, and
a library whose durations exceed `i32`. A perf guard, since this now runs on
every query change.

**15 — Ingest ergonomics** `feat/15-ingest` — ~~drag and drop~~ **cut, by decision**

> **Settled (2026-08-02, the user's call):** *"while I explicitly asked for
> folder drag/drop ingest, I later also said that it has to go if that's what
> prevents us from having playlist drag and drop."*
>
> So **`dragDropEnabled` stays `false`** and the OS-file drop route is
> abandoned — option 3 below. Playlist drag and drop is a daily gesture;
> dropping a folder in is something you do when the library changes. The
> daily one wins. This also removes the ordering constraint between this
> phase and 17; neither now depends on the other.

What remains of this phase is making the picker route good enough that the
loss does not hurt: multi-select in the folder picker, an "Add Files…"
companion to "Add Folder…", and the loose-file rule below. Sized in hours,
not days.

*Everything below this line is retained as the record of what was designed
and why it was dropped, in case Tauri ever gains a runtime toggle for the
flag — at which point option 1 becomes available and this comes back.*

- **Onto the library**: accept a mixed drop of files and directories, add each
  directory as a watch folder, scan. Loose files that sit outside every watch
  folder need a decision (see open question below).
- **Onto a static playlist** (phase 6): ingest into the library first, then
  append the resulting track ids to that playlist, in drop order.
- **Onto a smart playlist** (phase 7): ingest into the library only. The
  playlist's membership is its filter, so the dropped tracks appear there if
  and only if they match — silently doing anything else would be a lie about
  what a smart playlist is. The UI should say so rather than appear to no-op:
  the drop target reports "added to Library; N of M match this playlist".
- Tauri v2 exposes this through `onDragDropEvent` on the window (paths only,
  never file contents), so the whole thing is a path list handed to the
  existing scan pipeline. Drag *out* of the app is not in scope.

**⚠ This phase conflicts with phase 6 at the platform level.** `onDragDropEvent`
only fires while `dragDropEnabled` is **true**, and while it is true the
webview hands OS drag events to the native handler instead of the page — which
is exactly what stopped phase 6's in-app row dragging from working at all. The
two cannot both be on. Options, none free:

  1. **Toggle it per gesture.** `WebviewWindow::set_drag_drop_enabled` does not
     exist in Tauri v2; the flag is fixed at window creation. Ruled out unless
     upstream adds it.
  2. **Two windows** — absurd for this.
  3. **Keep it off and drop the OS-file route**, offering only "Add Folder…".
     Loses the feature this phase exists for.
  4. **Keep it off and read paths from the HTML5 drop**, which Tauri
     deliberately does not expose — a browser `File` has no path.
  5. **Turn it on and replace in-app dragging** with the context-menu "Add to
     Playlist ▸" from phase 17, plus a keyboard route for reordering.

Option 5 was my recommendation and was **not** taken: it keeps both
capabilities only by replacing a direct gesture with a menu, and the user
chose to keep the gesture and lose the ingest route instead. **Option 3 is
what ships.**
- Visual affordance: the drop target highlights, and an invalid target (a
  drop of zero audio files) says so instead of silently swallowing it.

*Testing:* the path-classifying step (files vs directories vs neither) is pure
and unit-testable; the ingest path already has integration coverage; the
component tests cover the drop target's states. The OS-level drag itself is
not scriptable in WebDriver, so an e2e test would assert the handler, not the
gesture — worth skipping rather than faking.

*Settled — loose files are refused, with an explanation.* A dropped file that
lives outside every watch folder has nowhere to belong: the scanner walks watch
folders, so the row would silently vanish on the next rescan. Rather than
quietly adopting its parent directory as a watch folder, or teaching the
scanner to keep orphan rows, the drop is **prevented** and a modal says why —
"*Player only tracks folders you have added. `X.mp3` is not inside one. Add its
folder instead?*" — offering the folder as the action.

A mixed drop is not all-or-nothing: whatever *is* inside a watch folder, or is
a folder itself, is ingested, and the modal reports only what was skipped. The
modal is the one exception to the app's "no dialogs for routine work" leaning,
because silently dropping half a drag is worse than an interruption.

**16 — Row status column** `feat/16-status` — ✅ **merged** (PR #35)

*Built. What shipped, and where it differed from the sketch below:*

- **Migration 4** adds `tracks.missing_since INTEGER NULL` with a **partial**
  index (`WHERE missing_since IS NOT NULL`), so it costs one entry per missing
  file rather than one per track - the "are any missing" question rides along
  with every stats refresh, and in a healthy library the answer is none.
- The scan plan gained `missing` and `returned` in place of `removed`, and
  `ScanSummary` reports both. Already-marked files are deliberately left out of
  `missing`, so the timestamp says when a file went rather than when it was
  last looked for, and a second scan over the same absence reports nothing.
- **The playlist test written in phase 6 to pin the old behaviour is now
  inverted**, which is exactly what it was for: `a_file_that_disappears_-
  currently_takes_its_playlist_entry_with_it` became
  `..._keeps_its_playlist_entry`, with a second test covering the deliberate
  removal taking the entries with it.
- `Event::LoadFailed(track_id)` is emitted alongside the existing
  `Event::Error(String)` rather than replacing it: the message is for the user
  and the id is what lets the library mark the row, and one string cannot be
  both.
- `LibraryStats` gained `missing`, folded into the same scan as the other three
  totals - it is asked for exactly when they are. A perf guard pins that it
  needs no budget of its own, and another pins the worst case of the new write
  path: marking an entire 10k library missing at once, which is what an
  unplugged drive looks like.
- The remove affordance is a **toolbar button that only exists when there is
  something to remove**, behind the existing `ConfirmDialog`. Its wording names
  the cost that is easy to miss - the playlist entries - and says what to do
  instead if a drive is merely unplugged.
- **A bug the user caught in review:** the playing speaker was `var(--accent)`
  on a selected row whose background is `var(--accent)`, so it was invisible
  until the selection moved off it. Both markers now take `color: inherit` on
  the selected row, and a CSS guard requires any `.row-status.*` rule that sets
  a colour to have that override. The glyphs carry the meaning without the
  colour, which is why losing it there costs nothing.
- `--danger` is now a theme variable in both blocks. It replaces the literal
  `#c0392b` in `.content-error`, which was the one red the theme-parity guard
  could not see and which read as brown on the dark surface.
- `App.css.test.ts` gains `ANIMATION_ALLOWED`, a one-entry exception list
  parallel to `HOVER_ALLOWED`, plus a check that the exception is turned off
  under `prefers-reduced-motion`. An exception that ignores the OS setting is
  the rule phase 13 removed coming back through a side door.
- `headerBounds()` now queries `th[data-column]` rather than every `th`: the
  status header is a fixed first column with no id, and counting it would have
  offset every drag-to-reorder drop index by one.

*The original entry follows.*

A first column in every view, narrow and unlabeled, showing what is true about
each file:

- **Currently playing** — an animated speaker (inline SVG, CSS-animated bars).
- **Missing on disk** — a red exclamation mark.
- Everything else — empty.

*The hard part is not the icon, it is the state behind it.* The scanner
currently **deletes** rows whose files have disappeared, so "missing" is not a
state the library can be in. This phase changes that:

- Migration 3 adds `tracks.missing_since INTEGER NULL`. A scan that no longer
  finds a file **marks** it instead of deleting it; a file that reappears is
  unmarked. Deletion moves to an explicit user action ("Remove missing tracks
  from library"), which is the only place rows are destroyed.
- That is a better model regardless of the icon: today an unplugged external
  drive silently destroys every playlist entry that pointed at it, and a
  rescan cannot bring them back because the rows are gone. Marking makes an
  unplugged drive a temporary condition rather than data loss.
- A second, cheaper signal comes free: `AudioSink::load` already fails on a
  file that is not there, so a failed play marks that one track immediately
  rather than waiting for a scan. The engine's "give up after five unreadable
  files" rule then reads as "five missing files", which is the right message.
- Nothing stats the filesystem during rendering. 50k `stat` calls to paint a
  column is exactly the kind of thing this app exists to avoid.

*UI details that are easy to get wrong:*

- The column is **fixed**: first, non-reorderable, non-hideable, and not a
  sort target. It carries no header text, so its `<th>` needs a
  visually-hidden name ("Status") or screen readers announce an empty column.
- An icon-only cell is not a label. Each state carries visually-hidden text —
  "Playing", "File missing" — and the missing state gets a `title` with the
  path, since "why is this red" is the immediate question.
- **Red alone must not be the signal**: an exclamation glyph carries the
  meaning for anyone who cannot distinguish the colour.
- The speaker animation honours `prefers-reduced-motion` by falling back to a
  static speaker. It is also the deliberate exception to phase 13's
  no-animation rule: this animation *is* the state, not decoration.

*Testing:* migration up and down a version, a scan that marks and then unmarks
a file that returns, playlist entries surviving a disappearance, a failed load
marking its track, and the component tests covering all three cell states plus
the accessible names. The perf guard gains a check that the marking scan is no
more expensive than the deleting one was.

*Note on ordering:* this wants to land after phase 6 (playlists), because
"playlist entries survive a missing file" is most of the argument for it and
cannot be tested before playlists exist.

**17 — Context menus, and dropping onto nothing** `feat/17-context-menus` — ✅ **merged** (`8caf601`)

*Built. What shipped, and where it differed from the sketch below:*

- `ContextMenu.tsx` — one component, positioned at the pointer in **fixed**
  coordinates (an absolutely-positioned menu inside the scrolling table would
  travel with the rows it describes), nudged back inside the viewport after
  measuring rather than by guessing a height, since the playlist submenu makes
  the size depend on the library. Arrows move, Enter and Space pick, Escape
  backs out one level then closes, Home/End jump, separators and disabled
  entries are skipped by the keyboard rather than landed on. It closes on
  outside click **in the capture phase**, so the click that dismisses it does
  not also select the row underneath.
- `rowMenu.ts` — which entries a song row offers, as a **pure function**, so
  the rules are tested without a pointer: singular/plural labels, smart
  playlists excluded from "Add to Playlist" rather than greyed, "Remove from
  Playlist" only inside a static one, "Show in Explorer" disabled unless
  exactly one row is selected.
- `reveal.rs` + `reveal_track` — **our own command, not `tauri-plugin-opener`**.
  The plugin would do the same job, but every plugin API is ACL-gated and a
  missing permission fails only at runtime; that has now shipped a dead
  feature twice. Our own commands are not gated, so this route has no such
  trap. On Windows `/select,` and the path must be **one argument** — passing
  them apart opens the parent with nothing highlighted, which looks like it
  half-worked. Pinned by a test.
- `AppError::NotFound` — a new variant. Revealing a file that is no longer on
  disk is refused rather than opening an empty folder: "where is it?" and "it
  is gone" are different answers.
- **Removed, as the user asked**: the `.sidebar-action` Rename / Delete / ⚙
  buttons and their CSS, and the **Get Info toolbar button**. Get Info gained
  **Ctrl+I** first — a menu is not a substitute for a shortcut, so the
  shortcut had to exist before the button could go. Undo Tag Edit stays in the
  toolbar: it acts on the last edit, not on a selection, so no row menu is its
  home. Export stays too, acting on the current view.
- Right-clicking a row **outside** the selection selects it first, the way
  every file manager does; right-clicking **inside** one leaves it alone.
- `playPlaylist` fetches the playlist's ids directly rather than reading the
  current view, which it switches in the same breath and would otherwise race.

*Still open:* the header-cell menu for choosing columns, which needs the
column work that has not landed yet.

---

*The original sketch follows.*

Two things the second real build asked for that had never been built.

*Context menus.* There is no right-click menu anywhere in the app, which is
why "edit this" is a toolbar button rather than where a desktop user looks
for it. Wanted:

- **On a song row**: Play, Get Info, Add to Playlist ▸ (a submenu of every
  static playlist — also the first keyboard route to that, since dragging is
  mouse-only), Remove from Playlist when one is open, Export Selection,
  Show in Explorer.
- **On a sidebar playlist**: Rename, Delete, Edit Filter for a smart one,
  Export, Play.
- **On the table's header**: which columns to show, once phase 13-ish column
  work gives that somewhere to live.

The menu itself has to be built rather than borrowed: `contextmenu` is
suppressed app-wide by the native-feel pass, and a native OS menu through
Tauri's menu API cannot render a live list of playlists cheaply. One small
component, positioned at the pointer, dismissed on Escape, outside click or
scroll, with arrow-key navigation — the usual list, none of it hard, but it
is a component with real keyboard semantics rather than a styled `<ul>`.

*Dropping a song onto empty sidebar space creates a playlist* named after…
nothing obvious, which is the design question. iTunes names it "untitled
playlist" and starts a rename. Doing the same, with the drop landing first so
the rename is over something real, seems right.

*Testing:* the menu's keyboard and dismissal behaviour is component-testable;
the "create by dropping" path is the phase 6 drop handler with a different
target, so it needs one store test and one component test.

*Note:* this is where the invisible-gesture problem from the second build
actually gets solved. The Rename/Delete buttons added as a fix are a stopgap —
they are only on the open playlist, and a row of glyphs in a sidebar is not
where those actions belong long-term.

*Settled (2026-08-02): **no delete-from-disk**.* The row menu offers "Remove
from Playlist" only inside a static playlist, where there is a membership row
to remove. In the library the same entry could only mean deleting the file;
the user was asked directly and said no. Not a gap, a decision - do not add it
back with a confirmation dialog and call it an improvement.

*Confirmed by the third build (2026-08-02):* the user asked for exactly this —
"move actions to where they are commonly found… then the buttons to do so
currently can get removed". So the removals are part of the phase, not a
follow-up, and the phase is not done until they happen:

- `.sidebar-action` Rename / Delete / ⚙ Edit Filter buttons in
  `PlaylistSidebar.tsx` — deleted, their tests moved onto the menu.
- The Get Info toolbar button — the menu becomes the primary route. Keep the
  Ctrl+I-style keyboard path; a menu is not a substitute for a shortcut.
- Double-click-to-rename stays. It is invisible, but it is also the gesture
  every file manager has, and it costs nothing to keep.

The Export button is the one that stays put: it acts on the current view,
which is a toolbar's job, not a specific row's.

**18 — Tag and filter autocompletion** `feat/18-tag-complete`
Typing "Godspeed You! Black Emperor" correctly, by hand, for the fourth time
is how libraries acquire three spellings of one band. The tag editor should
suggest values already present elsewhere in the library.

*Which fields.* Only the ones with a shared vocabulary — where two songs
genuinely ought to agree:

| Suggested | Not suggested |
|---|---|
| Artist, Album Artist, Album, Genre, Composer, Year | Title, Track Number, Disc Number, Comment |

The right-hand column is per-song by nature; a dropdown of other songs'
comments is noise at best and a way to paste the wrong data at worst. This
was called out explicitly in the request.

*Where the values come from.* `SELECT DISTINCT` over 50k rows on every
keystroke is not viable, so the distinct values get their own table,
maintained as part of the same writes that already touch `tracks`:

```sql
CREATE TABLE tag_values (
    field TEXT NOT NULL,        -- 'artist' | 'album' | …, a whitelist, never user text
    value TEXT NOT NULL,
    uses  INTEGER NOT NULL,     -- how many tracks carry it
    PRIMARY KEY (field, value)) WITHOUT ROWID;
CREATE INDEX idx_tag_values_lookup ON tag_values(field, value COLLATE NOCASE);
```

Rebuilt at the end of a scan (one pass, already paying for the walk) and
adjusted incrementally by the phase 8 tag writer, so an edit's new value is
suggestable immediately. `uses` orders the suggestions, so the spelling you
use 400 times outranks the typo you made once — and a value that drops to
zero uses is deleted, so a corrected typo stops being offered.

Lookup is `WHERE field = ? AND value LIKE ? ESCAPE '\' COLLATE NOCASE
ORDER BY uses DESC LIMIT 8`, reusing phase 7's `like_escape`. Prefix matches
rank above interior ones. Query on the Rust side, debounced on the JS side —
the same debounce phase 5 already has.

*Also the smart playlist editor.* A filter rule's value field is the same
problem wearing a different hat - "artist is ___" wants the same suggestions
as the tag editor's Artist field, and typing a band name by hand into a
filter is how a smart playlist ends up matching nothing. The rule's chosen
`FilterField` picks which vocabulary to offer, and the fields with no shared
vocabulary (track number, comment) offer none, exactly as in the editor. The
`is`/`is not` operators want the full list; `contains` wants it too but
matches loosely. Requested on the fifth build; the lookup is the same, so
this is one phase, not two.

*Interaction.* A combobox, not a hijack: the field stays free text, because
a new artist has to be typeable. Suggestions appear below, Down/Up move
through them, Enter or Tab accepts, Escape dismisses the list without
dismissing the dialog — which needs care, since `useDialogKeys` currently
takes Escape as "cancel the edit". Ties into the bulk editor's mixed-value
"—" state: picking a suggestion is a touch, and so it writes.

*Testing:* Rust — the incremental `uses` bookkeeping through an edit and an
undo (this is where it will break), `LIKE` escaping, the field whitelist,
and a perf-lite assertion that a lookup against a 50k-row fixture stays
under budget. Frontend — keyboard navigation, that Escape closes the list
before the dialog, and that the non-suggested fields have no combobox at all.

---

**19 — Browse by album, artist and genre** `feat/19-browse` — ✅ **merged** (PR #27)
The Songs / Albums / Artists / Genres tabs were rendered `disabled` with a
"Not implemented yet" tooltip from phase 3 until this one - three quarters of
the primary navigation being dead chrome, and the last piece of the reference
layout that was decoration rather than function.

- **A grouped query, not a new store.** Albums are
  `SELECT album, album_artist, count(*), sum(duration_ms), min(cover_hash),
  min(year) FROM tracks <scope> GROUP BY album_artist, album`, run through the
  same `scope()` the songs table uses - so a search or an open playlist
  narrows the album list exactly as it narrows the rows, for free.
- **Grouping key.** `(album_artist, album)`, falling back to `artist` where
  `album_artist` is absent, so a compilation does not shatter into one album
  per track. Untagged files group under a single "Unknown Album" rather than
  vanishing.
- **Albums** is a grid of cover tiles; **Artists** and **Genres** are lists.
  All three drill into the songs table with the corresponding filter applied,
  which is the existing view with a query change - not a fourth table.
- **Virtualized too.** Ten thousand mp3s is perhaps eight hundred albums and
  three hundred artists, which is small enough to render whole and large
  enough that doing so would be the one place in the app that stutters.
- Cover art comes through the existing `cover://` protocol, one request per
  album rather than per track, which is what `covers.hash` dedupes for.

*Testing:* the grouping SQL against a fixture including a compilation, an
untagged file and an album spanning two discs; a perf guard, since this is a
`GROUP BY` over the whole library rather than a paged read; component tests
for the drill-in and for the empty state of each tab.

**20 — Column customization** `feat/20-columns` — ✅ **merged** (PR #30)
Two of the original requirements - "adjustable column display" and "per
playlist" - that phase 3's plan entry claimed and phase 3 did not deliver.

- **Which columns**: a right-click menu on the table header, listing every
  entry in `ALL_COLUMNS` with a check beside the visible ones. This is the
  header menu phase 17 deferred for want of somewhere to put it; the
  `ContextMenu` component it needs now exists.
- **Width**: drag a header divider. Widths are already per-column data
  (`ColumnDef.width`), so this is a stored override rather than new plumbing.
- **Order**: drag a header. Confirmed absent by the user on the fourth build -
  *"it's currently not possible to reorder them, but sorting does work"* -
  which is the split this phase inherits: clicking a header sorts, and that is
  all a header does today. Dragging one has to become a reorder without
  swallowing the click that sorts, so the two need a drag threshold between
  them rather than a mode.
- **Persistence** is what makes this per-playlist: `playlists.columns_json`
  has been in the schema since phase 2 and has never been written. The global
  view keeps its own row in `settings`, as planned. A playlist with no stored
  configuration inherits the global one rather than starting bare.
- Reset to defaults belongs in the same menu; a user who hides five columns
  needs a way back that is not "guess which ones".

*Testing:* the visible/order/width reducer as a pure function including the
"you cannot hide every column" floor, persistence round-tripping per playlist
and falling back to the global set, and that a hidden column that is also the
current sort does not leave the view sorted by something invisible - the case
that will actually bite.

---

**21 — Density and zoom** `feat/21-scale` - ✅ **confirmed by the user**

> **Revised (2026-08-02), at the user's direction:** *"consider increasing
> size across the board so the new default remains 1.0. if there's a better
> approach to increase scaling rather than literally scaling, please use
> that."* Both points taken. The phase is now two separable pieces, and the
> earlier sketch's CSS-`zoom`/`--scale` approach is dropped.

**21a — Rebase the density so 1.0 is right.**

A slider defaulting to 1.2x would have shipped an app that admits its own
sizing is wrong and makes the user correct it on every install. The sizes
themselves move instead:

- Base `font-size` 12px, `ROW_HEIGHT` 22, and the control heights around them
  were taken from iTunes 11 and Explorer, which were designed for displays of
  their day. Multiply the type and spacing scale by ~1.2 and **round to whole
  pixels** rather than carrying fractions - a 26px row is a row; a 26.4px row
  is a blurry one on a 1x display.
- `ROW_HEIGHT` is the number to get right first, because it is the one the
  virtualizer measures and everything else in the table hangs off it.
- The `App.css.test.ts` guard already asserts that light and dark define the
  same variables; the density values are not variables today, and part of this
  is making the ones that repeat (`--row-height`, control height, gutter) into
  variables so a future pass is one edit rather than forty.

**21b — Zoom, through the webview rather than through CSS.**

`getCurrentWebview().setZoom(factor)` - confirmed present in
`@tauri-apps/api`, gated behind `core:webview:allow-set-webview-zoom`, which
the capability file and the guard's table both need a row for.

This is the better approach the user asked for, and specifically it **removes
the risk that made the earlier sketch a phase at all**: the webview scales the
whole rendering, and CSS pixel coordinates are unchanged by it. `ROW_HEIGHT`
stays 26 whatever the zoom, `getBoundingClientRect` keeps returning CSS
pixels, and TanStack Virtual's `estimateSize` needs no knowledge of the
setting. Under a CSS transform or `zoom` the rendered row and the estimate
drift apart, which surfaces as overlapping rows and a scrollbar that lies.
Text is also laid out at the target size rather than rasterized and stretched,
so it stays crisp.

- **Default 1.0**, range 0.8-2.0 in 0.1 steps, current value shown as a
  number beside the slider.
- **Persisted** in `settings` next to volume and window geometry, and applied
  during startup **before the window is shown** - the window already starts
  hidden for the geometry restore, so this costs nothing extra and avoids a
  visible resize.
- **Ctrl+plus / Ctrl+minus / Ctrl+0** should drive the same setting. Users try
  them; if the app does not handle them the webview may act on its own and
  leave the slider lying about the current value.
- Where the slider lives is worth a look during the work: the status bar is
  what was asked for, and it is also the app's quietest strip, which suits a
  control touched once.

*Testing:* the clamp and step arithmetic as a pure function; persistence
round-trip; that startup applies the stored zoom before showing the window;
that the keyboard shortcuts and the slider converge on one value rather than
two; and a capability-guard row, so a missing `allow-set-webview-zoom` fails
in CI rather than silently doing nothing - which is exactly how `dialog.save`,
`setPosition` and `maximize` each shipped dead.

*Sequencing:* 21a stands alone and is worth doing first - it is the fix for
the actual complaint. 21b is the adjustable knob on top, and if 21a lands the
density well it may be wanted less urgently than it looks now.

**22 — Media keys that work without focus** `feat/22-global-keys` — ✅ **merged** (PR #32)
Play/pause already answers `MediaPlayPause` and the transport keys, but only
while the window has focus - `shortcutFor` is wired to a `keydown` listener on
`window`, and a background app receives no key events at all. That is a
correct web app and a wrong music player: the whole point of a media key is
that the player is behind something else.

- `tauri-plugin-global-shortcut` registers with the OS, so the keys arrive
  whatever has focus. New Rust dependency, new npm package, and a capability
  entry - which the guard's table needs a row for, since a missing permission
  here fails silently at runtime exactly like the last three.
- **Register the media keys only**: `MediaPlayPause`, `MediaTrackNext`,
  `MediaTrackPrevious`, `MediaStop`. **Not Space**, and not the arrow keys.
  A global shortcut is exclusive - the OS routes it to whoever claimed it and
  to nobody else - so binding Space system-wide would break the space bar in
  every other application on the machine. The in-window bindings for Space and
  the arrows stay exactly as they are; this phase adds a second, narrower path
  rather than moving the first one.
- **Registration can fail, and that is normal.** Another player already
  holding the key means `register` errors, and the honest response is to carry
  on without it rather than to show an error - the user has two media players
  installed, which is not a fault condition. Worth surfacing once in settings
  ("Media keys are in use by another application") rather than as a toast.
- **Unregister on exit**, and on window close, so a killed app does not leave
  the OS routing media keys to nothing.
- Windows also has SMTC (the volume-flyout transport panel) for title, artist
  and artwork. That is a bigger piece of work, is not what was asked for, and
  is worth a separate phase if it is ever wanted. Flagged, not folded in.

*Testing:* the registration list and the failure path are unit-testable
against a mocked plugin; that the in-window mapping still handles Space and
the arrows unchanged is already covered and must stay green; a capability
guard row. Whether the OS actually delivers the key when the window is
unfocused cannot be tested in CI or in jsdom - it needs a real build, the same
as drag-and-drop and Show in Explorer.

**23 — In-app updates** `feat/23-updater` — ✅ **merged** (PR #23)

**Both blockers this entry opened with are gone.** The repository is public, so
release assets are fetchable without a credential embedded in a shipped binary;
and the minisign keypair exists, is backed up outside this repo, and has been
verified end to end - a published installer checked against the `pubkey` in
`tauri.conf.json` with ed25519 over a blake2b512 prehash. (Minisign is the
updater's own signing and is unrelated to the Authenticode code signing ruled
out at the start.) Losing that private key still means no existing install can
ever update again.

**Most of the plumbing landed early**, alongside the release workflow in phase
20: the plugin, its config, the store, the timer and the footer line all
shipped there. What this phase is actually about is that the behaviour they
implemented was wrong in one specific and serious way, and correcting it took
the design with it.

*The defect.* The launch check called the plugin's `downloadAndInstall`, whose
second half is not a download. On Windows `Update::install` hands the installer
to `ShellExecute` and then calls `std::process::exit(0)`
(`tauri-plugin-updater-2.10.1/src/updater.rs:865`). So the shipped behaviour
was: a timer notices a release, and the app disappears mid-song, taking the
queue with it, with no prompt and nothing on screen. The `relaunch()` in the
store's `install` was dead code that no code path could reach - the process was
already gone. Nothing caught it because the tests mocked `downloadAndInstall`
as a resolving promise, which is the one thing it never does.

The fix is to call `download()` and `install()` separately - the plugin exposes
both - hold the `Update` handle in the store between them, and let only a
button press reach `install`.

**Apply-on-quit is not achievable on Windows, and that is a finding, not a
shortcut.** This entry's headline behaviour was "apply on quit, never
mid-session, so the next launch is quietly already the new version". Installing
on quit is possible; being quiet about it is not. The plugin's Windows path
passes the install mode's arguments to the NSIS installer, and both modes that
suppress the installer UI hard-code `/R`
(`tauri-plugin-updater-2.10.1/src/config.rs:41`) - `Passive` is `["/P", "/R"]`
and `Quiet` is `["/S", "/R"]`. `/R` means restart the app afterwards, which the
installer template does unconditionally in silent and passive modes. The only
mode that omits it, `BasicUi`, omits it by showing the installer's window
instead. `installer_args` appends, so `/R` cannot be taken back off. An
apply-on-quit built on this reopens the app you just closed, which is worse
than not having it.

*So the shipped behaviour is the user's second option, with the wait already
paid:* check quietly on launch and every six hours, download in the background
without asking, then say so in the footer - *"0.3.0 ready — restart to
install"* - and install only on the click. The installer's own relaunch is
correct there, because the user asked for it: the app goes away and comes back
on the new version. A check that finds nothing, or fails because the machine is
offline, is not news and shows nothing.

*Two consequences worth knowing.* The download lives in the Rust resource
behind the handle, so quitting without clicking discards it and the next launch
fetches it again - acceptable for a file this size, and the alternative is a
cache with its own invalidation problem. And `@tauri-apps/plugin-process` came
out along with `process:allow-restart`: nothing relaunches anything any more,
and a granted permission with no caller is exactly what the capability guard
exists to prevent.

**A "Check for updates" item still belongs wherever settings eventually live.**
There is no settings surface yet, and the footer is not one. Deferred rather
than dropped.

**What the release workflow needs**, already in place since phase 20: `tauri
build` produces the updater artifacts and their `.sig` files when the plugin is
configured and the signing key is in the environment, and the release job
uploads a generated `latest.json` alongside the installers. That file is what
`endpoints` points at.

*Testing:* the state machine mocks cleanly (idle → checking → downloading →
ready → installing → failed), and the test that matters asserts a negative -
that a check never calls `install`, which is the defect above stated as a
guard. Alongside it: a failed download leaves no install button pointing at
nothing, a timer tick does not restart a download in flight or discard a
finished one, and at the App level that checking and downloading show nothing
while `ready` shows the offer and the click installs. The install itself cannot
be tested anywhere - it replaces the running binary - so the first real update
is verified by hand, once, exactly like the release workflow was.

**24 — Base UI primitives** `feat/24-base-ui` — ✅ **merged** (PR #36)

*Built, in the order this entry sets out. What shipped, and where it differed:*

- **The overlays.** `ContextMenu` is `ContextMenu.Root/Trigger` with the region
  as the trigger, exactly as the rescope demanded. `ConfirmDialog` is
  `AlertDialog`; both editors are `Dialog`; `useDialogKeys` is deleted.
  Deleted with them: the measure-then-nudge effect, the resize and scroll close
  handlers, the capture-phase `mousedown` listener, the `step`/`choose`
  keyboard machine, the `createPortal` out of `<thead>`, and `.context-row` /
  `.context-submenu`.
- **The chrome.** `TabBar` is `Tabs`, both sliders are `Slider`, the library
  actions are a `Toolbar`.
- **The editors: not done, by the stop clause below.** See the end of this
  entry.

*Three behaviour changes a user could notice, none of them regressions:*

1. **Arrow keys land on disabled menu items** instead of stepping over them.
   Base UI hard-codes `disabledIndices` to empty
   (`menu/root/MenuRoot.js`), which is the ARIA menu recommendation: an entry
   the keyboard cannot reach is one a keyboard user never learns exists.
   Activating one still does nothing and leaves the menu open, which is what
   the test now pins.
2. **Right-clicking a playlist no longer selects it.** That existed so the
   highlight said which playlist Delete meant; a per-row trigger answers the
   question without changing what the table is showing.
3. **Tabs activate on Enter, not on arrow.** Base UI's default, and the right
   one here rather than a detail: selecting a tab re-runs the library query, so
   arrowing across all four would otherwise fire four of them.

*Things that only came up in the doing:*

- **The scrubber's real win was `onValueCommitted`.** Not the styling: a range
  input's `onChange` fires throughout a drag, so dragging across a five-minute
  song sent a seek per pixel, each one a real seek in the decoder on the audio
  thread. Volume keeps `onValueChange`, because it is meant to be heard as it
  moves.
- **`ConfirmDialog` re-claims focus on the next frame.** Every route into it
  runs through a context menu, and a menu returns focus to its trigger as it
  unmounts - *after* the dialog has taken focus. Without this the sidebar row
  ends up focused behind an open dialog, and Enter reopens the menu that asked
  the question.
- **`vite.config.ts` gained its first accepted warning.** Base UI's popup store
  and its Floating UI root context import each other; rollup resolves it and
  this project cannot act on it. The exception is scoped to cycles whose every
  module is inside `node_modules`, so our own code is still held to the rule.
- **Two tests the old code could not pass**, as promised: Tab never reaches the
  page behind an open dialog, and tabbing off the last control comes back round
  rather than falling out. The first asserts against a real element outside the
  dialog, which is also unreachable *by role* - the modal takes the rest of the
  page out of the accessibility tree.
- **The stylesheet guards changed as predicted.** `.context-row` /
  `.context-submenu` are asserted *absent* now, and the highlight assertion got
  stricter: `.context-item` is out of `HOVER_ALLOWED` entirely, because
  `data-highlighted` covers the pointer and the keyboard alike and a `:hover`
  rule would now light up two rows at once.

**Bundle.** 464.85 kB raw / 149.98 kB gzipped, against the 291.63 kB / 90.54 kB
baseline recorded after phase 20: **+173 kB raw, +59 kB gzipped**. Larger than
"tree-shaken per component" implies. For an app that loads from local disk it
buys a focus trap, an inert background, real collision handling and a tablist
that works, which is the trade this phase was for - but the number is bigger
than the entry assumed, and it is the number rather than the assumption.

**Why the editors stopped here.** This entry's own instruction: *"If it reads
worse at the densities from phase 21, stop here and keep the native controls -
the phase is still a win without this step."* The three `<select>`s stay
native, because a native select in a webview opens a real OS popup, which is
closer to native than any listbox can be - and phase 13's whole argument is
that this app should not look like a web page wearing a desktop costume.
`Field` was skipped with them: it would replace a `useId` pairing that works
and is tested, changing nothing a user can see while adding to the number
above. Both are a judgement call rather than a technical block, and worth
revisiting if the native selects ever look wrong beside the Base UI menus.

*The original entry follows.*

Replace the hand-rolled interaction layer with [Base UI](https://base-ui.com)
(`@base-ui/react`), keeping every line of the app's visual identity. The
library ships no CSS and prescribes no styling solution, so this is a
behaviour swap rather than a restyle: `App.css` keeps its tokens, its density
and its native-feel rules, and each Base UI part is handed the class that
already exists. Setup is two declarations - `isolation: isolate` on the app
root and `position: relative` on `body` - and no provider component.

**Why, when phase 13 argued the other way.** The comments in `ContextMenu` and
`ConfirmDialog` explain why each was built rather than borrowed, and every one
of those reasons still holds: they are arguments against an *OS* menu and an
*OS* message box, not against a headless primitive. What has not held is the
cost. Submenu alignment, collision nudging, outside-click capture and focus
restoration are all things this project has now debugged by hand, and neither
modal has a focus trap or an inert background today.

**The overlays, first and worth the most - and larger than this phase first
assumed.** A spike on 2026-08-03 built the adapter this entry originally
described and found its central claim false, so the shape below is what the
code actually requires.

*What the spike established.* `Menu.Positioner`'s `anchor` does accept a
virtual element, so a zero-sized rect at the pointer positions the menu
correctly and the `{x, y}` prop survives. Positioning was never the problem.
**Keyboard navigation was.** Base UI wires a menu's arrow-key handling through
its trigger, and a menu rendered `open` at a captured position has none;
focusing the popup on mount does not substitute. Six of the thirteen existing
`ContextMenu` tests failed - every arrow-key and submenu case - against an
adapter that was otherwise working. Base UI ships a dedicated `ContextMenu`
part for exactly this situation, but it is `Root` + `Trigger` only: it owns the
`contextmenu` event and derives the pointer position itself.

*So this is a call-site refactor, not an adapter swap.* The premise that
`SongTable.tsx`, `PlaylistSidebar.tsx` and `rowMenu.ts` stay untouched does not
hold, and pretending otherwise buys a menu whose keyboard support is worse than
today's. Each place that opens a menu wraps the region it applies to in a
`ContextMenu.Trigger` and stops capturing the event itself:

- **`SongTable.tsx`** - the `<tbody>` becomes the trigger. The row-menu state
  (`menu.at`, `menu.trackIds`, `menu.rowIndex`) loses its `at`, since Base UI
  owns the position; what stays is *which rows the menu acts on*, which the
  existing `onContextMenu` still decides before the trigger opens.
- **`PlaylistSidebar.tsx`** - each playlist row becomes its own trigger, which
  also removes the "right-clicking a playlist selects it" special case: the
  trigger is the row, so there is no question which one was hit.
- **`ColumnHeader.tsx`** - the header `<tr>` becomes the trigger, replacing the
  `onContextMenu` added in phase 20.
- **`rowMenu.ts` is genuinely untouched.** It builds a `MenuItem[]` and knows
  nothing about how the menu opens, which is the part of the original claim
  that survives.

The `MenuItem` union stays as the shared vocabulary; `ContextMenu.tsx` keeps
exporting a component that takes `items`, and gains a `children` prop for the
trigger region in place of `position`. What still gets deleted is everything
the spike confirmed is dead weight: the measure-then-nudge effect, the resize
and scroll close handlers, the capture-phase `mousedown` listener, and the
`step`/`choose` keyboard machine. Submenus become `SubmenuRoot`, and
`.context-row`'s `position: relative` - the phase 17 fix for submenus opening
at the panel top - goes with them.

*Do it properly rather than partially.* Keeping the hand-rolled menu and
adopting Base UI only for the dialogs and chrome was considered and rejected on
2026-08-03: the menu is where the focus, collision and submenu bugs actually
were, so excluding it would leave the phase's main benefit on the table. The
larger refactor is the point, not a cost to be minimised.

`ConfirmDialog` becomes `AlertDialog`, which is the role its own prose already
claims; the tag and filter editors become `Dialog`; and `useDialogKeys` is
deleted, because Escape is the library's and Enter-to-accept becomes a real
`<form onSubmit>` - which is what that hook's `BUTTON`/`SELECT`/`TEXTAREA`
exclusion list was approximating.

**Then the chrome.** `TabBar` becomes `Tabs` and gains the arrow-key
navigation a `role="tablist"` is supposed to have and currently does not. The
volume control in `Transport.tsx` and the scrubber in `StatusDisplay.tsx`
become `Slider`, retiring the `::-webkit-slider-thumb` rules for a real
`Slider.Thumb`; the win there is less the styling than the commit semantics,
since a scrubber wants its value on drag end and `onChange` fires throughout.
`Toolbar` and `Separator` take the toolbar row and the menu rules.

**Then the editors, last and least certain.** The three `<select>`s in
`SmartPlaylistEditor.tsx` become `Select`, and the text inputs in both editors
move to `Field`, whose label/control wiring replaces the `useId` pairing in
`TagEditor`'s `TagField`. This is the part with the weakest case: Base UI's
`Select` is a custom listbox, and a native `<select>` in a webview already
opens a real OS popup, which is closer to native than any listbox can be. **If
it reads worse at the densities from phase 21, stop here and keep the native
controls** - the phase is still a win without this step.

**What does not move.** The virtualized table stays TanStack. The custom title
bar, its drag regions and the LCD status display stay bespoke: they are the
layout, and no library ships them.

**The stylesheet test changes on purpose.** `src/App.css.test.ts` asserts CSS
facts this phase makes false - the `.context-row` / `.context-submenu`
positioning pair disappears once Floating UI does the work, and
`.context-item`'s entry in `HOVER_ALLOWED` is obsolete once the highlight
moves to `[data-highlighted]`. Both are replaced rather than dropped, and the
highlight assertion gets *stricter*, since with Base UI no selector needs a
hover exception at all. The guards that carry phase 13 - no transitions, no
pointer cursor, both themes for every variable, the fixed-height status
display - all stay green untouched. The global `*{transition:none}` rule means
Base UI popups unmount immediately rather than animating out, which is the
wanted behaviour here.

**Bundle and startup.** Tree-shaken per component, into an app that loads from
disk. Not a cost worth trading behaviour for, but record the built bundle size
before and after so the claim is a number rather than an assumption. The
baseline, measured after phase 20: **291,628 bytes** for the main chunk
(90.54 kB gzipped).

**The package is `@base-ui/react`, currently 1.6.0.** Worth stating because
`@base-ui-components/react` also exists on npm - the former name - and is still
published at `1.0.0-rc.0`, so a version check on the wrong one reads as "this
library is barely released".

*Testing:* the component tests are the specification and should move as little
as possible. `ContextMenu.test.tsx` already queries `getByRole("menuitem")` and
drives the arrow keys through `userEvent`, which is what Base UI's roles and
keyboard handling satisfy - but its *setup* has to change with the API: a test
that renders the menu at a position must instead render a trigger and
right-click it. The spike showed those six keyboard tests failing as the signal
that the adapter approach was wrong, so they are the ones to watch: they should
pass without their assertions being weakened. Beyond that, expect to touch only
what asserts internals - the `.active` class, and the container holding focus
rather than the item. Base UI portals to `document.body`, so `chrome.test.tsx` and the
editor tests keep working under jsdom through `screen` rather than container
queries. Add the two tests the old code could not pass: focus stays trapped
inside an open dialog, and Tab from the last item wraps to the first. The e2e
smoke suite is the real proof for the positioning work, since jsdom reports
every rect as zero.

---

**25 — Frontend render pass** `perf/25-frontend-renders` — ✅ **done** (PR #38)

Three store values changed on a schedule of their own and were all read at the
top of `App`, so each re-rendered the whole tree - the song table and its forty
virtualized rows included.

| What | How often | Song-table renders before | After |
|---|---|---|---|
| `positionMs` | every 250ms while playing | 960 per four-minute track | 0 |
| `volume` | every pointer move during a drag | 50 per 50-sample drag | 0 |
| `searchInput` | every keystroke | 5 per five-letter word | 0 |

Each moved into a component that subscribes on its own behalf -
`NowPlayingStatus`, `PlayerTransport`, `SearchBox`. The volume case was the one
not predicted: the slider reports with `onValueChange` rather than
`onValueCommitted`, deliberately, so it writes at the pointer's sampling rate,
faster than the audio thread ticks.

`App.renders.test.tsx` counts renders rather than timing them - a count is exact
where a wall-clock budget on a CI runner is noise. **File splitting is not what
delivers this**: the lever is where the subscription lives, which is a component
boundary, not a module boundary.

`memo(SongTable)` was deliberately **not** taken. Nothing left in `App` changes
often enough, the table subscribes to the selection itself so the one frequent
update would re-render it regardless, and it would first need `resolveColumns`
memoized and four callbacks stabilized or `memo` never hits. Revisit only with a
profile that justifies it.

---

**26 — Licence and third-party notices** `chore/26-license-notices` — ✅ **done** (PR #40)

The project had no licence at all, which makes it legally unusable by anyone who
finds it - public on GitHub is not a grant. Now MIT.

The dependencies were the real work. Nothing forces a licence on our code, but
MIT/BSD/ISC all require their copyright notice to travel with a binary, and
**symphonia is MPL-2.0** - the mp3 decoder, so not optional - which additionally
requires recipients be told where to get the source of the covered files.
`cssparser` and `selectors` under Tauri's webview layer are the same. v0.2.0 and
v0.3.0 shipped all of it with no notice.

`THIRD-PARTY-NOTICES.md` reproduces the licence text of all 331 packages that
reach a build, generated by `scripts/notices.mjs` and drift-checked in CI. Both
it and `LICENSE` bundle as installer resources. Licence texts are deduplicated -
per package the file was 2.6 MB, because the Apache-2.0 text is ~11 kB and
appears in about two hundred crates; each distinct text now appears once, in
613 kB, with nothing collapsed that carries a copyright line.

---

**27 — Appearance assertions in e2e** `feat/27-screenshots` — ✅ **done** (PR #44)

**The gap this closes.** Three defects reached the user in a running build
during phases 16-18: the playing icon invisible on the selected row, the modal
rendering below the footer, and form fields with a border at 1.02:1 contrast.
All three were layout or colour. All three passed 600+ green tests, because
**jsdom applies no stylesheet** - it has no layout engine and no computed
colour. The `App.css.test.ts` guards catch only what they are told to catch,
one regression at a time, after the fact.

The e2e job already builds and launches the real app on Windows, which is the
expensive part and is already paid for. Screenshots are close to free on top of
it.

*Shape - changed during the build, and this is the important part.* Screenshots
were the obvious answer and turned out to be the wrong one. Pixel baselines have
to be generated on the runner, because font rendering differs between a
developer machine and Windows Server; they flake on antialiasing; they need
storage for baselines and diffs; and a failure reports "17,000 pixels differ"
rather than what is wrong.

And none of the three motivating defects was a pixel shift. Each was a
**computed value** that could simply have been asked for: a colour, a
bounding rect, a stacking order. So the suite asserts computed values in the
real WebView2 - `getComputedStyle` and `getBoundingClientRect` - which is
deterministic, needs no baseline, costs no storage, and names the fault when it
fails ("select: border rgb(26,26,28) on rgb(25,26,28) = 1.02:1").

*What is asserted,* against the smart-playlist filter editor - the dialog an
empty library can reach, and the densest row of selects and inputs in the app:

- every field's border clears 2:1 against its own fill;
- the dialog's rect is inside the viewport, and `elementFromPoint` at its own
  centre lands inside it - which is what "below the footer" would fail;
- three chrome foreground/background pairs clear 4.5:1.

**Both themes in one run.** A runner boots light and two of the three defects
were dark-only, so light-only assertions would have caught neither. `App.css`
gained a `[data-theme="dark"]` block holding the same values as its
`prefers-color-scheme` block, which the suite sets on the root element. The
duplication is real - CSS cannot name a set of declarations and apply it from
two selectors - so `App.css.test.ts` asserts the two blocks are identical, and
the suite itself asserts the dark theme is actually different, so a
`data-theme` that stopped working could not leave both passes silently running
against light.

*Still uncovered:* anything needing a populated library - the selected-row
marker contrast, which was the first of the three defects. The smoke suite runs
against an empty library and adding music needs a native folder picker. Seeding
a SQLite file into the app data directory before launch is the way in, and is
its own piece of work. **Phase 30 closed this.**

*Cost.* The app is already built and launched by the smoke suite, so this adds
seconds of wall clock to a job already paid for, and - having dropped pixel
baselines - **nothing at all to storage**, neither in git nor in Actions
artifacts.

*Caveat.* Computed-style assertions catch what they are asked about, which is
narrower than what a human notices in a screenshot. They would not catch a
misaligned column or an overlapping label. What they do catch is the class that
has actually shipped three times - a colour that disappears into its
background, and a box in the wrong place - and they catch it without a baseline
to maintain.

---

**28 — Server-side branch protection** `chore/28-protect-main` — ✅ **done**

The README says `main` cannot be protected because GitHub gates that behind Pro
for private repositories. **That is now stale - the repo is public**, and a
`no-master-push` ruleset already exists enforcing PR-only, no force-push and no
deletion.

What it does *not* do is require the status checks, so a PR with red CI can
still be merged - the one thing the whole four-job gate exists to prevent. Add
`required_status_checks` for `frontend`, `rust`, `cargo-deny`, `e2e` and
`notices` to the existing ruleset, and correct the README paragraph.

Small, and it protects everything after it.

---

**29 — Local crash log** `feat/29-panic-log` — ✅ **done** (PR #46)

Phase 11 was cut because Sentry meant a network stack in an application whose
premise is that it does not use the network. The failure class it would have
covered is still real and still invisible: a panic on the audio thread, in the
`rayon` scan pool, or inside `symphonia` on a malformed mp3 takes the window
with it and no JS handler ever runs.

`std::panic::set_hook` writing to a log beside the database covers most of that
for a fraction of the cost. Keep the last N panics, surface the most recent one
in the app with a way to open the file, and rotate. No network, no DSN, no
opt-in toggle to design, and nothing to scrub - phase 11's whole scrubbing
section existed only because Sentry would have carried file paths, folder names
and track titles off the machine.

*Photographed, and this is new.* Phase 27 rejected screenshots as *assertions*
and that stands - pixel baselines flake on antialiasing, differ between a
developer machine and Windows Server, need storage for baselines and diffs, and
report "17,000 pixels differ" rather than what is wrong. But a pull request
that changes what the app looks like had been describing the change in prose
and asking the reviewer to imagine it.

So the e2e suite now *takes* pictures without *comparing* them. Nothing is
compared, so nothing can flake. They are never committed: a binary that changes
whenever the UI does is the cost that got baselines rejected, and it buys
nothing when nothing reads them but a human. The first attempt did commit them,
under `docs/screenshots/`, and that was reverted - a picture in the tree is a
picture that has to be maintained, reviewed and carried forever.

They still have to be *visible*, and that turned out to be the hard part. A
markdown body can only embed an image it can fetch by URL; a build artifact is
a zip behind an authenticated download; and the upload a human performs by
dragging an image into the comment box goes to GitHub's own asset host through
an endpoint that needs a web session, which no REST call replaces. So CI pushes
them to `ci/screenshots`, a branch that exists only to hold them, and rewrites
the pull request body between markers to point at raw URLs pinned to that
commit. Nothing reaches `main`, nothing appears in the diff, and the pictures
are in the pull request where they get looked at. The branch is disposable -
deleting it breaks the images in old bodies and nothing else.

The crash notice is the first subject because it is the one feature no unit
test can reach end to end. The spec provokes a **real panic** through a
test-only command - on a spawned thread, so the process survives, which is also
the case the feature exists for - then reloads the webview, the closest a
running session gets to a next launch. Everything between is the real path:
hook, formatter, log file, `last_crash`, IPC, render. Confirmed working on the
runner: four PNGs, both themes, collapsed and expanded, in the pull request
body, fetched back at `200 image/png`.

Whether the embedded WebDriver implemented `/screenshot` at all was a genuine
question rather than an assumption - it is a Tauri plugin, not a browser
driver - so `capture()` logs a failure instead of throwing. A spec whose
subject is "what this looks like" should report that it could not photograph
the thing, not fail as though the thing were broken.

*Testing.* A `PanicHookInfo` cannot be constructed outside a real panic, so
the formatter takes what the hook knows as parameters and the hook does no
formatting of its own - which is what makes both testable. Rotation, the
missing-file case and a report whose header is mangled are unit tests. That a
panic on a *spawned* thread reaches the file is tested by spawning one and
panicking in it, with the previous hook restored afterwards and the assertion
searching the file rather than taking the last report: the hook is
process-wide and the test harness runs tests in parallel.

*Built as.* `crash.rs` holds the hook, the format, and a bounded log of the
last five reports beside the database. The hook **chains** the previous one
rather than replacing it, so a debug build still prints to stderr. Three
commands surface it: `last_crash` (which returns nothing for a crash already
dismissed, so the notice belongs to the crash rather than to the session),
`acknowledge_crash`, and `reveal_crash_log` - the route to the four older
reports, since only the most recent is ever shown.

The notice itself is asked for once on mount, because a crash that has already
happened cannot happen again while the app is up. Two of its three failure
paths are deliberately silent: a crash log that cannot be read, and a
dismissal that cannot be recorded, are both worse as an error banner than as
nothing. The third - "show me the log file" not working - is reported, because
the user asked for something and it did not happen.

*It is a Base UI `AlertDialog`, and it started as a banner.* The banner was
wrong twice over: it sat where the scan and tag notices sit, and those describe
the session that is *running* while this one reports a session that is already
over; and it could be scrolled past, which is the wrong affordance for the only
message the app has about having died. `AlertDialog` rather than `Dialog` is
the part that carries the meaning - a backdrop click cannot dismiss it, so the
choice has to be made rather than clicked away. Escape still closes it and
counts as having seen the crash, which has a test of its own.

Deliberately **not** styled red. A panel of danger colour for something that
has already stopped happening reads as an emergency, and by the time it is on
screen the app is running fine. Only the panic message itself is in
`--danger`.

---

**30 — A seeded library in e2e** `feat/30-e2e-library` — ✅ **done** (PR #45)

Phase 27 left one hole and named it: every spec ran against an **empty**
library, so nothing had ever looked at a row - and the row is where the defects
land. The first of the three that shipped was the playing marker rendered
`--accent` on a row *filled* with `--accent`.

Two things stood between the suite and a populated library, and both are about
a CI runner not being a desktop.

*Getting music in.* "Add Folder…" opens the OS folder picker, which WebDriver
cannot answer. The way in is `add_watch_folder` invoked directly from the test
through `window.__TAURI__` - the one command the suite drives itself. After
that it is the app's own path: click Rescan, which scans and refreshes exactly
as it does for a user. The mp3s are generated in Node at spec time (silent
MPEG-1 frames behind a hand-written ID3v2.3 tag, ~180 lines, no dependency),
the same trade the Rust integration tests already make: no encoder, no binary
blobs in git, no licensing question about the audio. Six tracks over three
artists, chosen so title order and artist order interleave differently - a sort
assertion that held under both would prove nothing - plus a `.jpg` and a `.txt`
the scanner must ignore.

*Playing anything.* A runner has no audio device, so the app falls back to
`NullSink`, where every load fails by design. No row could ever be marked
playing. `SilentSink` accepts every load and advances position on a wall clock,
selected by an environment variable that only a `wdio`-feature build reads.

*Isolation.* One library shared by every spec means the spec that seeds six
tracks breaks the spec that asserts on an empty one - and on a developer's
machine it would be *their* library. `PLAYER_E2E_DATA_DIR`, again read only by
the e2e build, gives each spec file its own; `beforeSession` sets it per spec,
and the seeded spec asserts the empty state *before* it writes anything, so a
silently-ignored override fails as itself rather than as a wrong row count.

*What the rows are now asserted to do:* carry what the scanner read (whole rows
at once, so a shifted column is legible in the failure); count six and ignore
the two non-audio files; sort both ways; extend a selection with shift; mark
the row being played and name it in the status display; and - the point of the
exercise - keep the playing marker at 3:1 both on the selected row and off it,
and every row's text at 4.5:1, in both themes.

*Cost.* One more app launch on a job that already builds the binary, plus a
scan of six ~100 kB files. Nothing added to storage: the fixtures are written
under `e2e/.tmp`, which is gitignored and rebuilt per run.

---

**31 — A hundred and fifty thousand rows in a real engine** `perf/31-virtualization` — ✅ **done** (PR #49)

`PLAN.md` opens with the claim the whole design rests on, and every part of it
was tested except the part a user would notice. `tests/perf.rs` proves the
*queries* stay cheap at ten thousand rows. `SongTable.test.tsx` proves the
virtualizer is *wired up* in jsdom - which has no layout and therefore no
scrolling, so every row is 0px tall and the number rendered is whatever the
mock decided. Nothing had ever scrolled a large library in an engine that lays
it out.

The rows are inserted rather than scanned: a hundred and fifty thousand real
files would be gigabytes and minutes to produce a worse test, and what is under
test is the table rather than ingest, which phase 30 covers with real mp3s. The
seeding command refuses in any build a user could install - `e2e_only` is a bare
`Err` there, because the code that could say yes is behind the `wdio` feature
and is not compiled in - and a unit test asserts that in the same configuration
a user gets.

*Strict where it is exact.* The count reaches the far end, the scroll extent
passes a million pixels, the last row is real rather than a shimmer
placeholder, and the DOM holds under two hundred rows - before a scroll, after
scrolling to the bottom, after a re-sort and after a jump into the middle.

*A ratio where it is performance.* One assertion is about cost rather than
structure, and it compares a cold page at the far end of the ordering against a
cold page at the near end. That is the design's actual promise - cost does not
grow with library size - and a ratio measures the app rather than the runner,
which an absolute budget on a shared CI box cannot. The page cache is emptied
through the UI's own route, a re-sort, because a measurement against a warm
cache measures the cache.

The first version asserted ten- and fifteen-second ceilings and printed
nothing, which was worth very little: a ceiling loose enough to survive a noisy
runner catches only a total collapse, and a run that reports no numbers cannot
tell anyone a page that used to land in 40ms now takes 900. Every timing is now
printed at the end of the spec. The log is where a trend lives.

*What the first runs measured*, debug build, end to end, 150,006 rows: a near
page in 454-482ms, a far page in 528-1095ms, a full re-sort to first painted
row in 262-300ms. So deep paging **is** more expensive - the query is
`LIMIT ? OFFSET ?` and `OFFSET` walks the index to reach the offset, so cost
does grow with depth. It grows by a small constant factor over a cheap
operation rather than by orders of magnitude, and the run-to-run spread is as
wide as the effect. Read one run as one sample: the first pass reported a far
page at 528ms and looked like *no* difference at all, which the second pass
contradicted.

*Cost.* No extra job and no extra build - one more spec file against the app
the e2e job already builds and launches.

---

**Deferred, with the reason** — not phases, and not forgotten:

- **`memo(SongTable)`** - see phase 25. Needs a profile, not an instinct.
- **A Composer column.** Phase 18's plan lists Composer among the fields worth
  suggesting, but `tracks` has no such column. Adding one is a schema migration
  plus a scan change plus a `lofty` read, which is a phase of its own rather
  than an autocompletion detail.
- **CSS Modules.** Considered and declined: it addresses collisions we do not
  have, would weaken the cross-cutting `App.css.test.ts` guards that assert
  absence, and would not have caught any of the three visual defects - jsdom
  applies no stylesheet under CSS Modules either. Phase 27 is the fix for the
  problem that was actually being felt.

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
