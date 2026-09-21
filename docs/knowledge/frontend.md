# Frontend

React 19 + TypeScript + Vite, Zustand stores, TanStack Virtual, Base UI for
menus, dialogs, sliders, tabs and toolbars. No CSS framework. `src/App.css` is
four `@import`s in cascade order — `styles/tokens.css` (the palette, on both
grounds), `styles/primitives.css` (reset, window, focus, the blob layer),
`styles/library.css` (the component library, drawn in
`components/primitives/`) and `styles/app.css` (every region from the title bar
down) — and Base UI parts are handed classes that already exist. The order is
the cascade: a region has to be able to overrule a primitive it wraps, so
`library.css` comes before `app.css` rather than after it.

## The table

- Per page: `LIMIT/OFFSET` behind a small window cache; the virtualizer renders
  ~40 rows whatever the library size. Pages beyond a radius of the viewport are
  evicted.
- Pages not yet fetched render **skeleton rows** — scrolling never blocks on IPC.
- **Every query carries a token.** Responses check it before writing, so a slow
  first search cannot overwrite a later one. The fetch effect keys on the token
  too: a re-sort changes neither the visible range nor the total, and without it
  the table sits on stale placeholders.
- Selection is an id `Set` plus a shift anchor, so "select all 50k" never
  materializes 50k row objects.
- **Real `<table>` markup**, not divs with ARIA roles. `aria-rowcount` carries
  the true library size even though only a window is in the DOM.
- `ROW_HEIGHT` lives in `SongRow.tsx`, beside the row it is the height of, and
  the virtualizer imports it — a CSS copy would be a second number to keep in
  step. Change one, change both.
- `headerBounds()` queries `th[data-column]`: the status column has no id and
  counting it offsets every drag-to-reorder drop index.
- **Double-clicking a divider fits the column to the rows on screen**, measured
  with a `Range` over each cell's contents (`columnFit.ts`) — the cells clip with
  `ellipsis`, and a clipped element's `scrollWidth` omits the padding on the
  overflowing side. Visible rows only: the widest value in a 150k-row column is
  neither in the DOM nor cheap to ask for, so fitting is deliberately not
  idempotent.
- **Every navigation fits every visible column** through the same measurement.
  The widths live in `fittedWidths`, apart from `ColumnConfig` and never saved,
  so a width the user dragged still wins and a view that has grown since its
  last visit is fitted again. `applyEntry` raises `fitPending` — not `refresh`,
  which every sort toggle and every debounced keystroke also reaches, and
  columns that resize while typing are worse than columns that are too wide.
  The fit consumes the flag once the first page has landed, because rows that
  have not arrived render a skeleton and measuring those measures the shimmer.
  "Reset Columns" drops the fit with the config, or it appears to do nothing.

## The browse views

- Releases is a grid, artists and genres are lists, and both are virtualized **by
  row**: the column count comes from the container width, so the two are
  computed together.
- The width is measured into state through a `ResizeObserver`. A ref read during
  render is whatever the last commit left there, which is how the grid came to
  be fixed at its first measurement.
- **The measured element is the `<section>`, not the scroll container.** A row
  is as wide as the section; the container's `clientWidth` also counts
  `.browse-body`'s 30px of padding on each side. Counting columns against those
  extra 60px overflowed the grid sideways at about a quarter of all widths.
  `TILE_WIDTH` and `TILE_GAP` are separate constants for the same reason — `n`
  tiles need `n` widths and the `n - 1` gaps between them.
- A reflow keeps the row height and changes what a row holds, so the scroll
  offset survives it pointing at a different album. `BrowseView` re-anchors on
  the group that was at the top and drops the virtualizer's size cache.
- Lists stripe by **data index**, not `:nth-child` — the rows are absolutely
  positioned, so DOM order is the visible window rather than the list.
- **A smart playlist opens on Releases, a static one on whatever was open.**
  The landing tab is the kind's, which is why `showPlaylist` takes the
  `Playlist` row rather than an id - the library store has no business reading
  the playlists store to find it out. A smart playlist is a question about the
  library and its answer reads as releases; a static one is an ordered list
  somebody built by hand, so the order is the content. The grid, the per-tile
  counts and the drill-in were already scoped to the playlist through the same
  `scope()` the songs table uses, so this is only what the source resets *to*.
  The consequence to know about: a smart playlist spanning several releases has
  no screen listing its songs as one list, because a LIBRARY button still
  changes the source back to the library. Reaching that list needs a source row
  the sidebar does not have - see phase 100 in `issues/done/`.
- **A drill-in that lands empty ejects to the group list**, from inside
  `refresh()` itself so a group emptied by a tag edit, a missing file or a
  rescan is covered the same way. Only when there is no active search — one
  that legitimately matches nothing must not eject — and only once the query
  has actually landed. The dead entry is dropped from history rather than
  pushed over, the way `forgetPlaylist` drops a deleted playlist's, so Back and
  Forward cannot land back on it.

## Charts

`src/components/charts/`. **`scales.ts` is the only file importing d3** —
`d3-scale` for the domain-to-pixel mapping, `d3-shape` for the arithmetic of a
ring segment. What is borrowed is the maths and nothing else, so every element
and every colour on screen is ours, which is what the design and
`e2e/contrast.ts` both require.

- **Ticks come back as data**, `{ value, offset, label }`, not as an axis
  generator wanting a DOM node. A chart lays them out and a test asserts on
  them.
- **`niceDomain` is where collapsed domains are handled, once.** An empty
  series and a series where every value is equal are both a panel's normal
  cases — a filter that matched nothing, a library where every album shares a
  bitrate — and a scale given either maps everything onto one pixel, or onto
  NaN.
- **`ChartFrame` measures; primitives do not.** It measures the `<section>`
  into state through a `ResizeObserver` (`BrowseView`'s rule, for the reason it
  paid for) and hands down a plot rect, so a primitive is a pure function of
  its data and that rect. It also owns the margins — one constant, because
  charts whose plots start at different x do not read as a set — the empty and
  loading states, the `role="img"` label and the show-as-table toggle. Those
  last two live here so that a panel cannot ship without them.
- **Loading outranks empty.** An aggregate in flight is not an aggregate of
  nothing; saying there are no plays and correcting it a frame later is worse
  than saying nothing yet.
- **The tooltip is the one deliberate exception to "no hover states".** A bar
  whose value cannot be read is a picture rather than a figure. It is mounted
  by the panel only while something is hovered, so there is no empty box in the
  DOM between hovers, and it carries `pointer-events: none` — it follows the
  pointer and must never be the thing under it.
- **Colours are tokens only**, so the contrast rule holds by construction
  rather than by inspection. The decision, ahead of the primitives that need
  it: single-series marks and every sequential magnitude draw from an
  accent-derived ramp, so the app stays monochrome where it can, and a separate
  five-to-six hue categorical set — validated against `--surface` — exists only
  for multi-series. The sequential ramp is in the sheet as `--chart-ramp-0` to
  `-4`, an empty step and four opaque steps up to the accent, landed with
  `Heatmap`; a mark takes a step through `rampStep` by its share of the
  largest, rounded up so one play never reads as none.
- **The categorical set did not land with the donut, and the donut is why.**
  `genre_breakdown` returns its slices ordered by size, so a genre ring is a
  magnitude series wearing a different shape — the sequential ramp reads as
  what it already is, and a hairline of `--surface` between neighbours is what
  separates two slices that share a step. Five new hues are a decision for the
  design source rather than for the first chart that could have used them. The
  set earns its place when something draws categories that are genuinely
  unordered.
- **`BarList` is HTML, and deliberately not a `ChartFrame`.** A ranked list is
  already the table `ChartFrame`'s toggle would offer, and wrapping it in one
  `role="img"` would take away the reading it has: names that truncate, rows
  that take focus, an ordered list a screen reader can walk. So it owns its own
  empty and loading states, and it draws each fill as a share of the largest
  value rather than of the total - a top list is read as rows against each
  other, and a long tail measured against the total is ten slivers.
- **`Bar` is a categorical axis, never a numeric one.** The domain is the
  array's order: a histogram with an empty bin and a sparse time series both
  want the gap the caller left, and a scale over the values would close it. So
  `fillBins` in `features/stats/histogram.ts` is what puts an empty bin back,
  and it has to know the backend's bin width to do it. The per-bar readout is
  a `<title>`, which costs nothing and keeps the chart a pure function of its
  props.
- **`ChartFrame` takes its ticks as a function of the measured plot**, as well
  as as an array. Every tick on a scale sits at a position derived from the
  plot's height or width, which only the frame knows; `Bar`, its first real
  caller, is what found that out.
- **`Heatmap` is categorical on both axes**, so `ChartFrame` draws it with
  `grid={false}`: a gridline through a row of weekday cells shows through every
  gap and measures nothing.
- **`Donut` divides by the total, and takes `RADIAL_MARGIN`.** Every other
  chart here divides by a domain or by the largest value; a ring's whole is its
  sum, which is what lets a slice mean the same on two panels that agree about
  no maximum. The margin is the other side of the one-constant rule rather than
  an exception to it — what the constant buys is plots that line up, and a
  radial chart has none, so an axis gutter under it is a ring drawn off-centre.
  `arcPath` is d3's generator rather than trigonometry for one case: a slice of
  a whole turn is a full circle, and a single SVG `A` command cannot draw one.
- **A slice click is a shortcut, and the table holds the real control.**
  `role="img"` makes a frame's whole subtree presentational, so nothing inside
  an svg is reachable by anything but a pointer. A drill therefore has a button
  in the table, and the path carries `data-drills` and no `role` — claiming one
  that no assistive technology can reach would be worse than claiming none.
- **A time series is cut by its span, not by the range filter.** `bucketFor`
  in `features/stats/series.ts` picks days, weeks, months or years from how
  long the span is; under all time the span is `listen_totals`' first and last
  play, taken from the scan the tiles already started. `fillSeries` then puts
  the empty buckets back, stepping by the local calendar - a local day is not
  86,400 seconds twice a year.
- **What has not landed**: `Line`, `Donut`, `Sparkline`. Each wants a real
  panel as its caller; the donut is 84d. The file list in the plan is a
  ceiling, not a checklist. `d3-shape` is still not a dependency, because
  nothing draws an arc or an area.
- Charts hold no virtualizer, so unlike `SongTable` and `BrowseView` they
  compile clean under the React Compiler and want no `"use no memo"`.

## Where a subscription lives is the perf lever

`positionMs` (4/s), `volume` (per pointer move), `searchInput` (per keystroke)
and `selection` (per click, shift-range and Ctrl+A) each re-rendered the whole
tree while read at the top of `App`. Each moved into a component that subscribes
on its own behalf — `NowPlayingStatus`, `PlayerTransport`, `SearchBox`,
`AppMenus`. `App.renders.test.tsx` counts renders, because a count is exact
where a wall-clock budget on a CI runner is noise.

`resolveColumns` runs inside `SongTable` rather than in `App`. The shell had no
use for the config beyond handing the result down, so subscribing where the
columns are rendered keeps a width change — a drag, a fit — out of the shell's
render entirely.

**File splitting delivers nothing here; a component boundary does.**
`memo(SongTable)` was deliberately not taken — the table subscribes to the
selection itself, so the one frequent update re-renders it regardless, and no
memo can stop a component's own subscription from waking it. React Compiler
does not change that argument, it only removes the alternative: a child whose
props did not change is held still without anyone writing `memo`, and a
component that reads a fast-changing value itself is beyond either.

The boundary that *does* pay is one level down. **A row is its own component**
(`SongRow.tsx`), so the compiler caches its JSX per props while the table stays
uncompiled behind `"use no memo"`. That puts the whole weight on prop
stability, and the rule is that a row is given per-row facts and never table
state: `selected` and `playing` rather than the selection and the playing id,
`drop` rather than the drop index — passed raw, one pointer move over a row
would invalidate every row in the window instead of the one under it. The handlers
travel with the row and read `useLibraryStore.getState()` where they need the
selection, the way the table's window keydown listener already does, so a row
subscribes to nothing and forty-odd subscriptions are not the trade. What the
table is not compiled for, it does by hand: `columns` and the one `actions`
object are `useMemo`d, because a fresh array or object there is a changed prop
on every row. `SongTable.renders.test.tsx` counts `ColumnDef.render` calls
against a 47-row window: a click and a sub-row scroll touch no cell at all, and
crossing six rows renders six. Before the split those were 235 and 3265.

That also decides what the render test may assert. The `SongTable` stub has no
subscription, so its count measures `App`, not the real table; the honest
subject for a selection change is `PlaylistSidebar`, which wants nothing from
the selection.

### Seeing it, before counting it

`npm run dev:scan` is `tauri dev` with react-scan attached: it outlines every
component that re-rendered in the running window and names the prop or store
read that woke it. The two render tests stay the CI guard — react-scan needs a
real browser and a canvas, and a live overlay asserts nothing — but it is the
instrument to reach for *before* writing a count, and the one that says which
prop moved when a count you expected to be zero is not.

It has to be the app rather than a browser tab on the dev server: without
`window.__TAURI__` the first query throws and nothing renders, so there is
nothing to outline. That is why the script is a `tauri dev` with a config
overlay (`src-tauri/tauri.scan.conf.json`) that swaps `beforeDevCommand` for
`vite --mode scan`, rather than a second Vite script.

The import sits in `main.tsx` behind `import.meta.env.DEV &&
import.meta.env.VITE_SCAN === "true"`, which the mode file `.env.scan` sets, so
`npm run dev` and `npm run tauri dev` show no overlay. `DEV` is what guarantees
the elimination: a build carrying `VITE_SCAN=true` in its environment produces a
byte-identical bundle to one without.

React Compiler is what makes the overlay honest rather than confusing: a child
the compiler holds still simply does not light up, and the two components behind
`"use no memo"` light up because they really did render.

### React Compiler

Enabled in `vite.config.ts` through `@vitejs/plugin-react`'s own oxc port, over
every component and hook. Vitest shares that config, so the unit run and the
build compile the same code. So does Storybook — the builder merges the plugin
list, so `*.stories.tsx` is held to the same bar as the components it draws.

- **A bailout fails the build** (`panicThreshold: "all_errors"`). Biome has no
  react-compiler rule and there is no ESLint, so nothing in `npm run lint` would
  report a file the compiler skipped, and a rules-of-React violation would
  otherwise sit in a build log unread. The cost is that such a violation breaks
  `vite dev` too, which is the point.
- **`SongTable` and `BrowseView` carry `"use no memo"`.** The compiler declines
  any component holding a `useVirtualizer`: TanStack Virtual returns functions
  whose identity changes without the instance's, and memoizing around them shows
  stale rows. The directive demotes that to a warning, which `onwarn` then lets
  through by name — the only react-compiler diagnostic it accepts.
- **Function outlining is off** (`environment.enableFunctionOutlining`). It
  hoists a closure that captures nothing to module scope, giving every instance
  of a component the same function *identity*. Five hooks here hand such a
  handler to `addEventListener`, which deduplicates by identity: two mounted
  components shared one listener and the first unmount took it from both.

## Native feel

The app must not read as a web page in a window. Enforced by absence, and
absences are what nobody notices coming back — hence the guards in
`App.css.test.ts` (see [testing](testing.md)).

- **Icons go through `components/icons/Icon.tsx`**, named by meaning
  (`"play"`, `"genres"`). `registry.tsx` beside it is the only file that names
  the library — Phosphor, imported per icon rather than from the root barrel —
  so swapping families is one file. Library-specific props such as Phosphor's
  `weight` are bound in the registry, never at a call site.
  - Every icon is decorative: each sits beside its own label or inside a button
    with an `aria-label`, so a name here would be announced twice.
  - **The caption buttons are the exception** and stay Segoe MDL2 (see
    `.window-buttons` in `styles/app.css`). Those are the OS glyphs; a library X in the
    corner of a Windows title bar reads as a web page.
- **Every dialog is `primitives/Dialog`**, which is header, body and footer
  over one of Base UI's two roots. `role="alert"` picks `AlertDialog` — an
  alert cannot be dismissed by its backdrop, which is why the delete
  confirmation and the crash notice are alerts — and everything else is the
  ordinary `Dialog`. The eight callers import the primitive, never Base UI.
  - **The box states the chrome and no padding**: `--chrome` over the ground, a
    `--menu-border` hairline, `--shadow-dialog`. Each region pads itself,
    because Settings' rail and pane need the hairline between them to run the
    full height of the row. The header and footer carry the 2px `--rule` that
    is what the sheet has instead of a card.
  - A region may say how wide its dialog is or how tall — `.dialog.lookup`
    states a height, `.dialog.settings` a grid — but the edge, the inset and
    the shadow are the primitive's, and `App.css.test.ts` fails an `app.css`
    rule that restates one.
  - `DialogFooter`'s `lead` is the left-hand slot, and holds one of two things:
    the action that leaves rather than completes ("Back to queue", ghost), or
    the count the dialog has to state ("2 conditions · 116 songs match"). Never
    both — a dialog either has somewhere to go back to or something to tally.
  - **The smart playlist editor's rule box is one grid**, `130px 130px 1fr
    30px`, so the field and operator selects line up down the column instead of
    each row packing its own flex. A rule is `display: contents` and its four
    cells are the grid's own; the header line, the empty note and a nested
    group span `1 / -1`, the nested group being a box with a grid of its own so
    its rules align with each other rather than with the outer columns. The
    value cell is a box even where one control fills it, because `inLast` adds
    a unit, `between` adds a second bound, and `kind: "none"` leaves it empty.
  - **The sort and cutoff rows are disabled in place to be read**, not because
    they cannot be used yet, so `.filter-order` overrides the primitives'
    `opacity: 0.45` with `--field-disabled`, `--chrome-border` and `--faint`.
- **A dialog that outlives its own content states does not resize.** `.dialog`
  on its own is a scroller with a `max-height`, which is right for a dialog
  asked once and dismissed. One that is stepped through — the lookup's queue,
  settings' categories — passes `paned`: the popup takes a `height` and
  `overflow: hidden`, and `.dialog-body` inside it is the only scroll area, with
  `flex: 1` and the `min-height: 0` beside it that lets a column flex child
  shrink below its content. Everything else is `flex: none` and stays put. A
  second `max-height` scroller inside a paned dialog is the regression;
  `App.css.test.ts` guards it.
  - **Settings lays the same parts out as a grid**, with its rail of categories
    beside the body. The popup renders as Base UI's `Tabs.Root` through the
    primitive's `render`, so the `Tabs.List` and the one mounted `Tabs.Panel` —
    which is the `.dialog-body` — are both its children, and switching category
    mounts a fresh pane at the top. `SettingsDialog` takes the category to open
    on: Account ▸ Connect to last.fm… opens it on Online.
- **The component library is `components/primitives/`**, one file per
  component, drawn by `styles/library.css`. What the sheet specifies rather
  than what a caller wanted: `Button` has four kinds and **at most one
  primary per surface**, `IconButton` has four sizes named for the four
  places they belong (32px toolbar, 36px dialog, 30px filter rule, 20px
  nudge), and `Tag` has
  four tones with `Count` beside it. The design names a tag and a badge
  separately and draws them identically, so this is one component — the same
  reasoning that folded `--dim` into `--muted`.
  - `destructive` is the one kind the sheet does not draw. It is a yes that
    cannot be taken back, and it exists because phase 113 took away the
    `.modal-actions .destructive` rule it used to live in.
  - **`IconButton`'s dialog size wears `in-dialog`, not `dialog`.** The classes
    are global, so a 36px button carrying `dialog` would pick up `.dialog`
    itself — a fixed-position 912px box with a shadow.
  - **`StatRow` and `StatTiles` take the whole set, not one figure.** Each
    renders one `<dl>` around all of them, so a grid of six is one group of
    six pairs rather than twelve unrelated announcements. Which form a figure
    belongs in is the sheet's own rule: a bare number sits on the row, a
    number that needs a line of prose takes a cell. A unit rides inside the
    figure rather than under it — "1.5 years", "68%" — which is why
    `spanParts` and `byteParts` exist beside `formatSpan` and `formatBytes`.
  - **`Streak` is 4a's figures over a picture of one of them.** Same `<dl>`
    rule, and the caption row reprints the current run beside the record
    although the figure above it says the same thing — the sheet draws it, and
    that line is what the track under it measures. The seven day bars are the
    one thing the figures do not carry, so the strip is `role="img"` with a
    label rather than decoration: `Heatmap`'s bargain, and for its reason.
    They run oldest to newest, which the sheet's own mock does not — it fills
    the leftmost four for a four-day current streak, and that reads against
    the hour axis 4d draws directly below it.
  - **The streak's track and its empty days carry a `--track-border`
    hairline.** The transport's deviation from the design, applied a third
    time for the reason it was made: `--track` is 1.33:1 against the ground
    behind it, and WCAG 1.4.11 asks 3:1 of the parts of a graphic needed to
    understand it. The track's extent is what the fill is a share of, and a
    day without plays is half of what the strip says.
  - Regions migrate onto them one issue at a time. See
    [plans/apex-components.md](../plans/apex-components.md).
- No hover backgrounds, except window caption buttons, menu items and the two
  button primitives — a row lighting up under a passing pointer reads as a web
  page, a target reporting that it can be pressed reads as the platform.
- No transitions or animations, except the playing-row speaker, which **is** the
  state — and it stands down under `prefers-reduced-motion`.
- `cursor: default` everywhere but text fields. No focus ring on click
  (`:focus-visible` only). `overscroll-behavior: none`.
- Selection stays tinted, dimmed, when the window loses focus.
- The webview context menu is suppressed outside text fields by one
  document-level listener. Text inputs keep theirs — Cut/Copy/Paste and the IME
  entries are real functionality.
- Every widget is drawn, not inherited from the browser (phase 111). The
  `<select>`s stayed native until then, on the argument that an OS popup is
  closer to native than any listbox; two grounds retired it, because an OS
  popup draws in the OS's colours and the design's claim is one token set
  across both. `Checkbox` and `Radio` still keep the native element underneath
  the drawing — it is what carries the keyboard, the label and the grouping.
- A drag badge ("7 songs") replaces the browser's translucent row screenshot. It
  is a `position: fixed` element on the body, moved by `transform` every frame
  from outside React, and it carries `pointer-events: none` — without that it is
  the element under the pointer and swallows every drop target in the window.

## Chrome and state

- `features/library/store.ts` owns the view (tab, search, sort, selection,
  stats); `features/player/store.ts` owns playback; `features/shell` owns the
  window (geometry, zoom, menus, dynamic background).
- **There is one invalidation channel.** The library and playlists stores each
  `watch()` `library://changed` and reload their own contents, debounced by
  `INVALIDATE_DEBOUNCE_MS`. The backend coalesces the event too, so the two
  compose: a write that runs for hours pings once per window rather than once
  per commit, and this debounce catches the burst that arrives together.
  A mutation does not reach across stores to say what
  it invalidated — that was fifteen `useLibraryStore.getState()` calls outside
  the library store, each with its own "is this the playlist on screen" guard,
  and every new mutation was another chance to forget one silently. What stays
  is navigation and selection, which no event can express: leaving a playlist
  before it is deleted, opening a smart playlist that was just created,
  clearing a selection whose rows are gone. Those run synchronously in the
  action, so the debounced reload always lands after them. `create` and
  `createFrom` also keep a direct `load()`, because the row they put into
  inline rename has to be on screen for the input to open.
- **The Statistics view splits its state by what history owns.** The drill path
  is library-store state (`statsPath`) because it travels in a `HistoryEntry`
  and Back walks it; the filters are `features/stats/store.ts`, because a range
  change must wake a panel and nothing above it. A second store holding a copy
  of the path would be exactly the drift the `history` field's comment refuses.
  `App` subscribes to neither: it branches on the `tab` it already reads.
- **Navigating inside Statistics issues no library query.** `applyEntry` skips
  its closing `refresh` for a stats entry and `refresh` returns early while the
  view is open, so a donut click does not re-count 150k rows and an import
  firing `library://changed` does not either. The move back out re-queries.
- **A Statistics panel loads through `usePanelQuery`**, which fetches on a
  filter or path change, ignores an answer to the question before last, and
  keeps what is drawn while the next one is in flight - blanking every panel to
  a skeleton on each range change makes the whole view flash. Nine panels would
  otherwise repeat the effect, and the one that forgot the cancel would draw
  the range the filter bar is not showing.
- **A genre override refetches through a version, not through
  `library://changed`.** It changes what every genre-filtered aggregate counts
  and moves no track row, so announcing a library change would rebuild the song
  table for a correction it cannot see. `statsStore.genreVersion` is bumped
  after the write - a refused correction changed nothing - and **only
  `useLibraryQuery` lists it**: it is the one place that builds the Library
  tab's query, and fifteen panels listing it by hand is where one forgets. The
  Listening tab needs it not at all, because Base UI unmounts the inactive tab
  and its panels remount and re-query on their own.
- **An album-grouping correction has the same shape, through
  `useListenQuery`.** `statsStore.groupVersion` is the Listening tab's
  counterpart, and `useListenQuery` is the hook that reaches all seven of its
  panels - added for that reason, since a pin changes which plays are one
  album everywhere the drilled album filter reaches, not only in the two
  panels that draw an album by name.
- **`AlbumLinkDialog` opens from the Top albums panel's action, on the drilled
  album**, the way `GenreOverrideDialog` opens on the drilled genre: a row
  already spends its click on getting there, and a grouping that reads wrong
  is noticed from inside the album it is wrong about. Its three corrections -
  retitle, separate, merge - are one write, `statsPinAlbum`, and a retitle
  reports back so the crumb follows the group rather than pointing at a
  heading nothing reads under.
- **`listenTotalsOnce` holds exactly one answer.** The tile row, the series'
  all-time span and every coverage caption want the same `listen_totals`, which
  is the dearest aggregate in the set; the promise is held rather than its
  result, so each later panel joins the first's scan.
- **A coverage caption says what a panel leaves out.** Genre is known for a
  matched play alone, and a play last.fm holds undated is placed in no series
  and no clock; the panel names the share it covers rather than drawing a
  subset as the whole. It is `StatsPanel`'s `caption`, not a chart's, because
  When you listen draws two charts over one coverage. One entry and not a cache: every panel
  moves to the new filters together, so the entry before last has no reader.
- **Drilling into an artist narrows the Listening tab rather than opening a
  page.** The crumb already reaches `ListenQuery` through `listenQuery`, so
  every panel re-queries narrowed without knowing a drill-down happened;
  `ListeningPanels` only changes which panels render. An artist page would have
  been a second component tree drawing the same aggregates under one more
  filter.
- **A pending library removal lives in the library store**, not in `App`'s
  `useState` beside the missing-songs flag. Three routes ask the question - the
  row menu, the File menu and Delete - and the last is a window-level shortcut
  with no props to be handed a setter through. `App` subscribes to
  `pendingRemoval` and renders the one `ConfirmDialog`, so the question is asked
  the same way whichever route asked it.
- **There is one status channel**, `features/shell/statusStore.ts`: one
  `message` behind the error popover and one `notice` behind the content line,
  written through the free `report`, `notify` and `dismiss`. No feature store
  carries an `error` of its own — `App` used to merge five of them and pick the
  first, which is the same thing said less directly. One slot, last wins, and
  an operation clears the popover as it starts so a successful retry is not
  read under the failure before it. Two deliberate exceptions: the updater
  keeps a diagnostic `error` behind `status: "failed"`, deliberately unshown
  because a check that fails usually means the machine is offline, and last.fm
  keeps its own because `LastfmSettings` draws it inside the dialog it belongs
  to. Failures nobody asked for still stay silent — `loadColumns`,
  `loadSections`, `toggleSection` and `getAppInfo` keep their bare `catch`.
- **A dialog-only section keeps its state local.** `WatchFolderSettings` reads
  the folder list and the interval in a `useEffect` and holds them in
  `useState`, and `LibraryFolderSettings` does the same with the root and its
  switch. `SettingsDialog` is mounted when it opens, so there is nothing to
  keep in step while it is closed, and a store would be a subscription the
  shell pays for on every launch to serve a pane most sessions never open. The
  one exception is the folder those two sections have to agree about: the
  Library folder is a watch folder that cannot be removed while the filing is
  on, so `SettingsDialog` holds which row that is and hands it to both. A value
  two siblings read comes from above them, not from a store neither of them
  needs while the dialog is closed.
- **Each browse tab is its own instance**, keyed on the tab in `App`. Unkeyed,
  the three shared one component and one scroll container — `song-body` and
  `song-body browse-body` are both a `div` in the same slot, so React reused
  the element even across the empty-state frame between them and `scrollTop`
  rode along. Where each was left is an index into `groups` in the library
  store, written on unmount through `getState()` and never subscribed to, so
  scrolling costs no render. An index rather than a pixel offset: the window
  can be resized while another tab is open, and an index survives a changed
  column count. A search or a move into a playlist clears all three, because
  the list they point into is no longer the same list, and bumps a
  `browseListToken` in the same write: clearing is enough for the two tabs that
  are closed, since they read the offsets when they open, while the one on
  screen has read them already and stays where it was. That token is the single
  thing about the offsets `BrowseView` subscribes to, and it places itself again
  whenever it changes. The write is skipped
  until the instance has restored: before that `topGroupRef` still reads 0, and
  StrictMode's extra mount-teardown-remount in development lands that teardown
  while the groups are still in flight — writing a zero over the very offset
  being waited for, which is what made the feature look dead in `tauri dev`
  while every test passed.
- **Every view change goes through `applyEntry`.** A view is
  `{ tab, browse, playlistId }`, written in one `set` and refreshed once; the
  four actions that used to write those fields separately are entry
  constructors over it. Search and sort are deliberately *not* in an entry —
  search changes per keystroke, and the sort is derived so that going back into
  an album lands in track order rather than in whatever order it was left in.
  The history itself lives in the library store, because a second store holding
  a copy of those three fields would drift out of step with them.
- The **OS window title** follows the player: `Apex — <title> — <artist>`, back
  to `Apex` when nothing is playing. With `decorations: false` it is invisible
  in the app and shows only in Alt+Tab and the taskbar, which is where it is
  wanted. `tauri.conf.json` still sets the idle title for the first frame.
- `NowPlaying` is **hidden, not absent**, when nothing is playing: it is the
  widest thing on a fixed strip, and a box arriving with the first song would
  shove the volume and the search field sideways. Double-clicking it opens the
  track's album, or its artist, through one store action that writes `tab` and
  `browse` together and refreshes once.
- The volume rail takes the **wheel** through a non-passive `addEventListener`.
  React attaches `wheel` passively, so `preventDefault` in an `onWheel` prop
  does nothing but log a warning while the page scrolls anyway.
- Zoom is **webview zoom**, not CSS, so CSS pixel coordinates and `ROW_HEIGHT`
  are unaffected. Applied before the window is shown, rounded to one decimal on
  every path, and a rejected zoom is not persisted.
- The window starts `"visible": false` and is shown once geometry is applied —
  otherwise a white flash at the default size. The `show()` call sits **outside**
  the restore's try: a window that never appears is worse than one misplaced.
- A maximized window stores the flag, not the bounds.
- **In-app dragging is a pointer gesture, not HTML5 drag and drop**
  (`playlists/trackDrag.ts`, since phase 74). The session is module state rather
  than store state — the badge moves every frame and a row subscribes to
  nothing — and drop targets read it synchronously in their own handlers. No
  `setPointerCapture`: capture retargets every later event to the capturing
  element, so a row that captured could never see the sidebar under the pointer,
  and the source row is virtualized and can unmount mid-drag. Nothing on the
  path may `stopPropagation` — the session's window listener tears the drag down
  on the same `pointerup` the target dropped on, after it. What the webview was
  giving away for free and now has to be written: recognition past
  `DRAG_THRESHOLD_PX` (on `Math.hypot`, because a row drag is vertical for a
  reorder and horizontal for the sidebar), swallowing the `click` that follows a
  `pointerup`, `pointercancel` and Escape, and edge auto-scroll.
- There is no HTML5 drag and drop in the window at all, in either direction:
  since phase 85a `dragDropEnabled` is on and the webview's own drop target is
  revoked. An in-app drag is a pointer gesture; an OS drop is the native event.
- The tag editor's square shows a pending replacement from `cover://staged`,
  not from the library — it has no hash until it is saved. The URL carries a
  counter because the staging file's name never changes; a pending *removal*
  keeps showing the art it is about to take away, and the caption is what says
  it is going.
- The release lookup previews a fetched cover from the *same* `cover://staged`
  route, so there is one staging file and one preview mechanism rather than
  two. It passes the release id where the editor passes a counter — one cover
  is staged per release, so the id already names the bytes.
- **The release lookup is a queue, not a dialog.** A selection is grouped into
  releases in SQLite before anything leaves the machine, and the dialog works
  through them one at a time — search, pick, confirm, apply, next — because
  MusicBrainz allows one request a second and a folder-wide selection is dozens
  of releases. Each release applies as its own batch.
- It is mounted unconditionally in `App`, like `TaskProgress`: it subscribes on
  its own behalf and draws nothing until it is opened, so a dialog `App` does
  not own costs `App` no render.
- **It is a fixed box, because a queue reuses it.** `advance` re-enters at
  `stage: "opening"` with no tracks, so a dialog sized by its contents collapsed
  to its shortest state and grew back on every Skip — 270px each way, under the
  pointer still resting on Skip. `.dialog.lookup` states `height: min(720px,
  86vh)`, which is the tallest state it ever reached, so the largest step is
  unchanged and only the short ones grow. Both rows of confirm actions are
  pinned; Back and Apply are not merged into the queue's row, because Skip
  Release discards and Apply writes.
- **The review queue is the same dialog on a different queue.** What the
  unattended pass would not write is a row in the sidebar under the playlists,
  and clicking it opens the lookup on a table of those releases, sorted by the
  score the pass decided on (`index: null` in the store). A row opens that
  release with the candidates the pass already found, so it lands on the
  results step rather than spending a rate-limited second and a half an entry.
  They are a cache: every result list carries Search again. Apply and Set Aside
  take the row out of the table and return to it, and the last one closes the
  dialog. Back to Queue means "not now" and leaves the row where it was. Set
  Aside is offered on that queue alone, because a selection's queue dies with
  the dialog.
- **A selection has no table.** It opens on its first release and Skip Release
  walks on, with "release N of M" in the title — the table is for four hundred
  scored releases, not for a handful the user just picked.
- **The table's Match is not the results' top percentage.** It is
  `release_lookup.score`, measured against the fetched tracklist with
  durations; the result list shows the search's scores without them. Its Tracks
  column is what explains a 97% in the queue: the pass also queues a release
  whose track count disagrees, and that cell turns `--danger`.
- **The readout at the foot of the sidebar is not `TaskProgress`.**
  `BackgroundTaskProgress` reads `task://progress`, stands for as long as its
  task runs, and prints a percentage to two decimals with an estimate — one
  whole percent of the lookup pass is eighty releases and the better part of
  half an hour, so a figure that does not move for half an hour reads as hung.
  `TaskProgress` sits on the content header, reads the two per-write channels,
  and reports on writes that finish in minutes. Different place, different
  lifetime, different shape. It also draws a last.fm import from the last.fm
  store, which subscribes to `lastfm://import` itself, because the import's
  own pane is in Settings and may well be closed.
- **`tags://progress` has two senders** — a tag save and a lookup's apply, each
  reporting in a dialog that is already on screen. Both stores subscribe to it
  separately and **both record only while their own write is in flight**: the
  lookup on `stage === "applying"`, the editor on its own `progress` being
  non-null, which `save` sets before it awaits. A store that took every event
  was left holding a readout the other dialog's write had set and it had
  nothing to clear, which is what disabled Save at "Saving…" for the rest of
  the session. The guard also drops the last event of a batch when it lands
  after the command's own reply — two messages over one bridge, in no fixed
  order. `tagsource`'s `stage` is what disables the lookup's Cancel and stops
  Escape closing it, so every route back off a release resets it: `close` and
  `toTable` both put it back to `"opening"` with `progress`, or an apply left
  the review queue's table with no way out. `TaskProgress` owns the
  subscription that fills the editor store and draws nothing from it:
  something mounted for the whole session has to subscribe, and doing it in
  the dialog would mean subscribing as the write it reports on is already
  starting.
- OS file drops arrive as one window-wide event and are routed by
  `shell/fileDrop.ts`: targets register an element while they are mounted, the
  position is divided by `devicePixelRatio` to reach CSS pixels, and the hit is
  a rect test. `over` fires on every pointer move, so a target hears the hover
  only when it changes. A target outlines itself while a drag is over it —
  `dragDropEnabled` makes the cursor read "copy" over the whole window, so
  nothing else says where a file would land. The registry is a **stack**, hit
  tested from the top down: `.content` is registered for the window's whole life
  by `library/libraryDrop.ts`, and the tag editor's artwork block joins it while
  the dialog is open, so the dialog wins where the two overlap.
- **The library pane's drop holds no React state.** `useLibraryDrop` returns a
  ref and toggles a class on the element: the alternative is a render of the
  view with 150k rows in it, for every pointer crossing.
- Shortcuts live in `features/player/shortcuts.ts` and friends, and stand down
  when focus is in a text field. Media keys are additionally registered with the
  OS, one key at a time.
- **A greyed menu entry says what would un-grey it.** `MenuItem.hint` is a few
  words in the trailing column a menu elsewhere gives a shortcut, and the item
  carries an explicit `aria-label` because an accessible name is the plain
  concatenation of its text nodes — without one, Love with a hint is announced
  as "LoveNeeds a last.fm account".
- **Love is one hook, two menus.** `useLoveEntry` gives the right-click menu and
  the Edit menu the same answer, subscribed rather than read once: a menu opened
  after a love has to say Unlove, and `getState()` would leave the bar one press
  behind. The store holds the loved set whole, because `rowMenuItems` is pure
  and synchronous and a round trip per row under the pointer is not that. The
  set moves optimistically and is replaced by what the backend answers with —
  two library rows can share one match key, so loving either loves both.
- **A row the table no longer caches counts as loveable.** A selection outlives
  the pages behind it, and greying the entry because a page was evicted would
  make the menu's answer depend on how far the user has scrolled; the backend
  refuses an untaggable selection whole and says so.
- **The row menu's keyboard route synthesizes a `contextmenu` event** rather
  than opening the menu directly, because `ContextMenu.Trigger` derives the
  position from that event and the row's own handler decides which rows the
  menu acts on. Both would otherwise be duplicated, and the duplicate is what
  drifts.
- **Back and forward are `pointerdown`, not `auxclick`.** Windows fires mouse
  buttons 3 and 4 through both, and by the time the click arrives the browser
  has already decided nothing happened. The side buttons navigate from inside
  the search box; Alt+←/→ stand down there like every other shortcut.
- **Alt+Arrow nudges a selection within a playlist.** Bare arrows are seek and
  volume, and `shortcutFor` drops any key pressed with a modifier — so an Alt
  chord cannot collide with them by construction. A scattered selection is
  refused rather than collapsed into a block the way a drop would: a drop shows
  where it is going first, a nudge does not, and a reorder has no undo.
