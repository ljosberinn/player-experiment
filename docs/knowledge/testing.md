# Testing

Tests land in the same pull request as the work. Coverage threshold is 80%;
current frontend coverage is well above it.

| Layer | Tool | What |
| --- | --- | --- |
| Rust unit | `cargo test` | filter → SQL compilation (incl. injection attempts, depth cap), scan diffing, playlist position math, export shape, palette extraction, panic formatting |
| Rust integration | `cargo test` + `tempfile` | temp SQLite: migrations up, ingest a fixture dir, FTS hits, tag write → re-read, undo restores prior bytes, atomic write survives failure, a 120-file batch reports progress the whole way |
| Audio | `cargo test` | the player state machine against a mock sink trait; decode/output is not asserted |
| last.fm | `cargo test` | signature vectors, response parsing, the rules and the queue against a fake transport; one `wiremock` round trip on 127.0.0.1 for the real one |
| Perf guards | `cargo test` (`tests/perf.rs`) | 10k synthetic rows: a sorted page, a count, stats, browse groupings and the mark-missing write path each inside a fixed budget |
| Frontend unit | Vitest | filter-tree reducer, selection, columns, page cache, formatting |
| Frontend component | Vitest + RTL | table (mocked IPC), tag editor incl. mixed-value bulk fields, transport, menus, dialogs |
| e2e | WebdriverIO, CI only | launch, scan a seeded folder, play, sort, tabs, smart playlists, crash notice, appearance |

Fixture mp3s are generated (silent frames, known tags) rather than committed
audio: no encoder, no binary blobs, no licensing question. Rust generates its
own; the e2e suite writes six tracks over three artists into `e2e/.tmp` at spec
time, chosen so title order and artist order interleave differently.

## What unit tests cannot see, and the guards that cover it

**No test has a window**, so "the app stayed responsive during a long write" is
checked one step short of that: `commands::tests` asserts the `blocking` helper
runs its closure somewhere other than the thread that asked for it, which is the
property a lost `spawn_blocking` would take away. That a readout *moves* rather
than jumping at the end is a property of the numbers, and `tests/tagwrite.rs`
asserts it over a generated 120-file batch.

**Nothing reaches last.fm.** Every layer above `lastfm::transport::Transport`
runs against a fake that answers from a script and records what it was asked -
the same shape as `AudioSink`, and for the same reason. The one exception is
`transport.rs` itself, which gets a `wiremock` server on an ephemeral loopback
port: without it the only code in the product that opens a socket would have no
coverage at all, and the fake would keep passing while the real transport posted
to the wrong URL. **No credentials in CI** - a key is needed to run the feature,
not to test it.

Exercising it against the real service is a local build with a key of your own
from https://www.last.fm/api/account/create, compiled in the way the release job
does it:

```powershell
$env:APEX_LASTFM_API_KEY = "..."; $env:APEX_LASTFM_API_SECRET = "..."
npm run tauri dev
```

The vars are read at *compile* time, so they have to be set before cargo runs,
not before the window opens.

**jsdom applies no stylesheet** — no layout engine, no computed colour. Three
defects shipped past 600 green tests for exactly that reason.

- **`src/App.css.test.ts`** reads the stylesheet as text and asserts *absences*:
  no hover background outside the allowlist, no `cursor: pointer`, no transition
  or animation outside `ANIMATION_ALLOWED` (whose exception must itself stand
  down under `prefers-reduced-motion`), a `:focus-visible` outline, and that
  colour tokens exist for every theme. Rules that are meaningless apart carry a
  paired assertion — a `.statusbar-*` rule setting a column must also set a row.
- **`src/ipc/capabilities.test.ts`** maps each Tauri API the source calls to the
  permission it needs and asserts `capabilities/default.json` lists it. A lookup
  table, not an analysis, so an unknown call still slips through — but it has
  caught four ACL holes, one of them before it shipped. When adding a row,
  **delete the permission and watch the test go red**: two rows once matched
  nothing and passed vacuously.
- **`src/version.test.ts`** asserts `package.json`, `tauri.conf.json` and
  `Cargo.toml` agree, that the release-please manifest matches, and that the
  config still lists every file carrying a version. `Cargo.lock` is deliberately
  excluded — cargo rewrites it on the next build.
- **`e2e/contrast.ts`** asserts computed values in real WebView2 —
  `getComputedStyle`, `getBoundingClientRect`, `elementFromPoint` — rather than
  pixel baselines. Deterministic, no storage, and a failure names the fault
  ("border rgb(26,26,28) on rgb(25,26,28) = 1.02:1"). It catches colours that
  vanish into their background and boxes in the wrong place; it would not catch
  a misaligned column.

## The e2e harness

`@wdio/tauri-service` on its default **embedded** provider: the WebDriver server
runs inside the app behind the `wdio` cargo feature plus a `--config` capability
overlay, so a release build ships neither. External drivers (`tauri-driver`,
`msedgedriver`) never worked here.

- **CI is the source of truth.** Local runs leave `tauri-driver` hung; diagnose
  through Actions logs and artifacts.
- Both halves of the wdio plugin are required — the cargo plugin *and*
  `import '@wdio/tauri-plugin'` in the frontend entry, plus
  `app.withGlobalTauri`. Missing the frontend half costs 5s per WebDriver
  command and warns rather than failing.
- Each spec file gets its own data directory via `PLAYER_E2E_DATA_DIR`, set in
  `beforeSession`; the seeded spec asserts the empty state before writing, so a
  silently-ignored override fails as itself.
- A runner has no audio device, so `SilentSink` (env-selected, `wdio` builds
  only) accepts every load and advances position on a wall clock — `NullSink`
  fails every load by design and no row could ever be marked playing.
- Music gets in through `add_watch_folder` invoked directly from the test — the
  one command the suite drives itself, because WebDriver cannot answer an OS
  folder picker. Everything after is the app's own path.
- **The driver delivers neither `contextmenu` nor `dblclick`** through the
  Actions API, and swallows **Shift+F10** on top of them. Dispatch the event
  React listens for, with the trigger's own coordinates;
  `e2e/specs/smart-playlists.test.ts` has the helper.
- **Screenshots are taken, never compared** (`e2e/screenshot.ts`), pushed to the
  `ci/screenshots` branch and spliced into the PR body by
  `scripts/screenshots.mjs`. Nothing flakes, nothing is committed. `capture()`
  returns `false` rather than throwing — a spec whose subject is "what this
  looks like" should say it could not photograph the thing.
- `e2e/viewport.ts` enters 1920×1080 at 90% around each capture and leaves
  afterwards, measuring `innerWidth × devicePixelRatio` because zoom decouples
  CSS pixels from physical ones. Nothing asserts on it; a runner that refuses to
  resize gets smaller pictures.
- **`setWindowSize` resolves before the webview reports the new size.** Measure
  after one and you read the previous window; the correcting loop then applies a
  shortfall it already applied. `settledSize` waits for the reading to change
  first. See phase 47 — this shipped twice, silently, as screenshots at sizes
  nobody asked for.
- `capture(name, { ownWindow: true })` photographs the window the spec is holding
  instead of the review viewport, for the one spec whose subject *is* the window
  size. `browse-layout` asserts its narrow shot is narrower than its wide one —
  the only assertion any picture carries, and it is arithmetic, not pixels.

## Uncovered on purpose

- The frameless window, custom title bar and drag region — the e2e build pins
  `decorations: true`, or the embedded driver never sees the webview.
- OS-level drag gestures — a file dragged in from Explorer onto the tag editor's
  artwork square, which is the last of them. This gap let a whole feature ship
  broken once: anything depending on one needs a manual check on a real build.
  Dragging *inside* the window stopped being part of it in phase 74:
  `row-drag.test.ts` dispatches a real `PointerEvent` sequence, and the app's own
  listeners run against it.
- "Sound actually came out." Decoding is covered; output is manual.
- Whether the OS delivers a media key to an unfocused window, or Shift+F10 and
  the Menu key to a focused one. The shortcut behind them is covered from a
  dispatched keydown down; the key press itself is not reachable from here.
