# Frontend

React 19 + TypeScript + Vite, Zustand stores, TanStack Virtual, Base UI for
menus, dialogs, sliders, tabs and toolbars. No CSS framework: `src/App.css`
holds tokens, density and the native-feel rules, and Base UI parts are handed
classes that already exist.

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

- Albums is a grid, artists and genres are lists, and both are virtualized **by
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
- **A drill-in that lands empty ejects to the group list**, from inside
  `refresh()` itself so a group emptied by a tag edit, a missing file or a
  rescan is covered the same way. Only when there is no active search — one
  that legitimately matches nothing must not eject — and only once the query
  has actually landed. The dead entry is dropped from history rather than
  pushed over, the way `forgetPlaylist` drops a deleted playlist's, so Back and
  Forward cannot land back on it.

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
`drop` rather than the drop index — passed raw, one dragover would invalidate
every row in the window instead of the one under the pointer. The handlers
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

### React Compiler

Enabled in `vite.config.ts` through `@vitejs/plugin-react`'s own oxc port, over
every component and hook. Vitest shares that config, so the unit run and the
build compile the same code.

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
    `.window-buttons` in `App.css`). Those are the OS glyphs; a library X in the
    corner of a Windows title bar reads as a web page.
- No hover backgrounds, except window caption buttons and menu items.
- No transitions or animations, except the playing-row speaker, which **is** the
  state — and it stands down under `prefers-reduced-motion`.
- `cursor: default` everywhere but text fields. No focus ring on click
  (`:focus-visible` only). `overscroll-behavior: none`.
- Selection stays tinted, dimmed, when the window loses focus.
- The webview context menu is suppressed outside text fields by one
  document-level listener. Text inputs keep theirs — Cut/Copy/Paste and the IME
  entries are real functionality.
- The three `<select>`s stay native: a native select opens a real OS popup,
  which is closer to native than any listbox.
- A drag badge ("7 songs") replaces the browser's translucent row screenshot.
  It is built off-screen, not hidden — `display: none` and `visibility: hidden`
  both make an element unrasterizable.

## Chrome and state

- `features/library/store.ts` owns the view (tab, search, sort, selection,
  stats); `features/player/store.ts` owns playback; `features/shell` owns the
  window (geometry, zoom, menus, dynamic background).
- **There is one invalidation channel.** The library and playlists stores each
  `watch()` `library://changed` and reload their own contents, debounced by
  `INVALIDATE_DEBOUNCE_MS`. A mutation does not reach across stores to say what
  it invalidated — that was fifteen `useLibraryStore.getState()` calls outside
  the library store, each with its own "is this the playlist on screen" guard,
  and every new mutation was another chance to forget one silently. What stays
  is navigation and selection, which no event can express: leaving a playlist
  before it is deleted, opening a smart playlist that was just created,
  clearing a selection whose rows are gone. Those run synchronously in the
  action, so the debounced reload always lands after them. `create` and
  `createFrom` also keep a direct `load()`, because the row they put into
  inline rename has to be on screen for the input to open.
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
  `loadSections`, `toggleSection`, `refreshUndo` and `getAppInfo` keep their
  bare `catch`.
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
- Drag payloads travel under a private MIME type, so a row cannot be dropped
  into a text field. `dragover` sees only the *types*, which is why the check and
  the read are separate functions — and why the tag editor's artwork decides
  from those alone that a drag is a file and not a song.
- The tag editor's square shows a pending replacement from `cover://staged`,
  not from the library — it has no hash until it is saved. The URL carries a
  counter because the staging file's name never changes; a pending *removal*
  keeps showing the art it is about to take away, and the caption is what says
  it is going.
- `useNativeFeel` swallows any drag the app did not claim. A file dropped where
  nothing handles it is *opened* by the webview, which navigates the window away
  from the app; the guard runs at the window, skips anything a target already
  called `preventDefault` on, and sets `dropEffect = "none"` so the pointer
  still reads honestly outside a target.
- Shortcuts live in `features/player/shortcuts.ts` and friends, and stand down
  when focus is in a text field. Media keys are additionally registered with the
  OS, one key at a time.
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
