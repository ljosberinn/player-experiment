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
replaces the current one. Nine phases, one branch and one pull request each, in the
order given — later phases assume the earlier ones landed.

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
- A version string appears in the title bar in the design. It already exists in the
  status bar, read from the Rust crate through `get_app_info`. It moves rather than
  being duplicated — one source, one place on screen.

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

**The built-ins.** Two smart playlists exist out of the box:

- **Recently Added** — sorted by `added_at` descending, limited to 100.
- **Most Played** — `plays > 0`, sorted by `play_count` descending, limited to 100.

Both are ordinary smart playlists seeded on first run: editable, renameable,
deletable. Nothing about them is special-cased, which is only possible because of
the next phase. **Top Rated is not among them** — there is no rating field in the
schema and inventing one to satisfy a mockup label would be the tail wagging the
dog. Custom smart playlists continue to work exactly as they do now.

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

`count_tracks` has to learn about the limit or every "Most Played" will report the
whole library. `min(count, limit)` at the call site is enough and avoids a second
query shape.

The rule builder in `SmartPlaylistEditor` gains a footer row — *sorted by …
descending, limited to … songs* — with both parts optional. The design's modal has
the rule list already; this is one line beneath it.

Bindings are regenerated (`npm run bindings`); CI fails if they are stale.

---

## Phase 38 — Mute and repeat-one

**Mute.** The speaker icon left of the volume slider becomes a button. Clicking it
mutes; clicking again restores the level it was at, not a default. The muted state
and the remembered level both persist across restarts, alongside `volume` in
`settings`. Muted is a distinct state from volume 0 — dragging the slider to zero
and pressing mute are different intentions and unmuting has to tell them apart.

**Repeat one.** A single toggle: off, or this song forever. No repeat-all, no
shuffle — no shuffle control has ever existed here and none is coming.

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
- Near-greyscale covers produce near-greyscale blobs, which is correct: the design's
  own sample data has one (`rgb(64,64,64)`, `rgb(112,96,96)`, `rgb(224,224,224)`).

**Delivery.** The playing track's palette rides along with the existing player
state rather than a new event — the frontend already learns what is playing, and
the colours are a property of that.

**Animation.** Three blurred radial blobs behind everything, at 7–10% opacity, over
the base surface. Two behaviours:

- a **360° rotation once per minute**, one continuous turn;
- a **blend when the album changes** — a ~1.6s transition on the colours, so moving
  from one record to the next is a wash rather than a cut.

Nothing playing, or a track with no cover, means the default scheme with no blobs.

**Off switches.** `prefers-reduced-motion: reduce` stops the rotation — a minute-long
loop of moving colour behind text is exactly what that query is for. A checkbox in
the Settings dialog turns the whole thing off independently, persisted in settings.
The design carries the same idea as its `dynamicBackground` prop.

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
| 37 | compiler emits ORDER BY/LIMIT; whitelist rejects unknown sort fields; injection attempts | editor round-trips sort and limit | create a limited smart playlist |
| 38 | repeat loops and bumps `play_count` | mute restores the prior level | mute, repeat, reload |
| 39 | median-cut over fixture images; palette cached and reused | blobs absent under reduced motion and when disabled | screenshot with a cover, and without |
| 40 | — | URL construction incl. encoding; album-artist preference; disabled states | menu shows both submenus |

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
