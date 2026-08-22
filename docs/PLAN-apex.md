# Apex — moving the player onto the new design

## What this is

A design exists for what this app should look like: a Claude Design project called
"Modern music player design", whose single component is `Apex Music Player.dc.html`.
It is a working mockup — sidebar navigation, a transport strip, a right-click menu on
a song, a smart-playlist rule builder, a settings dialog, and a mockup of our own
crash dialog — rendered at 1440×900 with every colour expressed in `oklch`.

This document is the route from what is on `main` today to that design. It is a
large sweep: the segmented tab bar is deleted, the transport moves out of the title
bar, the library toolbar goes away, the product is renamed, and a colour ramp
replaces the current one. Eleven phases, one branch and one pull request each,
broadly in the order given — the design phases assume the earlier design phases
landed. Two of them are not design and are free to run whenever they are wanted:
**41**, which already has, alongside 34; and **42**, the dependencies.

Phases 32–39 have landed. Where one of them was built differently from what is
written below, the section says so rather than being quietly rewritten — the
reasoning that turned out to be wrong is the useful part.

Phases 1–31 are in `PLAN.md`; this continues its numbering at 32. The last.fm work
in `docs/PLAN-lastfm.md` is unaffected and can land before, after or between these.

## What the design is not

It is a mockup, not a specification, and three of its properties do not survive
contact with a real library:

- **Its table is a CSS grid with fixed column tracks.** Ours is virtualized over
  150k rows with resizable, reorderable, hideable columns and sort indicators
  (phases 3, 27, 31). The design's *look* transfers; its markup does not.
- **It has 22 songs, all in memory.** Every count it shows is `array.length`. Ours
  come from `COUNT(*)` against SQLite, which is what makes the sidebar counts in
  phase 36 a question of when to recompute rather than a property read.
- **It has no missing files, no scan in progress, and nothing to undo.** The states
  that only exist in a real library — the missing marker, scan progress, the tag
  undo journal — have no mockup, so their placement below is a decision made here.

Where the two disagree on a detail the design has not thought about, the built app
wins; where they disagree on how something looks, the design wins.

## Decisions already taken

These were settled before the plan was written and are not revisited below.

| Question | Answer |
|---|---|
| How far does the rename go? | All the way. Orphaning the local database does not matter at v0. |
| Does the segmented tab bar survive? | No. Views move into the sidebar. |
| Does the library toolbar survive? | No. Undo moves to Edit, Export becomes a top-level menu. |
| Smart playlists with sort + limit? | Yes — it is what makes "Most Played" expressible. |
| Counts on smart playlists? | Yes, recomputed on `library://changed`, debounced. |
| Where are cover colours extracted? | In Rust, cached in the database. |
| Light theme? | Dark only for now, but every colour stays behind a token. |
| Discogs links? | Search URLs are fine — Discogs has no name-addressable artist page. |
| Repeat? | One button, one song, on or off. No repeat-all, no shuffle, ever. |
| Does a repeat count as a play? | Yes. Every loop bumps `play_count` and will scrobble. |

Standing constraints from `PLAN.md` still apply: `main` is off limits, one feature
branch per phase, CI is the gate, e2e runs on GitHub Actions rather than locally.

---

## Phase 32 — The rename

`productName` is `"Player"` and the identifier is `dev.ljosberinn.player`. Both
change: **Apex**, `dev.ljosberinn.apex`.

Changing the identifier moves the app-data directory, which orphans the existing
database, settings, window geometry and crash log. At v0 that is acceptable and it
is the reason this phase goes first — the cost only grows.

- `src-tauri/tauri.conf.json`: `productName`, `identifier`, the window `title`.
- `package.json` name, `README.md`, the `<title>` in `index.html`.
- `release-please-config.json`: `package-name` `player` → `apex`. This affects the
  changelog heading only; `include-component-in-tag` is already false, so tags do
  not change shape and version history is continuous.
- The e2e suite asserts the window title in `smoke.test.ts`; the assertion moves
  with it.
The version string the design shows in the title bar is **not** moved here. It
already exists in the status bar, read from the Rust crate through `get_app_info`,
and the title bar is rebuilt from scratch in phase 34 — moving it now means CSS
that phase 34 throws away and four tests edited twice. It moves in 34, where the
bar it lands on is being written anyway.

**Not renamed:** the GitHub repository stays `ljosberinn/player-experiment`.
Renaming it would break the remote, the `ci/screenshots` branch that PR bodies point
at by raw URL, and every link in a merged pull request. It can be renamed later
independently of anything here.

**Ordering against #41.** The open release PR will regenerate itself once this
merges, which is expected and harmless. Nothing in this phase touches it directly.

---

## Phase 33 — The colour ramp, dark only

The design's palette is one hue — 55, a warm orange-brown — expressed in `oklch`,
with a single accent at `oklch(0.72 0.16 55)`.

`App.css` currently ships three colour blocks: a light `:root`, a
`prefers-color-scheme: dark` override, and an explicit `:root[data-theme="dark"]`.
Two of them go. What stays is the *indirection*: every colour in every component
rule continues to come from a custom property, and no literal colour is written
outside the token block. That is what "keep the doors open for light" means in
practice — restoring a light theme later is one more block of variable definitions,
not an audit of six hundred CSS rules.

The token set, from the design:

| Token | Value | Used for |
|---|---|---|
| `--accent` | `oklch(0.72 0.16 55)` | play button, selection tint, active nav, focus |
| `--surface-0` | `oklch(0.09 0.004 55)` | the page behind the window |
| `--surface-1` | `oklch(0.14 0.008 55)` | sidebar |
| `--surface-2` | `oklch(0.15 0.008 55)` | transport strip, dialogs |
| `--surface-3` | `oklch(0.17 0.008 55)` | content |
| `--text` | `oklch(0.94 0.005 55)` | body |
| `--text-dim` | `oklch(0.72 0.01 55)` | secondary columns, section headings |
| `--hairline` | `oklch(1 0 0 / 0.06)` | every border in the design |

Chrome is translucent: `backdrop-filter: blur(18px)` over a surface at 55–70%
opacity, which is what makes the animated background of phase 39 visible through
the sidebar and transport rather than only behind the table.

**Contrast.** The design was amended specifically to satisfy our existing
`e2e/contrast.ts` spec: what was `oklch(0.48)` on the genre column and the table
headers is now `0.72`, and the `dim` constant went `0.62` → `0.72`. At `oklch(0.72)`
on `oklch(0.17)` that is roughly 6.7:1 against a 4.5:1 requirement. One value is
still short — the version string at `oklch(0.55)` on the `0.125` title bar, about
4.3:1 — and it gets lifted to `0.64` here. The e2e spec keeps its thresholds; the
palette meets them.

**Space Grotesk** is the design's numeral face: durations, the playhead, the
backtrace block. The mockup loads it from Google Fonts, which this app cannot do —
it is offline-first and the CSP forbids the request. The woff2 files are vendored
into `src/assets/fonts/`, declared with `@font-face`, and the SIL Open Font License
is added to `THIRD-PARTY-NOTICES.md`. Only the weights actually used (400 and 700)
are shipped.

The card grids for Albums, Artists and Genres are restyled here too — `BrowseView`
already renders tiles with cover art, so this is the token pass reaching it, not new
structure.

---

## Phase 34 — The menu bar

A 36px title bar: the Apex mark, the menus, the version, the window buttons.
Base UI ships `menubar` and `menu`, so this is those parts rather than hand-rolled
popovers — it brings roving focus, typeahead, Escape and submenu timing for free.

**File**
- Add Folder…
- Rescan (F5)
- Remove *n* Missing Songs… — only enabled when `stats.missing > 0`. The mockup has
  nowhere for this because a mockup has no missing files; the File menu is where it
  belongs, next to the scan that discovers them.

**Edit**
- The song row's own menu, acting on the current selection, so there is exactly one
  definition of what can be done to songs. `rowMenuItems()` is already pure and
  already returns a `MenuItem[]`; it is called from both places and the labels
  ("Edit 3 Songs", "Export 3 Songs…") come out right for free. Disabled wholesale
  when nothing is selected.
- Undo Tag Edit — disabled unless the journal has something, as the toolbar button
  is today.
- Settings… — the interface zoom dialog from the design. The status bar zoom control
  stays; this is a second route to it, not a replacement.

**Export** — its own top-level menu, offering *Export All* and *Export Selection*.
When a playlist is open and no song within it is selected, Export Selection exports
the playlist instead and says so in its label. With nothing selected and no playlist
open, it is disabled. The existing `exportChoice()` already computes exactly this;
it moves from the toolbar button into the menu.

**Account** — present, empty, disabled. It is where last.fm lands
(`docs/PLAN-lastfm.md`); shipping the empty menu now means the shell does not change
shape when that arrives.

**Help** — a link to the repository. Opening a URL needs `tauri-plugin-opener`,
which is not currently a dependency: add it, plus `opener:allow-open-url` scoped to
`https://github.com/ljosberinn/*` in `capabilities/default.json`. A local-only app
should be able to open exactly the links it means to and no others.

**F5** joins the existing shortcut layer (`features/player/shortcuts.ts` and
friends) rather than a bare listener, so it is testable and cannot fire while a
text field has focus.

The library toolbar and `TabBar` are deleted in this phase, with their tests.

---

## Phase 35 — The transport strip and sidebar navigation

The 78px strip below the title bar, left to right: the prev/play/next pill, the
playhead with elapsed and total, cover art and track text, the volume slider, the
search box.

This is where the current arrangement — everything crammed into the title bar,
which `TitleBar` exists to make draggable — comes apart. The title bar keeps the
drag and double-click-to-maximize behaviour and loses its passengers.

The sidebar gains the LIBRARY section: Songs, Albums, Artists, Genres, and the
dimmed **Statistics** placeholder the design shows, which does nothing and says so
until a later phase gives it something to do. `useLibraryStore.showTab` already
drives these four views; only the control changes.

The playing row keeps our first-column status cell — the marker that says a file is
missing or that this row is what you are hearing. The design's accent left border
was removed in the same amendment that fixed the contrast, so there is no second
indicator to reconcile: the status column is the only one.

Sort indicators stay in the column headers exactly as they are.

**The Songs view has no title header.** Albums, Artists and Genres keep the large
heading and its accent underline; Songs drops both and tightens the content pane's
top padding to 10px. The view with 150k rows in it is the one that can least afford
to spend a third of the fold on the word "Songs".

What that heading carried — "22 songs, 2 hr 6 min" — moves to a 27px translucent
strip along the bottom of the window, centered. We already have that strip: the
status bar built in phase 9 puts the library summary in exactly that position, with
zoom to its left and the version to its right. The design and the app converged
here independently, so this is a restyle of `footer.statusbar`, not a new element,
and the summary becomes view-scoped rather than library-wide.

---

## Phase 36 — The sidebar sections

**Collapsible.** SMART PLAYLISTS and PLAYLISTS each collapse to their heading.
The open/closed state persists in the `settings` table, keyed per section, so a
sidebar arranged once stays arranged. LIBRARY does not collapse — four items that
are the primary navigation.

**Counts.** Every playlist shows how many songs are in it. Static playlists already
do. Smart ones already report a `track_count` too — `db::playlists::list` runs
`count_tracks` with the compiled filter for each — so the work here is not computing
it but *recomputing* it: on `library://changed`, debounced (250ms), because a scan
emits that event far more often than a human can read a number. One reload of the
playlist list, not one query per playlist per event.

**The built-ins moved to phase 37.** They were planned here and could not land
here: both are expressed as a sort plus a cutoff, and neither existed until the
next phase built them. Deferring them was the right way round — the alternative
was special-casing two playlists for one phase and then unpicking it. They are
described where they were built.

---

## Phase 37 — Smart playlists get sort and limit

Today a smart playlist is a filter tree compiled to a parameterized `WHERE` clause.
"Most played" is not a filter — it is an ordering and a cutoff — so the model grows
two optional pieces:

```ts
type SmartQuery = {
  filter: Group;
  sort?: { field: SortField; direction: SortDirection };
  limit?: number;
}
```

`smart/compile.rs` emits `ORDER BY` and `LIMIT` alongside the existing clause. The
sort field goes through the same whitelist enum the filter fields do — it is
concatenated into SQL, so it can never be user text. The limit is a bound integer.
The `playlists.sort_json` column has existed unused since migration 1 and is where
this is stored; no schema change is needed.

**A limit decides membership, not display order.** "Most Played, limited to 100"
means the playlist *contains* a hundred songs — so the limit has to be part of what
`scope()` builds, as `tracks.id IN (SELECT id … ORDER BY … LIMIT ?)`, rather than a
`LIMIT` appended to the page query. Anything else falls apart the moment a second
condition lands on the same view: sorting the open playlist by title would silently
change which hundred songs it holds, and searching inside it would search the whole
library. The sort is *also* the playlist's default display order when it is opened,
which is a separate use of the same stored value.

This supersedes the `min(count, limit)` note this phase was planned with. That was
written assuming the limit rode on the page query, and it is wrong for the same
reason: with a search running, the true count is "how many of the limited hundred
match", which `min` cannot compute from the unlimited total. Putting the limit in
the scope makes `count_tracks`, `library_stats` and `all_track_ids` correct with no
call-site arithmetic at all — they already share `scope()`.

**The built-ins**, deferred from phase 36 because they are built out of exactly the
two pieces above:

- **Recently Added** — sorted by `added_at` descending, limited to 100.
- **Most Played** — `plays > 0`, sorted by `play_count` descending, limited to 100.

Both are ordinary smart playlists seeded on first run: editable, renameable,
deletable, and special-cased nowhere. `plays > 0` is not redundant beside the
cutoff — without it, a library with nothing played yet would show a hundred
arbitrary songs under that heading. The guard is a `playlists.seeded` settings flag
rather than a check for the playlists themselves, so deleting Most Played deletes
it instead of getting it back at the next launch. Seeding runs from `lib.rs`'s
`setup` rather than `Db::open`: which playlists a new library starts with is a
product decision, not one the storage layer should hold. **Top Rated is not among
them** — there is no rating field in the schema and inventing one to satisfy a
mockup label would be the tail wagging the dog.

The rule builder in `SmartPlaylistEditor` gains a footer. Planned as one sentence —
*sorted by … descending, limited to … songs* — it was built as two rows, each with
a checkbox: "sorted by nothing" and "limited to no songs" both have to be
expressible, and a select whose first option is blank says that far less clearly
than a box you tick. Ticking the cutoff supplies a sort if there is none and then
holds it, because a limit with no sort is a hundred arbitrary songs; unticking it
leaves the sort alone, which is still useful on its own.

**Exports carry the order** alongside the filter, or a Most Played would export as
`plays > 0` and read back as every song ever played. The key is omitted when there
is no order, so every export written before this stays valid at the same
`schemaVersion`. `docs/export-schema.md` documents the shape.

`relevance` and `position` are **refused** as a smart sort rather than falling back
the way `db::query` does. A silent fallback is right for a display order the user
can see and change; here the sort decides which songs are in the playlist, and
handing back a different hundred than the one asked for is not a detail.

Bindings are regenerated (`npm run bindings`); CI fails if they are stale.

---

## Phase 38 — Mute and repeat-one

**Mute.** The speaker icon left of the volume slider becomes a button. Clicking it
mutes; clicking again restores the level it was at, not a default. The muted state
and the remembered level both persist across restarts, alongside `volume` in
`settings`. Muted is a distinct state from volume 0 — dragging the slider to zero
and pressing mute are different intentions and unmuting has to tell them apart.

**Moving the rail lifts a mute**, which the plan did not say either way. The
alternative — a fill that follows the pointer over a player that stays silent —
is a control that appears broken, and every other player treats a drag as
asking to hear something. The mute button is the only way back into the muted
state.

**Repeat one.** A single toggle: off, or this song forever. No repeat-all, no
shuffle — no shuffle control has ever existed here and none is coming.

It sits beside the volume rather than inside the transport pill: the pill is
prev/play/next and the design draws it as three buttons, and repeat is a
setting about what happens next rather than a thing to press now.

**Repeat is not persisted**, unlike mute and the volume beside it. The plan
asks for persistence of "the muted state and the remembered level" and says
nothing about repeat, and an app that came back from a restart still looping
one song would be a surprise: repeat is done to the song playing now, not to
the player. It survives a webview reload, because it lives in the engine.

The engine change is in the audio thread's end-of-track handling: with repeat on,
`ended` seeks to zero and plays again instead of advancing the queue. **Each loop
counts as a play** — `play_count` is bumped and `last_played_at` updated exactly as
a fresh start would, which is also what makes it scrobble correctly when last.fm
arrives. This is deliberate: a song on repeat for an hour has been played, and
recording it once would make Most Played wrong in the one case it matters most.

---

## Phase 39 — The background that follows the music

The largest piece, and the one with a Rust half.

**Extraction.** When a cover is stored, its three most dominant colours are
extracted and cached. In Rust, at cover-store time, not in the webview: the bytes
are already in hand there, it happens once per unique cover rather than once per
track change, and a `cover://` image on a canvas is a readback the webview would
have to be talked into allowing.

- A new migration appends `palette TEXT` to `covers`. (A migration entry is needed
  regardless of the fresh data directory — it is how the column comes to exist at
  all. What the rename buys is that there is no backfill: every install starts
  empty. Covers already in a database from before simply have a null palette and
  get one the next time they are seen.)
- The algorithm is median-cut over a downsampled image — the picture is being
  reduced to three blurred blobs at 10% opacity, so precision is not the point;
  determinism and speed are. It is a pure function over pixels, so it unit-tests
  against fixture images with no database and no Tauri runtime.

  **Built as a midpoint split instead.** Median cut divides a box at its median
  *pixel*, so three boxes hold a third of the pixels each — and an album cover
  that is 70% near-black, which is a great many of them, therefore spends two of
  its three boxes on near-black and averages everything bright into the third.
  Two blobs the same colour and one made of mud. Splitting at the midpoint of the
  widest channel's *range* divides by colour rather than by population: the darks
  fall one side, the accents the other, and the second split separates the
  accents. Both stated reasons — determinism and speed — hold either way. Boxes
  are ordered by pixel count afterwards, so the dominant colour still comes
  first. `src-tauri/src/palette.rs` says the same at the top, and
  `a_cover_that_is_mostly_one_colour_does_not_spend_two_blobs_on_it` is the test
  that decided it.
- Near-greyscale covers produce near-greyscale blobs, which is correct: the design's
  own sample data has one (`rgb(64,64,64)`, `rgb(112,96,96)`, `rgb(224,224,224)`).

**Delivery.** The playing track's palette rides along with the existing player
state rather than a new event — the frontend already learns what is playing, and
the colours are a property of that.

**Animation.** Three blurred radial blobs behind everything, at 7–10% opacity, over
the base surface. Their positions are the design's, but expressed as offsets from
the centre of the window (`calc(50% - 28vw)`) rather than as percentages: the
layer has to be far larger than the window so the rotation never swings an edge
into view, so a percentage is a percentage *of the layer* and lands somewhere
else. Written the naive way first, and the third blob spent its whole life below
the bottom of the window. Two behaviours:

- a **360° rotation once per minute**, one continuous turn;
- a **blend when the album changes** — a ~1.6s transition on the colours, so moving
  from one record to the next is a wash rather than a cut.

Nothing playing, or a track with no cover, means the default scheme with no blobs.

**Off switches.** `prefers-reduced-motion: reduce` stops the rotation — a minute-long
loop of moving colour behind text is exactly what that query is for. A checkbox in
the Settings dialog turns the whole thing off independently, persisted in settings.
The design carries the same idea as its `dynamicBackground` prop.

The table below says "blobs absent under reduced motion", which contradicts the
paragraph above it. The paragraph won: reduced motion stops the turn and the
1.6s wash between albums, and leaves the colours. Someone who asked for no
animation has not asked for no colour. The checkbox is the switch for the colour,
and the two are deliberately independent.

---

## Phase 40 — Open Artist on… / Open Album on…

Two submenus on the song row's right-click menu:

- **Open Artist on…** → Last.fm, Discogs
- **Open Album on…** → Last.fm, Discogs — present only when the row has an album.

URLs:

| | Last.fm | Discogs |
|---|---|---|
| Artist | `/music/<artist>` | `/search/?q=<artist>&type=artist` |
| Album | `/music/<artist>/<album>` | `/search/?q=<artist> <album>&type=release` |

Discogs resolves artists and releases by numeric ID, not by name, so a search URL is
the honest link rather than a guess that 404s. Every component is percent-encoded;
`+` and `&` in band names are the normal case, not the edge case.

**Album artist wins over artist** where both exist — it is the field that identifies
a compilation's actual act, and it is what the album URL needs to be correct.

Disabled with more than one row selected, and absent when the field is empty:
"Open Artist on…" for a track with no artist tag has nothing to open.

Both go through `tauri-plugin-opener`, added in phase 34. Its capability scope grows
to include `https://www.last.fm/*` and `https://www.discogs.com/*` — three allowed
hosts total, which is the whole list of places this app may send the user.

Because `rowMenuItems()` is shared with the Edit menu as of phase 34, these appear
in both without further work.

**The e2e will hit a driver limitation immediately.** This is the row's *context*
menu, and the embedded driver delivers neither `contextmenu` nor `dblclick` through
the Actions API — `element.click({ button: "right" })` opens nothing at all, which
cost phase 37 a CI run to discover, after `element.doubleClick()` cost phase 31 one
for the same reason. The remedy in both cases was to dispatch the event React is
listening for; `e2e/specs/smart-playlists.test.ts` has the helper, and it passes the
trigger's own coordinates because `ContextMenu.Trigger` derives the menu position
from the event. Reach for that rather than rediscovering it. Driving the two
submenus through the **Edit menu** instead is the other option, and tests the same
`rowMenuItems()` — but not that a right-click reaches it.

---

## Phase 41 — Screenshots at a size somebody actually uses

**Landed early, with phase 34 (#53).** It is numbered last and was built fourth:
phase 34 was the first phase whose screenshots were the point of the review, and
taking them at a laptop size would have wasted that. `e2e/viewport.ts` and its unit
test are the result. Kept here rather than renumbered, because every pull request
above refers to these numbers.

The e2e suite photographs features into the pull request body (phase 29). Those
photographs are currently taken at whatever the harness window happens to be —
1416×864, at zoom 1.0 — which is a laptop, not the case this app was built for. A
reviewer looking at a table designed for tens of thousands of rows sees about
twenty of them.

The target is **1920×1080 with the interface at 90%**. That is a full desktop
monitor with the UI scaled down slightly, which is how a dense library actually
gets used, and it puts roughly a third more rows in frame.

**Two things have to be true, and only one of them is ours.**

The window has to be able to *be* 1920×1080, which needs a display at least that
large. GitHub's Windows runners boot at 1024×768, so CI grows the virtual display
before the suite runs. The mechanism is a P/Invoke to `ChangeDisplaySettings` from
PowerShell — there is no cmdlet for it on the runner image — and it is allowed to
fail: a runner that refuses simply produces smaller screenshots.

The viewport then has to be sized in *physical* pixels, which is not what
`window.innerWidth` reports once zoom is involved. Setting a window to 1920 wide
and then zooming to 0.9 gives a 2133-pixel-wide CSS viewport inside an 1920-pixel
window, and asking for `innerWidth === 1920` would fight that forever. The helper
measures `innerWidth × devicePixelRatio`, compares against the target, adjusts the
window by the difference, and repeats a bounded number of times.

**Nothing asserts on any of it.** These are review aids; a screenshot that came out
at 1024×768 because the runner refused to resize is a smaller picture, not a failed
test. The helper reports what it achieved and the suite carries on — the same
principle that made `capture()` return `false` rather than throw.

**Zoom is applied to the webview directly, not through the store.** `useZoomStore`
persists to `settings`, and a screenshot has no business changing a preference that
outlives it. The webview's own `setZoom` is a display change and nothing more.

The viewport is entered and left around each capture rather than set for the whole
run. Two reasons: the appearance and virtualization suites assert against the
window they were written for — "only a windowful of rows" means something different
at 1080 pixels — and a spec that resized the window permanently would make every
later spec's failure depend on which specs ran before it.

---

## Phase 42 — The dependencies, and who watches them

Nothing here is a feature. It is the maintenance that has been accumulating quietly
since phase 1, found by running `npm outdated` on 2026-08-05 rather than by anything
breaking.

**`@tanstack/react-table` is removed.** It has been a dependency since the phase 1
scaffold and has never been imported — a search of every `.ts`, `.tsx`, `.js`,
`.mjs` and `.json` in the repository finds it in `package.json` and nowhere else.
`PLAN.md` named TanStack Table, but the songs table ended up hand-rolled, and that
was the right call rather than an oversight: the row model is server-side keyset
paging over SQLite, so sorting, filtering and pagination all live in Rust. A table
library whose whole value is owning those three has nothing left to own here.
`@tanstack/react-virtual`, which *is* used, is a different package and stays.

That also settles what to do about its 9.0.0 release: adopting it would mean
rewriting a working virtualized table to hand a library back responsibilities the
database already has. Removing the dependency drops a licence entry from
`THIRD-PARTY-NOTICES.md` that we currently attest to for code that never ships.

**The routine updates**, all inside their existing semver ranges: `@base-ui/react`
1.6→1.7, `@biomejs/biome` 2.5.6→2.5.7, `@testing-library/user-event` 14.6.1→14.6.3,
the four `@wdio/*` packages to 9.30.1, and `@wdio/tauri-plugin`/`@wdio/tauri-service`
1.2→1.3. The wdio bump is the one that needs a real CI run rather than a green
`npm ls`: the embedded driver is what the whole e2e suite stands on, and it is the
one dependency here whose failure mode is "the suite cannot start".

**The majors are not all one job.** In rising order of how much they can break:

| Package | → | Why it is where it is |
|---|---|---|
| `@testing-library/jest-dom` | 7 | A handful of matchers; the surface we touch is small |
| `@vitejs/plugin-react` | 6 | Two majors of mostly peer-range churn |
| `vitest` + `@vitest/coverage-v8` | 4 | Move together. Coverage thresholds are configured, and v4 may express them differently |
| `jsdom` | 30 | Four majors. The one that surfaces latent assumptions in component tests |
| `vite` | 8 | After plugin-react, and only once Tauri v2 is confirmed to support it |
| `typescript` | 7 | The native port — a different compiler. Its own branch, with nothing else in it |

Rust is quieter: `ts-rs` 11→12 and `sha2` 0.10→0.11 are the only breaking ones.
`rusqlite`, `lofty`, `rodio` and `tauri` are all current.

**Nobody was watching.** `.github/` holds `workflows/` and nothing else — no
`dependabot.yml`, no Renovate — which is why this accumulated silently rather than
arriving as a stream of small PRs. A grouped weekly Dependabot config over npm,
cargo and `github-actions`, with patches and minors batched into one pull request
per ecosystem and majors left to open individually, puts the routine half of this
phase on a schedule and leaves only the table above as a decision.

The split matters for how this lands: the removal, the in-range updates and the
Dependabot config are one pull request. Each major is its own, because a red CI run
has to point at one suspect.

---

## Testing

Per phase, in the same pull request as the work — the existing standard, not a new
one.

| Phase | Rust | Frontend | e2e |
|---|---|---|---|
| 32 | — | — | window title |
| 33 | — | token presence in `App.css.test.ts` | contrast spec re-run against the new ramp |
| 34 | — | menu contents, disabled states, `rowMenuItems` reuse | open each menu; F5 rescans |
| 35 | — | transport strip renders; sidebar nav switches views | screenshot of the new shell |
| 36 | count-with-filter | collapse persistence, debounce | collapse, reload, still collapsed |
| 37 | the cutoff decides membership and survives sorting, searching and a changing library; whitelist rejects unknown sort fields; the built-ins seed once and stay deleted | editor round-trips sort and limit; offers no sort the backend refuses | build a limited playlist, **sort it twice and get the same songs**, reopen it on its stored cutoff |
| 38 | repeat loops and bumps `play_count` | mute restores the prior level | mute, repeat, reload |
| 39 | median-cut over fixture images; palette cached and reused | blobs absent under reduced motion and when disabled | screenshot with a cover, and without |
| 40 | — | URL construction incl. encoding; album-artist preference; disabled states | menu shows both submenus |
| 41 | — | the physical-pixel arithmetic, without a browser | the screenshots come out at the size asked for, or say what they came out at |
| 42 | `cargo test` unchanged | the existing suites, which are the test | the existing suite on the new wdio — the point of the phase |

Two properties get asserted rather than assumed, because both are easy to break
silently:

- **No literal colours outside the token block.** A lint over `App.css` — the thing
  that keeps a light theme cheap to restore.
- **No stale bindings.** Already enforced; phase 37 is the one that will trip it.

Screenshots are captured by the e2e suite and pushed into the pull request body by
`scripts/screenshots.mjs` (phase 29), so every phase from 33 onward shows its own
result without anything entering the repository.

## Verification, by hand, at the end

- Point Apex at a real library. The window says Apex, the data directory is new,
  and a scan fills it.
- Every view reachable from the sidebar; no tab bar anywhere.
- File ▸ Rescan and F5 do the same thing. Export is disabled with nothing selected
  and exports the open playlist when one is open.
- Most Played is empty on a fresh library and fills as songs are played. It can be
  renamed, edited and deleted like any other.
- Play an album with artwork: the background takes its colours and turns once a
  minute. Skip to a different album: the colours wash rather than cut. Turn it off
  in Settings; it stops.
- Repeat a song, leave it for ten minutes, then check its play count.
- Mute at 40%, unmute, still 40%.
- Right-click a track by a band with an `&` in its name; both links land somewhere
  real.

## Open items

- **Statistics** is shipped dimmed and inert, as the design draws it. What it
  eventually shows is not decided; it needs a phase of its own.
- **Repeat and scrobbling** interact: `docs/PLAN-lastfm.md` was written before
  repeat existed. When last.fm lands, its scrobble rules apply per loop, which is
  consistent with what phase 38 records locally but worth re-reading at the time.
- **The repository name** still says `player-experiment`. Renaming it is a separate,
  self-contained job whenever it is wanted.
