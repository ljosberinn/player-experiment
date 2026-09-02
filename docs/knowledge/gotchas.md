# Gotchas

Each of these cost real time once. They are here so they cost it once.

## Tauri

- **Every built-in API is ACL-gated** by `src-tauri/capabilities/default.json`.
  A missing entry typechecks, passes its mocked tests, and fails in the packaged
  app with *"command plugin:dialog|save not allowed by ACL"*. Four holes have
  shipped this way: `dialog:allow-save`, `setPosition`/`setSize`, `maximize`, and
  the global-shortcut pair. `core:default` grants the window *reads*, not the
  writes. `src/ipc/capabilities.test.ts` is the guard — add a row and prove it
  red before trusting it.
- **`tauri-plugin-global-shortcut` grants nothing by default.** Its `default`
  permission set is empty on purpose; list `allow-register` and
  `allow-unregister` explicitly. Register one key at a time — the array form is
  all-or-nothing, so one key held by another app costs the rest. A failed
  registration is not an error, and only keys actually claimed get released.
  Never register Space or the arrows: a global shortcut is exclusive and would
  break them in every other application.
- **`dragDropEnabled` must stay `false`.** While true the webview hands OS drag
  events to the native file-drop handler instead of the page, which kills HTML5
  drag and drop inside the window on Windows. It cannot be toggled at runtime in
  Tauri v2 — the flag is fixed at window creation.
- **Raw bytes over IPC are all-or-nothing.** Tauri sends an `invoke` payload as
  a raw body only when the *whole* payload is an `ArrayBuffer` or a view of one;
  a `Uint8Array` inside an args object is JSON, one number per byte. Wrapping it
  typechecks and passes every mocked test —
  `invoke("stage_dropped_cover", bytes)`, never `{ bytes }`. The command reads
  it as `tauri::ipc::Request`, whose body is `Raw` or `Json`.
- **The CSP has to name the IPC protocol** — `connect-src ipc: http://ipc.localhost`.
  Tauri only ever rewrites `script-src` and `style-src`, so a bare
  `default-src 'self'` blocks the `fetch` that carries an invoke. The failure is
  silent: `ipc-protocol.js` catches it once and falls back to
  `window.ipc.postMessage` for the rest of the session, which JSON-serializes
  everything — so every command keeps working and only a raw body arrives
  wrong. Invisible in dev too, where the page is served by Vite and Tauri sets
  no CSP header at all.
- **`startDragging` swallows the second click**, so a `dblclick` never arrives on
  a bar that also drags. Both gestures live in one `mousedown` handler keyed off
  `event.detail === 2`. jsdom delivers a synthetic `dblclick` happily, which is
  why the dead handler passed its test.
- **Show in Explorer needs `raw_arg`.** `Command::arg` applies C-runtime quoting
  and wraps `/select,C:\My Music\a.mp3` as one argument; Explorer parses its own
  command line, cannot read that, and answers by opening Documents. Verify by
  running both forms through `cmd /c echo`, not by asserting on the arg vector.

## SQLite

- `sum()` over no rows is **NULL**, not 0 — `coalesce` or an empty library fails
  to decode.
- A bound NULL equals nothing: use `IS ?` rather than `= ?` for a grouping key
  that may be null. `=` returns an empty view, dropping the clause returns the
  whole library, and both look like they worked.
- `NULL <> 'x'` is NULL, so every exclusion operator needs `(col IS NULL OR …)`.
- Escape `%`, `_` and the escape character in `LIKE` patterns.

## jsdom and component tests

- **No stylesheet, no layout.** Every rect is zero and every colour is
  unresolved; a virtualizer "renders" whatever the mock decided. Appearance
  belongs in the e2e contrast suite.
- **No `PointerEvent`.** `fireEvent.pointerMove(el, {clientX})` delivers `null`
  and every pointer-driven component looks broken while being correct in a
  browser. The test setup installs a `MouseEvent` subclass.
- **No `ResizeObserver`.** The setup file installs an inert one — a component
  that measures its container throws on mount without it. A test that wants a
  resize stubs the size and fires the callback itself; pass an empty array, or
  `@tanstack/virtual-core`'s own observer reads `entries[0]` of `undefined`.
- **No `Range.getBoundingClientRect`.** jsdom declares none at all, so it cannot
  even be spied on. The setup file installs one returning zeros; a test with an
  opinion about a measured width stubs it.
- Base UI portals to `document.body` — query through `screen`, not the container.

## CSS

- Grid auto-placement only moves **forward**. A child explicitly assigned to
  column 1 after one sitting in column 2 starts a new row. Every status-bar child
  pins `grid-row: 1`, and a guard requires it.
- `<hr>` keeps the browser default `border: 1px inset`, which draws a second
  brighter line and reserves space around it.
- A submenu is `position: absolute` and resolves against the nearest *positioned*
  ancestor — without `position: relative` on its row it opens at the panel top.
- A fixed-height box beats a `min-height` where the content can grow: the status
  display shoved the toolbar down when playback started.
- Scaling density by a factor: leave borders, radii and shadows alone. A 1.2px
  hairline is a blurry hairline. And move the virtualizer's constants with the
  CSS — a row that grows while the estimate does not makes rows overlap and the
  scrollbar lie.
- `oklch` steps are not binary-representable: round to one decimal or a label
  reads 100% while the value is 0.9999999999999999.

## Toolchain

- **release-please vs Biome**: release-please re-serializes whole JSON files with
  its own printer. The two files it rewrites are excluded from the formatter.
- **The wdio plugin has two halves.** The cargo plugin without
  `import '@wdio/tauri-plugin'` and `app.withGlobalTauri` costs 5 seconds per
  WebDriver command — a `WARN` the suite continues past, with everything green.
  A passing suite can hide a broken assumption; only the wall clock showed it.
- **The `@wdio/native-utils` override is gone** (phase 42).
  `@wdio/tauri-service@1.2.0` pinned 2.4.0 and imported a symbol only 2.5.0 had,
  so an `overrides` entry forced 2.5.0; 1.3.0 pins 2.6.0 itself and the override
  now only holds the tree back.
- **`@wdio/tauri-service` pins `@wdio/globals` exactly**, so raising the root
  floor past that pin is an `ERESOLVE`, not a resolution. Since 1.3.0 pins
  9.29.1 while `@wdio/local-runner@9.31.x` wants 9.31.1, the two coexist as
  separate copies and the root floor stays where the service put it.
- **The driver swallows Shift+F10 as well.** F10 activates a window menu on
  Windows and never reaches the webview, so `browser.keys(["Shift", "F10"])`
  produces no keydown at all - the same class of gap as `contextmenu` and
  `dblclick`, with the same remedy: dispatch the event the page listens for.
  Found by a CI run, because the assertion passes locally in jsdom.
- A Python here-doc turning `\b` into a literal backspace made a guard match
  nothing and pass vacuously. Prove a new guard red.

## Colour extraction

Median cut splits a box at its median **pixel**, so an album cover that is 70%
near-black spends two of three boxes on near-black and averages everything bright
into the third. `palette.rs` splits at the midpoint of the widest channel's
**range** instead — darks one side, accents the other. Boxes are ordered by pixel
count afterwards, so the dominant colour still comes first.

The background blob layer is far larger than the window, so a percentage offset
is a percentage *of the layer* and lands somewhere else. Positions are expressed
as offsets from the window centre (`calc(50% - 28vw)`).
