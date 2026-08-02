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

Phases 1–9 and 17 are merged to `main`; phase 13 is in review. That completes the
originally-planned nine. Next up is **phase 10 (last.fm scrobbling)**, or any
of the later-added phases 13–18, which are independent of it.

| | Phase | State |
| --- | --- | --- |
| 1 | Scaffold + CI gate | ✅ merged (`75dd29c`) |
| 2 | Library core: schema, scan, queries | ✅ merged (`571b5c7`) |
| 3 | Shell UI: chrome + virtualized table | ✅ merged (`423d029`) |
| 4 | Playback: engine, transport, play counts | ✅ merged (`eb24e87`) |
| 5 | Search: debounce, relevance ranking | ✅ merged (`843cbcf`) |
| 6 | Playlists: CRUD, drag-and-drop, reorder | ✅ merged (`8f10a3d`) |
| 7 | Smart playlists: filter compiler + editor | ✅ merged (`c067f57`) |
| 8 | Tag editing: atomic writer + undo journal | ✅ merged (`571a4c2`) |
| 9 | Export & polish: JSON export, window geometry | ✅ merged (`b26feae`) |
| 17 | Context menus, drop-to-create playlist | ✅ merged (`8caf601`) |
| 13 | Native feel: no web tells, drag badge | 🔄 in review |
| 10+ | last.fm, Sentry, tag sources, 14–16, 18 | not started |

**What works today.** Point the app at a folder, scan it, and browse the result:
sortable virtualized table over a paged SQL query, FTS5 search from the toolbar,
multi-select, cover art over the `cover://` protocol, live scan progress. With
phase 4, double-clicking a row plays the whole view from that point: transport
buttons, a draggable scrubber, volume that survives a restart, automatic queue
advance, and play counts written back to the library. Search debounces, ranks
by relevance, and puts the previous sort back when cleared. With phase 6 the
sidebar grows a Playlists section: create, rename in place, delete, drag a
multi-selection onto one, reorder inside it by dragging rows, and Delete to
take rows back out. Phase 7 adds smart playlists: a nested and/or filter built
in a dialog, compiled to parameterized SQL and re-evaluated live. Phase 8 adds
tag editing: one dialog for one track or five hundred, writing through a
temp-and-rename so a crash cannot corrupt an mp3, with one undo step per edit.
Phase 17 adds right-click menus on songs and playlists - play, get info, add to
a playlist, remove, export, show in Explorer, rename, delete, edit filter - plus
Ctrl+I, and dropping songs on the sidebar's empty space to start a playlist.
Phase 9 adds JSON export of the library, a selection or a playlist against a
[documented schema](docs/export-schema.md), and a window that reopens where it
was left.

**Test counts.** 215 Rust (171 unit, 38 integration against generated mp3s,
6 perf guards) and 447 frontend at 97.4% lines. CI runs
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
- **`main` is not protected server-side** — GitHub gates that behind Pro for
  private repos. The pre-push hook is advisory only.
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

**5 — Search** `feat/05-search` — 🔄 **in review**
FTS5 triggers, debounced search box scoped to the current view, ranked results.

*As built.* The FTS5 table and its triggers landed with phase 2; this phase is
the query and the UI on top. `db::query::order_by` adds a `Relevance` sort over
weighted `bm25`, applied only when a search is actually running. The store
separates `searchInput` (every keystroke) from `search` (debounced 200 ms, or
immediate on Enter), and a per-query token makes stale counts and stale pages
unwritable. Escape and a clear button empty the box; a search with no hits gets
its own empty state rather than the "add a folder" one.

**6 — Playlists** `feat/06-playlists` — 🔄 **in review**
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

**7 — Smart playlists** `feat/07-smart` — 🔄 **in review**
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

**8 — Tag editing** `feat/08-tags` — 🔄 **in review**
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

**9 — Export & polish** `feat/09-export` — 🔄 **in review**
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

**13 — Native feel pass** `feat/13-native-feel` — 🔄 **in review**

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

**14 — Library totals in the footer** `feat/14-totals`
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

**16 — Row status column** `feat/16-status`
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

**17 — Context menus, and dropping onto nothing** `feat/17-context-menus` — 🔄 **in review**

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

**18 — Tag autocompletion** `feat/18-tag-complete`
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
