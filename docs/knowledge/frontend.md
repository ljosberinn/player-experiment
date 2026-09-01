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
- `ROW_HEIGHT` lives in `SongTable.tsx`, where the virtualizer reads it — a CSS
  copy would be a second number to keep in step. Change one, change both.
- `headerBounds()` queries `th[data-column]`: the status column has no id and
  counting it offsets every drag-to-reorder drop index.
- **Double-clicking a divider fits the column to the rows on screen**, measured
  with a `Range` over each cell's contents — the cells clip with `ellipsis`, and
  a clipped element's `scrollWidth` omits the padding on the overflowing side.
  Visible rows only: the widest value in a 150k-row column is neither in the DOM
  nor cheap to ask for, so fitting is deliberately not idempotent.

## The browse views

- Albums is a grid, artists and genres are lists, and both are virtualized **by
  row**: the column count comes from the container width, so the two are
  computed together.
- The width is measured into state through a `ResizeObserver`. A ref read during
  render is whatever the last commit left there, which is how the grid came to
  be fixed at its first measurement.
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

**File splitting delivers nothing here; a component boundary does.**
`memo(SongTable)` was deliberately not taken — the table subscribes to the
selection itself, so the one frequent update re-renders it regardless, and no
memo can stop a component's own subscription from waking it. React Compiler
does not change that argument, it only removes the alternative: a child whose
props did not change is held still without anyone writing `memo`, and a
component that reads a fast-changing value itself is beyond either.

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
  the read are separate functions.
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
