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

## Where a subscription lives is the perf lever

`positionMs` (4/s), `volume` (per pointer move) and `searchInput` (per keystroke)
each re-rendered the whole tree while read at the top of `App`. Each moved into a
component that subscribes on its own behalf — `NowPlayingStatus`,
`PlayerTransport`, `SearchBox`. `App.renders.test.tsx` counts renders, because a
count is exact where a wall-clock budget on a CI runner is noise.

**File splitting delivers nothing here; a component boundary does.**
`memo(SongTable)` was deliberately not taken — the table subscribes to the
selection itself, so the one frequent update re-renders it regardless.

## Native feel

The app must not read as a web page in a window. Enforced by absence, and
absences are what nobody notices coming back — hence the guards in
`App.css.test.ts` (see [testing](testing.md)).

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
- **Alt+Arrow nudges a selection within a playlist.** Bare arrows are seek and
  volume, and `shortcutFor` drops any key pressed with a modifier — so an Alt
  chord cannot collide with them by construction. A scattered selection is
  refused rather than collapsed into a block the way a drop would: a drop shows
  where it is going first, a nudge does not, and a reorder has no undo.
