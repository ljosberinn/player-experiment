# Testing

Tests land in the same pull request as the work. Coverage threshold is 80%;
current frontend coverage is well above it.

| Layer | Tool | What |
| --- | --- | --- |
| Rust unit | `cargo test` | filter → SQL compilation (incl. injection attempts, depth cap), scan diffing, playlist position math, export shape, palette extraction, panic formatting, log line format and rotation |
| Rust integration | `cargo test` + `tempfile` | temp SQLite: migrations up, ingest a fixture dir, FTS hits, tag write → re-read, a fresh database with no undo journal, atomic write survives failure, a 120-file batch reports progress the whole way |
| Audio | `cargo test` | the player state machine against a mock sink trait; decode/output is not asserted |
| last.fm | `cargo test` | signature vectors, response parsing, the rules and the queue against a fake transport; one `wiremock` round trip on 127.0.0.1 for the real one |
| Release lookup | `cargo test` | the whole unattended pass against recorded fixtures: the threshold from both sides and from both scores — a lone candidate of the right length written though its durations disagree, one the text barely matches queued, one of a different length queued, a release with no candidates left untouched and unqueued, genre filled and *not* overwritten, comment untouched, a second sweep a no-op, a cancelled sweep resuming where it stopped, a transient failure retried and a permanent one not, a dry run reaching its second batch, leaving no row behind, and carrying its place across a sweep that ended early; a 503 deferring its release instead of ending the sweep, a run of declines leaving the step on however long it runs against a run of unanswered lookups parking it with the release after it never asked, a 502 counted as the outage a 503 is not, and the drain refusing to place a release whose lookup never reached it; the drain itself asserted by the order of the log lines — a playing release retried before the next batch rather than after the last one, one played all sweep retried at every drain and counted and logged once, and a release that declines twice left to the next sweep |
| Library folder | `cargo test` + `tempfile` | the layout as a table with no filesystem; the mover over a temp tree: ids, play counts and playlist places kept across a move, a rename that fails partway rolled back, a collision suffixed and an orphan overwritten, the cross-volume fallback driven by an injected `ERROR_NOT_SAME_DEVICE`, a shared source folder keeping its cover, and a tombstoned target still holding its row after a following scan |
| Perf guards | `cargo test` (`tests/perf.rs`) | 10k synthetic rows: a sorted page, a count, stats, browse groupings and the mark-missing write path each inside a fixed budget |
| Frontend unit | Vitest | filter-tree reducer, selection, columns, page cache, formatting |
| Chart primitives | Vitest + RTL | geometry, never pixels: the plot rect a measured frame hands down, tick offsets, the clamp that keeps a tooltip inside the plot; empty and single-datum inputs for every scale, which is where domains collapse |
| Frontend component | Vitest + RTL | table (mocked IPC), tag editor incl. mixed-value bulk fields, transport, menus, dialogs |
| e2e | WebdriverIO, CI only | launch, scan a seeded folder, play, sort, tabs, smart playlists, the log file on disk, crash notice, appearance, every window-bound key and the search box standing it down, the queue moving under Next, Previous, a track ending and the scrubber |

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
dialog against the live service is a manual check before a release. The review
queue's sidebar row is the same case for the same reason - only the unattended
pass writes the rows it counts - so `ReviewQueue.test.tsx` covers it and no
spec seeds them.

**The progress readout is photographed against a sent payload.** Its only
producer is that same pass, which needs the network and runs for the better part
of two days, so `e2e/specs/task-progress.test.ts` emits `task://progress` from
the webview: Tauri routes it through the backend and back to the listener, so
the component hears it exactly as it hears the real thing. What that leaves to
`invoke.ts`'s `emit` rather than to the app is nothing - no test-only path ships
- and the arithmetic behind the numbers is asserted on `Pace` in
`library::worker`.

The rate limiter is asserted at its real second and a half, from **two**
callers at once, and again for a slow request not shortening the gap after it:
the limit is enforced at the IP address, so a limiter that serialized only
within one client, or only the gaps between request *starts*, would be no
limiter at all. That test pays the shipping interval in wall clock rather than
a scaled-down imitation of it, which would not be asserting the rule that
ships.

**The gate every other test passes through is scaled down**, to ten
milliseconds, under `cfg(test)`. Otherwise every assertion that incidentally
makes a request would pay the interval and the suite would take minutes to say
nothing about the limiter. What is scaled is the ambient gate; the rule is
still asserted against a limiter built with the shipping interval.

A sweep is asserted to announce once per release it writes rather than once per
sweep - the bug that had a real pass rewriting the library with the window
showing none of it - and a dry run to announce nothing at all.

A retry that *works* is asserted against a transport that refuses once and then
answers - the one case `FakeTransport` cannot express, since it gives the same
answer every time, and the one where the count is the only evidence anything
went wrong.

The sweep cadence is asserted as a function rather than through the thread:
that a sweep which got through releases comes straight back however long the
gap had grown to, and that one which got through nothing doubles to the
ceiling and stops there.

**No unit test can see where a file actually lands.** `log::tests` proves the
line format and the rotation against a `tempfile`, and says nothing about
whether the running app opens `main.log` beside the library rather than in the
developer's own app-data directory. `e2e/specs/logfile.test.ts` reads the file
with `node:fs` after asking for a rescan through the File menu — deliberately
not through a command, since one that answered with its own idea of the
contents would prove nothing.

**jsdom applies no stylesheet** — no layout engine, no computed colour. Three
defects shipped past 600 green tests for exactly that reason.

**A drawn control is driven differently from the element it replaced.**
`src/test/select.ts` holds the four readers every spec that touched a
`<select>` now needs: `showing` in place of `.value`, `choose` in place of
`selectOptions`, and `offered`/`offers` for the `<option>`s that used to sit in
the document whether the select was open or not. One file rather than one copy
per spec, because a select that changes how it opens again should be one edit.
Two traps in there: Base UI leaves a closed popup in the document for an exit
animation jsdom never finishes, so wait on the *role* disappearing and not on
the node; and a disabled option is a `<div role="option">` with `aria-disabled`,
which `toBeDisabled` does not read.

- **`src/App.css.test.ts`** reads the stylesheet as text and asserts *absences*:
  no hover background outside the allowlist, no `cursor: pointer`, no transition
  or animation outside `ANIMATION_ALLOWED` (whose exception must itself stand
  down under `prefers-reduced-motion`), a `:focus-visible` outline, and no
  literal colour outside `styles/tokens.css`. It reads all four sheets as a
  set, not `App.css` — an absence guard is worth the fraction of the sheet it
  can see, and the entry point is four `@import`s. A sheet added to `styles/`
  and forgotten in `SHEETS` leaves every absence guard at once, which is why
  the component library is one file rather than one per component. Since phase 108 it also
  iterates both grounds: every contrast pair is asserted twice, and the two
  token blocks must declare identical name sets. Rules that are meaningless
  apart carry a paired assertion — a `.statusbar-*` rule setting a column must
  also set a row.
  - **It composites, and that is the point.** Comparing one token to another
    misses every surface that is not a token, and the chrome is a veil: what
    sits behind the transport's rails is `--strip-veil` over `--surface`. Three
    phase-108 defects passed the token pairs and failed in the engine. The
    flattening arithmetic is deliberately the same as `e2e/contrast.ts`, because
    the two disagreeing about what 4.5:1 means is the one failure a contrast
    assertion cannot report on itself.
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

## Storybook is not a third suite

`*.stories.tsx` under `src/`, config in `.storybook/`, `npm run storybook` to
read them. It asserts nothing and runs no assertions: **`@storybook/addon-vitest`
does not fit**, because it peers `vitest ^3 || ^4` against this repo's `^5`.
Component behaviour stays in `*.test.tsx` and appearance stays in the wdio suite.

What it is for is the one thing neither of those shows — a primitive drawn in
every state, on both grounds, at once. Vitest runs in jsdom with no stylesheet;
the wdio specs photograph whole screens of the running app.

Hover and press are the exception: a story shows them live rather than beside
the rest state. Drawing them would need a story-only class in `library.css`,
and story scaffolding does not belong in the sheet — a specimen that stopped
matching the rule it documents is worse than one you have to point at.

It is in CI all the same, as `npm run build-storybook` on the `frontend` job.
Nothing is published from it. It is the only thing that *compiles* a story, and
React Compiler runs over stories at `panicThreshold: "all_errors"` like any other
`.tsx`, so a story that breaks the rules of React fails on the branch that wrote
it rather than sitting broken until someone opens it.

`.storybook/preview.ts` gives every story the app's stylesheet and font faces;
see [106](../issues/done/106-storybook.md) for why `vite.config.ts` needs no
`viteFinal` and what `preview.css` has to take back from Storybook's own styles.

### Stories of components that talk to Tauri

The preview `beforeEach` stands in for the runtime, from `.storybook/`, which
Vitest never runs and coverage never counts:

- **`parameters.ipc`** answers `invoke`: a map keyed on the command string
  (`"last_crash"`, `"plugin:dialog|open"`), not the `src/ipc` function name.
  Storybook merges it with defaults in `preview.ts`, so a story names only
  what it adds. An unanswered command rejects with `no story handler for
  <cmd>` and warns the same, so a missing entry shows as the component's error
  path rather than a spinner. Area maps live in `.storybook/handlers.ts`. A
  command the backend answers with an event rather than a return value, like
  `player_toggle`, writes that event's state to the store from its handler, so
  the control still answers a click.
- **Covers** resolve to inline SVGs from `.storybook/fixtures.ts`, keyed on
  `cover_hash`; `stagedCoverUrl` gets one that matches none of them.
- **Stores** are reset to their initial state before every story, from the
  list in `.storybook/stores.ts` — a new store goes there. A story seeds state
  in its own `beforeEach` with `useXStore.setState`.
- **Fixtures** — `track()`, `playlist()`, `LIBRARY` and friends — are in
  `.storybook/fixtures.ts`. The per-file `track()` helpers in tests stay put.
  So are the menu models `rowItems()` and `MENUS`, built by the app's own
  `rowMenuItems` and `menus()` so a menu story cannot drift from the app's.
- **The library** answers its queries over `LIBRARY`, from
  `.storybook/library.ts` through `libraryHandlers`. A library story reaches
  its view the way the app does — `refresh`, `showTab`, `showPlaylist`,
  `showTrackGroup` — rather than seeding the counts, pages and groups those
  fetch. The drill-in order has to match `RELEASE_GROUP_ORDER`, because
  `ReleaseGroups` cuts rows into releases by a prefix sum.
- **Statistics** aggregates count over the same rows, from
  `.storybook/stats.ts` through `statsHandlers`, so a panel agrees with its
  neighbours and with the library. `emptyStatsHandlers` answers every
  aggregate over nothing. A genre is a branch of `GENRE_PARENTS`.
- **Fields** are styled only by `.dialog input`, so a story of a field
  component draws it inside a `Dialog`, laid out as its host lays it out.
- **Context menus** open from `play` with `rightClick` in `.storybook/play.ts`.
- **Events** go out from `play` through `emitEvent` in `.storybook/tauri.ts`,
  not `emit`: Storybook starts `play` before the story's effects run, so a
  bare `emit` reaches no listener. `emitEvent` waits for one and fails the
  story if none subscribes.

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
- **`SilentSink` never reports a track finished**, and that is deliberate: one
  loaded track that ran out would advance the queue underneath whatever spec
  was asserting on it. The cost is that the two things a user only ever sees at
  a track's end — the queue moving on unasked, and repeat-one starting the same
  song again — have no route a driver can take. `e2e_end_track` is that route,
  behind `e2e_only`; the engine handles it with the same code the timer
  reaches, so only the sink's own end detection is left to the Rust tests.
- **Two seeds are inserted rather than produced**, behind `e2e_only`:
  `seed_synthetic_tracks` for a library size no fixture folder can reach, and
  `seed_synthetic_plays` for a listening history the suite would otherwise have
  one play of. The plays seed resolves afterwards, because the seeder leaves
  `track_id` null and an unresolved log reads as nothing owned. It runs after
  `virtualization`, so two thirds of the plays match a synthetic track.
- **A synthetic row's values repeat on coprime-ish cycles, and that includes
  the ones nothing reads yet.** Bitrate, sample rate and `added_at` were left
  NULL and zero until the Library panels drew them, which quietly made four of
  the perf budgets a one-group scan over a column of NULLs — a budget met by
  the query never running. The rule: a column a `tests/perf.rs` budget touches
  has to have a distribution in it. Synthetic plays likewise have a weekly
  shape - empty small hours, busy evenings, heavier weekends - because evenly
  spaced they filled every hour of the week alike and the week clock
  photographed as a flat field.
- **`tr.song-row.playing` marks the *current* track, not a running one.**
  `Engine::stop` keeps its queue index — that is where Toggle resumes from — so
  the snapshot still names the track and the row still wears the marker after a
  `player_stop`. A spec that waits for the marker to appear after starting the
  same row twice, or for it to go away after stopping, waits on something that
  never changed. Wait on `player_snapshot`'s `status` instead.
- **The driver delivers neither `contextmenu` nor `dblclick`** through the
  Actions API, and swallows **Shift+F10** on top of them. Dispatch the event
  React listens for, with the trigger's own coordinates;
  `e2e/specs/smart-playlists.test.ts` has the helper.
- **A pressed space is a keydown and nothing else.** `browser.keys([" "])` maps
  to the WebDriver Space key, `` — there is no way to send the literal
  character — and the driver delivers it as a keydown carrying no text: a
  listener sees `key` as `" "` on the focused element, uncancelled, and a
  focused text field types nothing. Every other key this suite presses into a
  field lands, so it reads as a product bug and is not one. Assert what the app
  did with the event, not the character; `shortcuts.test.ts` reads
  `defaultPrevented` from a listener bound last.
- **A click returns when the driver has dispatched it, not when the caret has
  moved.** A key sent straight after a click on a text field can still reach
  the window, which is the failure mode every "typing stands the shortcut down"
  test is built to catch. Wait for `document.activeElement`.
- **`elementClick` aims at the bounding-box centre, which a ring segment does
  not occupy.** Clicking a donut slice dispatches into the hole: the driver
  reports success, no `click` reaches the path, and the assertion after it
  fails with nothing in the log to say why — there is no "click intercepted"
  for a point that is merely outside the shape. Any concave mark has the same
  problem. Drive the real control instead, which for a chart is the button in
  its `Show as table` view — the same one `role="img"` already makes the only
  route for anything but a pointer.
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

- The OS half of a file drop — Explorer's drag loop, `wry`'s drop target, and
  the position it reports. Everything from the Tauri event on is covered:
  `tag-editor.test.ts` and `library-drop.test.ts` emit `tauri://drag-enter` and
  `tauri://drag-drop` with a real file on disk, and the app's own routing,
  ingest, staging and preview run against it. What `library-drop.test.ts` drops
  is only ever refused: one app process serves the whole run, and the specs
  after it count what a scan found. The folder and in-place cases are
  `library::ingest`'s own tests, over a library of their own.
  Dragging *inside* the window stopped being part of this gap in phase 74:
  `row-drag.test.ts` dispatches a real `PointerEvent` sequence, and the app's own
  listeners run against it.
- "Sound actually came out." Decoding is covered; output is manual.
- Whether the OS delivers a media key to an unfocused window, or Shift+F10 and
  the Menu key to a focused one. The shortcut behind them is covered from a
  dispatched keydown down; the key press itself is not reachable from here.
- Whether the OS delivers a *modifier chord* — Alt+←/→, Ctrl+A, Ctrl+I,
  Ctrl+plus/minus/0 — or claims it first. `shortcuts.test.ts` presses the bare
  keys for real and dispatches the chords, which still proves the two halves
  worth proving: the listener is on `window`, and `isTypingTarget` decides
  correctly from the event's target. The physical chord is the same gap as the
  media keys above.
- Whether a space pressed in the search box puts a space *in* it. The driver
  cannot type one at all (above), so the e2e half asserts that the app left the
  keydown alone and did not toggle the player. The character is
  `usePlayerShortcuts.test.tsx`'s, in jsdom.
