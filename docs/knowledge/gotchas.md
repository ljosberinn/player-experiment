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
- **`dragDropEnabled` kills HTML5 drag and drop**, and since phase 85a it is
  **on and has to stay on**: `wry` revokes the WebView2 drop target rather than
  intercepting it, so there is no `dragover` or `drop` inside the window at all
  and no HTML5 drop target may be reintroduced anywhere. It cannot be toggled at
  runtime in Tauri v2 — the flag is fixed at window creation. The handler's
  return value is documented as a way to let the page have the drop too; on
  Windows `wry` discards it (`src/webview2/drag_drop.rs`). The same file answers
  `DROPEFFECT_COPY` for any file drag, so the cursor reads "copy" over the whole
  window whether or not anything under it takes a drop — a target has to say so
  itself.
- **Raw bytes over IPC are all-or-nothing.** Tauri sends an `invoke` payload as
  a raw body only when the *whole* payload is an `ArrayBuffer` or a view of one;
  a `Uint8Array` inside an args object is JSON, one number per byte. Wrapping it
  typechecks and passes every mocked test — `invoke("command", bytes)`, never
  `invoke("command", { bytes })`. The command reads it as `tauri::ipc::Request`,
  whose body is `Raw` or `Json`. Nothing uses this today: the one caller was the
  artwork drop, which carries a path since phase 85a.
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
- **Group on a folded key and no row carries the label any more.** `GROUP BY
  album COLLATE NOCASE` still lets you select a bare `album`, and SQLite hands
  back whichever row it happened to be on. Aggregate it — `min(album)` — or the
  label, and any React key built from it, changes between renders. Whatever
  filters on that label needs the same collation, or it selects the tracks of
  one casing only.
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
  scrollbar lie. Three exceptions a scripted pass gets wrong: a border-trick
  triangle is a shape and scales; a `transform-origin` on an SVG child is in
  `viewBox` units and does not; and a sum (a tile around its cover, a knob
  inside its switch) is re-derived from its scaled parts, since rounding does
  not distribute. Sizes passed inline from TSX (`ROW_HEIGHT`, `<Icon size>`, a
  `ProgressBar` width) are not in any stylesheet.
- `oklch` steps are not binary-representable: round to one decimal or a label
  reads 100% while the value is 0.9999999999999999.
- **A contrast ratio between two tokens is not the ratio on screen.** The chrome
  is a veil, so what is behind a control in the transport is `--strip-veil`
  composited onto `--surface`, which no token names. Three phase-108 defects
  cleared the token pairs and failed in the engine. Flatten the stack —
  `App.css.test.ts` and `e2e/contrast.ts` share the arithmetic.
- **A mid-lightness accent cannot carry a mark on a light ground.** The design's
  `#e8730f` peaks at 3.05:1 against pure white, so it fails WCAG 1.4.11 on every
  surface there. A light theme generally needs two weights of the accent: the
  brand colour for washes, a darker step for anything with a threshold.

## WebDriver and WebView2

- **`selectByAttribute` does not drive a native `<select>`.** A closed select
  renders its option list as an OS popup rather than as DOM boxes, so clicking
  the `<option>` hits nothing and the value never moves — green locally under
  jsdom, a timeout in CI. Historical as of phase 111: the app has no native
  select left, and a drawn one's list is DOM, so it is clicked like anything
  else. Kept because the failure mode is the general one — a control the OS
  draws is invisible to the driver — and the next one will look the same.
- **A driver will not click a transparent element.** The drawn checkbox and
  radio leave the real input at `opacity: 0` over the mark, and `isDisplayed`
  counts that as hidden. Read state off the input (`isSelected`, `toBeEnabled`
  — none of those need it interactable) and click the `.checkbox-box` beside
  it, or the `<label for>` that names it.
- **A cleanup helper that only knows one dialog's way out poisons the suite.**
  `closeDialog` clicked Cancel; Settings says Done. One failing test left its
  dialog standing and three later tests measured it instead of their own — four
  reported failures for one real defect.

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

## Tag writing

**lofty reads the MusicBrainz release ids but will not write them.** Its
`Tag`-to-`Id3v2Tag` conversion (0.25, `id3/v2/tag/conversion.rs`) has an arm for
`MusicBrainzArtistId` and its siblings and none for `MusicBrainzReleaseId` or
`MusicBrainzReleaseGroupId`, and its fallback only handles four-character frame
ids — so `insert_text` with either key is discarded on save, without an error.
Reading is unaffected, since TXXX frames map back to an `ItemKey` by
description. `write::save_tag` puts both back as TXXX frames after the
conversion. It also has to re-add ids the *file* already had, because they take
the same path out.

**"failed to write Mpeg file" names the format and nothing else.** lofty's
`FileEncodingError` prints only the `FileType`, so a full disk (OS error 112), a
file another process holds open (32) and a frame it cannot encode all reach the
user as the same sentence; everything that distinguishes them is in `source()`.
`write::causes` walks the chain and `write::os_code` pulls the number out, and
`apply` hands one `Fields` per failed file back to the command layer, which
writes it as a `tags.write.fail` line. Nothing reaches that line from the
unattended pass, which discards its failures.

**lofty will read a date it cannot write back.** An out-of-range `TDRC` or
`TDOR` — `2012-13`, `2012-06-45`, anything past hour 23 or minute 59 — parses
without complaint and is then refused by `Timestamp::verify` on the way out, so
a file some other tagger wrote can never be edited again. Worse, the frame rides
in the `Tag`'s *companion* rather than in its items: `mutate` cannot see it,
`remove_key(ItemKey::RecordingDate)` does not remove it, and clearing Year in
the editor does not rescue the file. `write::shape` reports such frames as
`dates=TDRC=2012-13` so the log says which value it was. Month `00` and day `00`
are fine, as are `20120603` and a space instead of the `T`.

**A `COMM` language is read as three raw bytes and written as three ASCII
letters.** `LanguageFrame::parse` takes whatever is in those bytes; only
`as_bytes` insists they be `a-zA-Z`, so a `COMM` or `USLT` frame carrying
something else — `\0\0\xB0` came out of a real library — is refused on the way
out and every later save of that file fails, whatever the edit was about. Unlike
the dates above, the language rides on the `TagItem` rather than in the
companion, so it survives the split and merge and comes back unchanged even when
the edit never mentioned the comment. `write::repair_languages` rewrites an
unusable one to `XXX` before the save; the comment text itself is untouched.

**lofty keeps the unsynchronisation flags it read but never unsynchronises on
write.** A v2.4 header flag `0x80` (and a frame's `0x0002`) survives the split
and merge in the companion, and every frame body goes out raw, so the next read
strips each `00` after an `FF` — every escaped marker in a JPEG — and the cover
decodes gray below its first rows. Any save does it, not just a cover change, as
long as the tag has a frame the companion keeps. `write::drop_unsynchronisation`
clears both flags before the save.

## Moving files

**A tombstone is a hazard at the target, not at the source.** `scan::plan` skips
an on-disk path in `removed_paths` *before* it marks the path seen, so a known
row whose path is tombstoned is marked missing on every scan, forever. That
cannot happen through `remove_tracks`, which deletes the row it tombstones — but
it can the moment a file lands on a path the user once removed a different file
from, so `library::mover` deletes the tombstone for every target it writes.

**`std::fs::rename` fails across volumes** with `ERROR_NOT_SAME_DEVICE` (17) and
no other signal; the fallback is copy, compare the size, delete the source.
Nothing on a CI runner can produce a second volume, so the error is injected
through the `Rename` seam instead.

**`std::fs::canonicalize` answers with more than the real spelling.** It returns
a `\\?\` path, with 8.3 short names expanded and junctions and symlinks
followed, so its answer is not interchangeable with the path it was given —
`%TEMP%` on a GitHub runner is enough to make the two differ. Use it to read how
the filesystem spells what was just written, then put that back under the path
the caller gave; never store it whole.

## Colour extraction

Median cut splits a box at its median **pixel**, so an album cover that is 70%
near-black spends two of three boxes on near-black and averages everything bright
into the third. `palette.rs` splits at the midpoint of the widest channel's
**range** instead — darks one side, accents the other. Boxes are ordered by pixel
count afterwards, so the dominant colour still comes first.

The background blob layer is far larger than the window, so a percentage offset
is a percentage *of the layer* and lands somewhere else. Positions are expressed
as offsets from the window centre (`calc(50% - 28vw)`).

## MusicBrainz

**`inc` is not accepted on a search**, so a release costs two requests — one to
find candidates, one to read the tracklist of whichever was picked — and there
is no arrangement of parameters that makes it cost one.

**The `inc` value is sent with spaces, not with `+`.** Form encoding turns a
space into `+`, so the request that goes out is the canonical
`inc=recordings+artist-credits+release-groups`. Writing the `+` in the value
would encode it as `%2B`.

**`reqwest`'s `RequestBuilder::query` is behind a feature** in 0.13 — named
`query`, and off in the default set. Without it the call does not exist and the
error reads as a missing method rather than a missing feature.

**A track's `number` is a string and its `position` is not.** On a vinyl release
`number` is `"A1"`, so the integer track number this app writes comes from
`position`.

**The rate limit is enforced at the IP address**, and exceeding it gets the
address blocked rather than throttled. `tagsource::rate::shared` is therefore
process-wide: a limiter owned by a client instance would let two callers make
two requests a second between them, each believing it was the only one.
