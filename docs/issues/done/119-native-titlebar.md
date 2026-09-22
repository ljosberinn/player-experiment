# 119 — Native titlebar

The component sheet's foundation table, beside Type, Accent, Geometry and
Feedback: "Native OS titlebar assumed. App menus live in the content area, so
nothing here draws window buttons."

The shell's own file does not contradict it. `apex-music-player.dc.html` draws
the window buttons behind an `sc-if` toggle — `showWinButtons`, default true,
`showMacDots` beside it — so the frame is a parameter there and a decision in
the component sheet. Turn the toggle off and what the file still draws is the
36px bar carrying the mark, the wordmark, the menus and the version.

So this is not a bar being deleted. `decorations: false` goes, the OS draws the
frame, and the bar stops being a title bar: no window buttons, no drag region,
no double-click-to-maximize. What is left is the app's own bar, and it is
called that — `TitleBar` → `AppBar`, `.titlebar*` → `.appbar*`. A component
named for a job it no longer does is the defect this rename exists to avoid.

`.app::before`, the 3px accent strip, is already the first child of `.app` and
needs no change: the top of the webview is where it was and where it stays.

## What moves

- `decorations: false` out of `tauri.conf.json`.
- `"decorations": true` out of `tauri.wdio.conf.json`, now the default. The
  rest of that file's `windows` array stays: Tauri replaces arrays rather than
  merging them by label, so it restates the window deliberately, and omitting
  `visible: false` is what keeps the harness window up from launch.
- `WindowButtons`, `onMouseDown`, the `biome-ignore` and `data-testid` out of
  the component. `.window-buttons` out of `app.css` and out of `HOVER_ALLOWED`.
- `.titlebar-right` goes with them. Its reason was that two `margin-left: auto`
  items would share the free space; with the buttons gone there is one item,
  and the version takes the margin itself.

## What does not move

The version stays on the bar. The design draws it there, `.titlebar-version` is
in the tabular-nums guard, and the footer's third column belongs to
`.statusbar-update`. `.statusbar-version` is dead CSS with no renderer since
phase 34 — delete it, and the `.statusbar-update` comment that still claims to
replace it.

The OS title becomes visible, and keeps the song. `windowTitle()` already says
`Apex — <title> — <artist>`, which is what a native frame is for. Three
comments and `frontend.md` assert it is invisible; they are what changes.

## What it costs

- Six `TitleBar` tests in `chrome.test.tsx` — drag, double click, the three
  buttons — have nothing left to drive.
- `App.css.test.ts` loses "lets the caption buttons paint over the title bar's
  own separator" entirely. The 36px height assertion stays.
- `appearance.test.ts` keeps all three of its bar specs on their values; only
  the selectors change, and the `.titlebar-right` unwrapping branch in "keeps
  the whole title bar on one row" comes out with the wrapper.

## What it settles

`testing.md` lists the frameless window, the custom title bar and the drag
region under **Uncovered on purpose**, because the e2e build pins
`decorations: true` or the embedded driver never sees the webview. That gap
closes: every screenshot CI has ever taken already had the native frame on it,
and now so does what ships. `limitations.md` loses the same entry.

Watch the first run for one thing only: `e2e/viewport.ts` converges on the
*inner* viewport by difference, so it should absorb the unchanged
window-to-viewport delta without a correction. It has never run against any
other frame, so this is confirmation rather than a risk.

Independent of the rest of the sequence. Its own worktree.

Part of the [component library sweep](../../plans/apex-components.md).
