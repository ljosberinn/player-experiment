# Design

The app's layout began as an echo of iTunes 11 and moved onto a design of its own
in phases 32–39. The product is **Apex**; the identifier is `dev.ljosberinn.apex`.

**The source is a Claude Design project**, "Modern music player design", whose
single component is `Apex Music Player.dc.html` — sidebar navigation, a transport
strip, a row context menu, a smart-playlist rule builder, a settings dialog and a
mockup of the crash dialog, at 1440×900. Re-fetch it before relying on it; it has
been amended (the contrast lift, the removal of the accent row border) and can be
again. Reproduce the details it specifies, not only the structure.

Where the design and the built app disagree on a detail the design has not
thought about, the app wins. Where they disagree on how something *looks*, the
design wins.

## What the mockup is not

- **Its table is a CSS grid with fixed tracks.** Ours is virtualized over 150k
  rows with resizable, reorderable, hideable columns. The look transfers; the
  markup does not.
- **Its 22 songs are in memory**, so every count is `array.length`. Ours come
  from `COUNT(*)`, which makes a sidebar count a question of *when to recompute*.
- **It has no missing files, no scan in progress and nothing to undo.** Those
  states have no mockup; their placement was decided in the phases that built
  them.
- **It calls the second library item Albums.** Ours says Releases: an EP, a
  single, a split and a compilation all live in that view and none of them is an
  album. A deliberate departure, not a drift to correct on the next re-fetch.

## Tokens

Dark only, one hue (55, warm orange-brown), everything in `oklch`.

| Token | Value | Used for |
| --- | --- | --- |
| `--accent` | `oklch(0.72 0.16 55)` | play button, selection tint, active nav, focus |
| `--surface-0` | `oklch(0.09 0.004 55)` | the page behind the window |
| `--surface-1` | `oklch(0.14 0.008 55)` | sidebar |
| `--surface-2` | `oklch(0.15 0.008 55)` | transport strip, dialogs |
| `--surface-3` | `oklch(0.17 0.008 55)` | content |
| `--text` | `oklch(0.94 0.005 55)` | body |
| `--text-dim` | `oklch(0.72 0.01 55)` | secondary columns, section headings |
| `--hairline` | `oklch(1 0 0 / 0.06)` | every border |

Light is not shipped, but the **indirection is kept**: no literal colour outside
the token block, so restoring a light theme is one more block of definitions
rather than an audit of six hundred rules. Dim text sits at `0.72` because
`e2e/contrast.ts` requires 4.5:1 and the design was amended to meet it.

Chrome is translucent — `backdrop-filter: blur(18px)` over a surface at 55–70%
opacity — which is what makes the dynamic background visible through the sidebar
and transport rather than only behind the table.

**Space Grotesk** (via `@fontsource/space-grotesk`, weights 400 and 700) is the
numeral face: durations, the playhead, the backtrace block. Nothing is fetched
from a font CDN — the app is offline-first and the CSP forbids it.

## Layout

- A 36px title bar: the mark, the menus, the version, the window buttons. It
  keeps the drag and double-click-to-maximize behaviour and carries nothing else.
- A 78px transport strip: prev/play/next pill, playhead with elapsed and total,
  cover art and track text, mute and volume, repeat, search.
- The sidebar is the navigation — LIBRARY (Songs, Releases, Artists, Genres, and
  a dimmed Statistics placeholder), then collapsible SMART PLAYLISTS and PLAYLISTS
  sections with counts. There is no tab bar and no library toolbar.
- **The Songs view has no title header.** Releases, Artists and Genres keep the
  heading and its accent underline; the view with 150k rows cannot spend a third
  of the fold on the word "Songs".
- A 27px translucent status bar: zoom stepper left, view summary centred, version
  right.
