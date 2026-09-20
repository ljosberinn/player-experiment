# Design

The app's layout began as an echo of iTunes 11 and moved onto a design of its own
in phases 32–39. The product is **Apex**; the identifier is `dev.ljosberinn.apex`.

**The source is two Claude Design projects**, read with DesignSync `get_file`
rather than WebFetch — the `/design/p/` URL returns 403 to a fetch. A gitignored
mirror of both, plus the Modernist token sheet they are built on, sits in
[`design/`](../../design/README.md); it is a copy to read and diff against, and
the remote stays canonical.

- "Modern music player design", `Apex Music Player.dc.html` — sidebar
  navigation, a transport strip, a row context menu, a smart-playlist rule
  builder, a settings dialog and a mockup of the crash dialog, at 1440×900.
  **What the app is built from today.**
- "Apex music player component library" (`e08e15f9-0d0f-4761-8efd-01bfa268fffc`),
  `Apex Components.dc.html` — a specimen sheet of primitives on a light and a
  dark ground, added 20.9.2026. **What the app is moving to**, one phase at a
  time; see [plans/apex-components.md](../plans/apex-components.md). It does not
  draw the sidebar, the transport strip, the playlist tree or the release grid,
  so the shell stays with the older file until it does.

Re-fetch before relying on either; both have been amended (the contrast lift,
the removal of the accent row border) and can be again. Reproduce the details
they specify, not only the structure.

The component sheet settles four things the tokens below do not yet reflect:
**Archivo** as the one face (study 7a, chosen over three alternatives), accent
`#e8730f` light and `#f58a1f` dark, **radius 0 everywhere**, and a **light
ground that ships** alongside the dark one.

Where the design and the built app disagree on a detail the design has not
thought about, the app wins. Where they disagree on how something *looks*, the
design wins.

## What the mockup is not

- **Its table is a CSS grid with fixed tracks.** Ours is virtualized over 150k
  rows with resizable, reorderable, hideable columns. The look transfers; the
  markup does not.
- **Its 22 songs are in memory**, so every count is `array.length`. Ours come
  from `COUNT(*)`, which makes a sidebar count a question of *when to recompute*.
- **It has no missing files and no scan in progress.** Those
  states have no mockup; their placement was decided in the phases that built
  them.
- **It calls the second library item Albums.** Ours says Releases: an EP, a
  single, a split and a compilation all live in that view and none of them is an
  album. A deliberate departure, not a drift to correct on the next re-fetch.

## Tokens

Dark only, one hue (55, warm orange-brown), everything in `oklch`. A second
ground arrives with [issue 108](../issues/upcoming/108-two-grounds.md), which is
what the indirection below was kept for.

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
- **Under the playlists, when there is anything in it: Needs Review**, one row
  with a count beside it like a playlist's. It is absent otherwise — a row
  reading nought for the months before the unattended pass has queued anything
  is a permanent reminder of a feature with nothing to say.
- **At the foot of the sidebar, a line for a task measured in days**, in the
  space the design leaves empty. Absent unless one is running.
- **The Songs view has no title header.** Releases, Artists and Genres keep the
  heading and its accent underline; the view with 150k rows cannot spend a third
  of the fold on the word "Songs".
- A 27px translucent status bar: zoom stepper left, view summary centred, version
  right.
- **Settings is a rail and a pane**, at one size whichever category is open:
  Appearance (Interface Zoom, Colour From Album Art), Library (Library Folder,
  Music Folders), Online (Look Up Releases Online, last.fm) and About (Activity
  Log). The rail items wear the sidebar's navigation look. Issue 91 built it on
  the app's tokens while the design could not be fetched, so the design's own
  settings dialog wants re-fetching and amending to match.
