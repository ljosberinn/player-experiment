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

The component sheet settles four things. **Archivo** as the one face (study 7a,
chosen over three alternatives) is in, phase 107. The **two grounds** are in,
phase 108, which also re-based the dark palette onto the sheet's own column —
though the light accent had to be darkened to carry a mark at all, which is the
one place the sheet and WCAG disagree outright. **Radius 0 everywhere** is in,
phase 109.

Where the design and the built app disagree on a detail the design has not
thought about, the app wins. Where they disagree on how something *looks*, the
design wins.

**The app is drawn a size larger than the sheet**, since
[issue 129](../issues/done/129-everything-a-size-larger.md). Every length is the
sheet's ×1.1: type to the nearest half pixel below 20px (12.5→13.5, 13→14.5),
everything else to a whole pixel (36→40, 158→174). Hairlines, rules, focus
rings and shadows keep the sheet's widths, and a sum is re-derived from its
parts rather than scaled. The tables and measurements below are the sheet's, so
a re-fetch compares against them directly.

## What the mockup is not

- **Its table is a CSS grid with fixed tracks.** Ours is virtualized over 150k
  rows with resizable, reorderable, hideable columns. The look transfers; the
  markup does not.
- **Its 22 songs are in memory**, so every count is `array.length`. Ours come
  from `COUNT(*)`, which makes a sidebar count a question of *when to recompute*.
- **It has no missing files and no scan in progress.** Those
  states have no mockup; their placement was decided in the phases that built
  them.
- **Its menu names a shortcut the app does not have.** The specimen sheet draws
  `Ctrl+E` beside Show in Explorer; nothing listens for it. The column is drawn,
  with the two keystrokes that are real — `Ctrl+I` on Edit and `Del` on whichever
  removal Delete performs where the menu was opened. A menu that names a chord
  nothing answers is worse than one that names none.
- **It calls the second library item Albums.** Ours says Releases: an EP, a
  single, a split and a compilation all live in that view and none of them is an
  album. A deliberate departure, not a drift to correct on the next re-fetch.

## Tokens

**Two grounds, one set of names**, since [issue 108](../issues/done/108-two-grounds.md)
— which is what the indirection was kept for. Everything is in `oklch`, stated
from the component sheet's study 7a with the design's own hex in a comment
beside each; all of them round-trip to within 0.001 of oklab distance, far
inside a JND. `src/styles/tokens.css` holds three blocks: one shared (density
and type), one per ground.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--surface` | `#f3f2f2` | `#17140f` | the window and the content pane |
| `--sidebar` | `#e9e7e6` | `#100e0b` | the sidebar, which recedes on both |
| `--chrome` | `#f8f7f7` | `#1d1915` | transport strip, dialogs — forward on both |
| `--field` | `#e6e4e2` | `#221d17` | an inset control |
| `--text` | `#201e1d` | `#f0ece7` | body |
| `--muted` | `#696562`\* | `#948b81` | secondary columns, section headings |
| `--accent` | `#ab4c00`\* | `#f58a1f` | play button, active nav, focus, the playing marker |
| `--accent-tint` | `#e8730f` / .13 | `#f58a1f` / .17 | selection, highlight — the brand amber, as a wash |
| `--accent-hover` / `-active` | `#983c00`\* / `#862b00`\* | `#ffa040` / `#d97410` | a primary button under the pointer and under the press |
| `--accent-deep` | `#9d4000`\* | `#f58a1f` | the accent as a *label on one of its own washes* |
| `--chrome-border` | ink / .125 | white / .07 | every hairline |
| `--row-line` | ink / .065 | white / .026 | the line *between two rows of a list*, a step under the hairline that frames it |

The stack inverts rather than repeating: on dark, coming forward is lighter; on
light it is darker, and the sidebar is darker than the content on both. Which
ground is drawn is `data-theme` on `<html>`, written by `themeStore` before the
window is shown — **not** a `@media (prefers-color-scheme:)` block, which would
need a third copy of every dark value. `color-scheme` follows it, so scrollbars
follow too. Native popups no longer have to: phase 111 drew the last control
that opened one.

The departures from the sheet, all recorded in `tokens.css` beside the value.
The first is why most of the others exist:

- **`--accent` on light** is the largest. The sheet's `#e8730f` cannot carry
  contrast on a light ground at all: 2.73:1 on the content pane, 2.45:1 on the
  transport pill, and 3.05:1 against pure white, which is the ceiling — there is
  no surface here it can be drawn on. Every rule that reaches for `--accent`
  uses it in a role with a threshold (a fill, a focus ring, the playing marker,
  a link); the washes are their own tokens. So the brand amber stays as the
  wash it is good at, and `--accent` is a darker step of the same hue. Darker
  than the sheet's own `accent deep` `#b4550a`, which is 4.01:1 as text on the
  sidebar and still short of AA.
- **`--on-accent` on light** is white, following from the above: the ink that
  reads on the sheet's bright amber is 2.98:1 on the deeper one.
- **A primary button's states move the other way on light**, phase 110. The
  sheet lightens under the pointer and darkens under the press on both grounds;
  ours has no room above it — the sheet's own hover puts white at 4.43:1 — so
  light steps 0.055 of lightness *down* for hover and further down for the
  press. It is the inversion the surfaces already make, and the one the
  secondary and ghost kinds make anyway: their veils are ink here and white
  there.
- **`--accent-deep` on light** is a further step down again, for the accent
  drawn as *text on a wash of itself* — a ghost button's label, a
  selection-filled tag, a toggled icon button's glyph. A wash over a light
  ground moves the surface toward the ink on it, so the step that clears 4.5:1
  on the bare ground does not clear it on its own highlight; the design is not
  AA there either. Dark needs no such step and declares `--accent`'s own value
  under the name, so the rules can share one. The strongest of those washes is
  ours at 18% rather than the sheet's 22%, for the same reason.
- **`--muted` on light** is the sheet's `#6e6a67` darkened by 0.016 of
  lightness. The sheet's own value is 4.22:1 on its own field and fails AA; the
  amendment is under a JND and is the same one the design already took once for
  dim text.
- **`--dim` is gone**, folded into `--muted`. The re-based grounds put the
  sheet's muted close to the AA floor, so a third recessive step that is still
  AA cannot exist: on light the best it can do is L 0.515 against muted's 0.511.
  Two names for one colour is worse than one name.
- **`--field-border` is ours**, above the sheet's `line` (a 1.5:1 hairline). A
  field border at 1.02:1 shipped once; this is 2.3:1 on both grounds.

Chrome is translucent — `backdrop-filter: blur(18px)` over a surface — which is
what makes the dynamic background visible through the sidebar and transport
rather than only behind the table. **The opacities are ours; the sheet has no
opinion.** Light's are higher (0.80–0.86 against dark's 0.55–0.70) and its
`--blob-opacity` is half dark's, because a translucent panel over a blob moves
*toward* dark ink and *away* from light ink: the same blob costs a light ground
far more contrast. The worst composited case — `--muted` over the sidebar veil
over a black blob — is 4.68:1, measured in the appearance suite rather than
computed from a token.

## Geometry

Radius 0 everywhere, no exceptions: structure is carried by rules and alignment,
never by cards or shadow. Phase 109 took out all 48 `border-radius` declarations
and `App.css.test.ts` asserts no rule declares a non-zero one, because the way
that rule dies is one control at a time. `border-radius: 0` stays legal — it is
how a UA style gets reset.

Shadow still draws two things the sheet has no quarrel with: the play button's
halo and the cover art's hairline ring, both now square. What the rule reaches
is corners, not depth. A dialog has a third, `--shadow-dialog` — the sheet's own
`0 12px 32px`, heavier than the `--shadow` every menu and popup casts, and the
only thing besides a hairline edge separating a square box from the window
behind it.

**A dialog's regions are divided by 2px of `--rule`**, under its header and
above its footer. That rule is what the sheet has instead of a card, so it is
its own token rather than a second use of `--menu-border`: on dark the two are
the same colour, and on light the sheet draws the rule at `.4` of ink against
the edge's `.2`. It is a separator rather than part of a control, so WCAG
1.4.11 does not reach it and nothing asserts a ratio on the token; the
appearance suite measures the composited line instead.

**A fourth and lightest weight, `--row-line`.** 6e draws two line weights in
one picture: the queue's column edge and its eyebrow at the sheet's
`separator`, and the line between two queue rows a step under it. Both the
review queue and the mapping table wear it, and the difference is what makes a
run of rows read as one block inside a frame rather than as a stack of panels.
A separator, so nothing asserts a ratio on it either.

## Type

**Archivo** (via `@fontsource/archivo`, latin subset, weights 400, 600 and 800)
draws everything, prose and figures alike — the Segoe UI / Space Grotesk split
went with phase 107. Nothing is fetched from a font CDN: the app is
offline-first and the CSP forbids it. Two stacks in `App.css` are not text and
are not the split: `ui-monospace` for the panic message and the backtrace, and
Segoe MDL2 for the caption glyphs.

Figures carry `font-variant-numeric: tabular-nums` wherever they line up against
each other, which is the only thing holding a column still now that they are set
in the prose face. `App.css.test.ts` asserts both halves.

The sheet's scale, which the component issues apply role by role. Button label
and Badge landed with the primitives in phase 110; the rest arrive with the
sections that draw them.

| Role | Value |
| --- | --- |
| Section heading | `800 26px/1.1`, `-.02em` |
| Release header | `800 24px/1.05`, `-.02em` |
| Dialog title | `800 17px/1.1`; paned dialog `800 16px` |
| Stat figure | `800 28px/1`, tabular; tile figure `800 24px/1` |
| Row text | `400 12.5px/1` |
| Duration, count | `400 12px/1`, tabular |
| Button label | `800 13px/1.2`, centred; small `800 12px/1` |
| Field label | `400 11px/1` or `11.5px/1` |
| Eyebrow | `800 9.5–10px/1`, `.11–.14em`, uppercase |
| Badge | `800 10.5px/1`, `.06em`, uppercase |

Centred button labels are the sheet's one departure from flush-left: "a desktop
action reads as a target rather than a line of text".

## Layout

- The OS draws the frame. Phase 119 dropped `decorations: false`, so the title,
  the caption buttons, the system menu and snap layouts are the window's own.
- A 40px app bar under it: the mark, the menus, the version, an update when one
  is ready, the search field.
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
- **The view summary** ("n songs, x hours, size", or "n releases") sits at the
  top of the content: beside the heading on a browse view, at the right end of
  a drill-in's breadcrumb row, and on a line of its own over the Songs table.
  None over an empty state or Statistics.
- **No status bar.** The design draws one with the summary centred; phase 152
  moved the summary to the content it counts and dropped the bar. Zoom is in
  Settings and on the keyboard.
- **A 100px player bar at the very bottom**, under the content, only while a
  track is loaded (paused counts, stopped does not). Laid out like
  Spotify's in three columns at 30 / 40 / 30: cover, title over artist and a
  heart on the left; prev/play/next with repeat, over the playhead, centred;
  mute and volume on the right. The cover and title open the track's album, the
  artist the artist it is filed under, and the heart loves it.
- **Settings is a rail and a pane**, at one size whichever category is open:
  Appearance (Interface Zoom, Theme, Colour From Album Art), Library (Library Folder,
  Music Folders), Online (Look Up Releases Online, last.fm) and About (Activity
  Log). The rail items wear the sidebar's navigation look. Issue 91 built it on
  the app's tokens while the design could not be fetched, so the design's own
  settings dialog wants re-fetching and amending to match.
