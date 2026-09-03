# Testing

Tests land in the same pull request as the work. Coverage threshold is 80%;
current frontend coverage is well above it.

| Layer | Tool | What |
| --- | --- | --- |
| Rust unit | `cargo test` | filter → SQL compilation (incl. injection attempts, depth cap), scan diffing, playlist position math, export shape, palette extraction, panic formatting, log line format and rotation |
| Rust integration | `cargo test` + `tempfile` | temp SQLite: migrations up, ingest a fixture dir, FTS hits, tag write → re-read, a fresh database with no undo journal, atomic write survives failure, a 120-file batch reports progress the whole way |
| Audio | `cargo test` | the player state machine against a mock sink trait; decode/output is not asserted |
| last.fm | `cargo test` | signature vectors, response parsing, the rules and the queue against a fake transport; one `wiremock` round trip on 127.0.0.1 for the real one |
| Release lookup | `cargo test` | the whole unattended pass against recorded fixtures: the threshold from both sides, a release with no candidates left untouched and unqueued, genre filled and *not* overwritten, comment untouched, a second sweep a no-op, a cancelled sweep resuming where it stopped |
| Perf guards | `cargo test` (`tests/perf.rs`) | 10k synthetic rows: a sorted page, a count, stats, browse groupings and the mark-missing write path each inside a fixed budget |
| Frontend unit | Vitest | filter-tree reducer, selection, columns, page cache, formatting |
| Frontend component | Vitest + RTL | table (mocked IPC), tag editor incl. mixed-value bulk fields, transport, menus, dialogs |
| e2e | WebdriverIO, CI only | launch, scan a seeded folder, play, sort, tabs, smart playlists, the log file on disk, crash notice, appearance |

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

**Nothing reaches MusicBrainz either**, for the same reason and through the same
kind of seam. Two things follow from the limiter being process-wide and real:
every test that searches or fetches spends a real second in it, so the lookup
tests keep to two or three releases apiece rather than proving the same rule
over a bigger library; and the one test that does open a socket is
`#[ignore]`d, because a fixture is a recording of a response shape and the shape
is theirs to change — `cargo test -p apex -- --ignored` is how that is noticed.

Exercising it against the real service is a local build with a key of your own
from https://www.last.fm/api/account/create, compiled in the way the release job
does it:

```powershell
$env:APEX_LASTFM_API_KEY = "..."; $env:APEX_LASTFM_API_SECRET = "..."
npm run tauri dev
```

The vars are read at *compile* time, so they have to be set before cargo runs,
not before the window opens.

**Nothing reaches MusicBrainz either.** Same arrangement, one seam along:
`tagsource::transport::Transport` has a fake that answers by URL - by URL, not
in order, because a release and its cover are fetched from two threads at once
and a script in order would be asserting a race - plus a `wiremock` round trip
for the real client. The recorded responses in `src-tauri/src/tagsource/fixtures/`
cover a plain album, a multi-disc release and a various-artists compilation,
which are the three shapes the parser branches on.

The response *shape* is theirs to change, and a fixture cannot notice that.
`musicbrainz::tests::a_live_lookup_finds_a_release_and_its_tracklist` is
`#[ignore]`d and talks to the real service; `cargo test -- --ignored` from
`src-tauri/` is how it gets run. It needs no credentials - MusicBrainz has no
auth - only a network, which is why it is not in CI.

**The lookup dialog has no e2e spec**, and deliberately. Driving it means a
real request to musicbrainz.org from the running app, which would make every CI
run depend on somebody else's service being up and under its rate limit.
`ReleaseLookup.test.tsx` covers the markup and the flow against mocked IPC; the
dialog against the live service is a manual check before a release.

The rate limiter is asserted at its real one request a second, from **two**
callers at once: the limit is enforced at the IP address, so a limiter that
serialized only within one client would be no limiter at all. That test costs a
second of wall clock, deliberately - a scaled-down imitation would not be
asserting the rule that ships.

**No unit test can see where a file actually lands.** `log::tests` proves the
line format and the rotation against a `tempfile`, and says nothing about
whether the running app opens `main.log` beside the library rather than in the
developer's own app-data directory. `e2e/specs/logfile.test.ts` reads the file
with `node:fs` after asking for a rescan through the File menu — deliberately
not through a command, since one that answered with its own idea of the
contents would prove nothing.

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
