# Apex component library

The design source has a second file. `Apex Components.dc.html`, in the claude.ai
project **"Apex music player component library"**
(`e08e15f9-0d0f-4761-8efd-01bfa268fffc`), is a specimen sheet rather than a
screen mockup: seven sections of primitives, each drawn on a light and a dark
ground from one token set. Read it with DesignSync `get_file`, not WebFetch —
or read the gitignored local mirror at `design/apex-components.dc.html`, and
re-fetch before trusting it.

It does not replace `Apex Music Player.dc.html` — it does not draw the sidebar,
the transport strip, the playlist tree or the release grid, and says so ("Try
next: spec the sidebar and playlist tree · show the release grid card"). The
shell stays governed by the old file until the library covers it.

## What it settles

| | |
| --- | --- |
| Type | **7a Ember · Archivo**, chosen 20.9.2026. One face for everything, weights 400/600/800. Space Grotesk is retired. |
| Accent | `#e8730f` light, `#f58a1f` dark — one step lighter on ink so both read at the same value. |
| Geometry | Radius 0 everywhere, no exceptions. Structure is rules and alignment, never cards or shadow. |
| Feedback | No transitions on any interactive state. Already true here (`* { transition: none }`). |
| Grounds | Light **and** dark, from one token set. Both ship. |
| Chrome | Native OS titlebar; app menus in the content area. |

## Where the app stands against it

- **Tokens.** Done in 108: `src/styles/tokens.css`, both grounds, everything in
  `oklch` with the design's hex beside it. The dark column was re-based onto the
  sheet at the same time, so both grounds come from one source. `--dim` was
  folded into `--muted` — the re-based grounds leave no room for a third
  recessive step that is still AA — and the veil and blob opacities are ours,
  higher on light. See [design.md](../knowledge/design.md#tokens).
- **Two grounds was the structural change.** The guard now iterates both,
  asserts every contrast pair twice, and requires the two blocks to declare
  identical name sets. The appearance suite loops the same way, against the
  composited stack rather than the token values.
- **Radius.** Done in 109: all 48 `border-radius` declarations gone, with a
  guard against a non-zero one coming back. The transport is the one control
  that changed shape rather than softness — three abutting squares reading as a
  segmented block. See [design.md](../knowledge/design.md#geometry).
- **Type.** Done in 107: Archivo alone, the guard inverted, the sheet's sizes
  still to be applied role by role as each primitive lands. Button label and
  Badge landed with 110.
- **Section 01 is in.** Done in 110: `Button`, `IconButton` and `Tag` in
  `src/components/primitives/`, drawn by a fourth sheet, `styles/library.css`,
  imported between the reset and the app's regions so a region can still
  overrule a primitive it wraps. Nothing calls them yet.
- **Section 02 is in.** Done in 111: `Checkbox`, `Radio`, `Switch`, `Select`,
  `SearchField`, `SegmentedControl` and `Slider`, with every native
  `input[type=checkbox|radio]` and `<select>` in the app migrated onto them.
  This reversed phase 24's stop clause on the native select — an OS popup
  draws in the OS's colours, which is the wrong kind of native once the
  controls beside it are drawn and there are two grounds.
- **Section 06 is in.** Done in 113: `Dialog` over both Base UI roots, with
  every one of the eight dialogs migrated and `app.css`'s `.modal` block gone.
  The classes are `.dialog*`; `.dialog.lookup`, `.dialog.settings` and
  `.dialog.confirm` are all that is left in `app.css`, and a guard fails any of
  them that restates the edge, the inset or the shadow. `--rule`,
  `--shadow-dialog` and `--field-disabled` landed with it.
- **Section 6a is in.** Done in 113b: the smart playlist editor's interior —
  the rule box as one `130px 130px 1fr 30px` grid, the name row's accent edge,
  and the sort and cutoff rows drawn as disabled-in-place rather than dimmed.
  `IconButton` gained the sheet's fourth place and the icon registry a
  `remove` glyph, which is what the `✕` text buttons were.
- **Section 4a is in, and it is not two alternatives.** Done in 115. The row it
  draws is Plays / Artists / Tracks / Time spent and the cells under it are
  LISTENING DAYS, OWNED "plays matched to a file", THIS MONTH — that caption is
  verbatim from `ListeningTiles.tsx`, so 4a is drawing this app's Listening tab
  rather than offering a choice. The rule it splits on is **prose**: a bare
  figure sits on the row, a figure that needs a line under it takes a cell.
- **Section 4c is one panel, and 4e is two alternatives.** Both wear the sheet's
  "Top: … Bottom: …" caption, which is 4b's alternatives grammar — but 4c's
  two blocks carry the seven-day strip, which the figures above it do not, and
  4e's two draw the same five rows twice. Same grammar, and what settles it is
  whether the lower drawing says anything new. Done in 116a for 4c: the
  figures, the track and the week are one panel, `StreakTiles` redrawn.
- **Section 4d is in, and it is the first drawing that did not fit the chart
  frame.** Done in 116b. Seven 13px rows come to ~117px whatever room the view
  had, and `.chart` is a fixed 180px box `ChartFrame` measures — so the grid is
  HTML, and `ChartFrame` split: `ChartShell` is the label, the empty and
  loading states and the show-as-table toggle, and `ChartFrame` is that plus
  the svg, the margins and the axes. The alternative was a second toggle
  mechanism in the app. The ramp grew to eight steps derived from one
  `color-mix` formula, which regraded `Donut` too, since `rampStep` is shared.
  `Heatmap` itself stays in `charts/` rather than moving to `primitives/`:
  `rampStep` and the shell are chart infrastructure, and splitting it from
  `Donut` across two directories to satisfy a row of this table buys nothing.
  Its *drawing* did move, to `library.css`, and the guard that keeps 4a and
  4c out of `app.css` now covers it.
- **Section 4e is two alternatives, and the app takes the bar.** Done in 116c.
  Its two blocks iterate the same five rows twice — the lower drops the bar and
  adds a rank numeral, which is nothing 4b's rule counts as new — so `BarList`
  was restyled to the upper form and the numbered list was not built. The
  variant the issue first proposed had no honest caller: `WorstByBitrate` is a
  table because it carries album, artist, songs and mean kbps, not because a
  bar of 320 would read flat, and a `24px 1fr auto` grid drops two of those
  columns. `BarList` stays in `charts/` for `Heatmap`'s reason; its drawing
  moved to `library.css` and the same guard covers it.
- **Section 05 is in, and it is one drawing for two menus.** Done in 117.
  `renderMenuItem` has drawn the row menu and every menu-bar dropdown since
  phase 34, so the section lands on both; the classes became `.menu-*` on the
  way into `library.css`, "context" having stopped being true at the bar, and
  226px is a floor rather than the sheet's fixed width so File is not two
  thirds empty. Items went full bleed, which reverses phase 24's inset. The
  trailing column now also carries a `shortcut`, drawn only where a binding
  exists — the sheet's own `Ctrl+E` names nothing, so it is not drawn.
  `ProgressBar` landed with `TaskLine`: the sheet draws the same 4px rail here
  and under 6f, and anything under way is drawn at three pixels at least, which
  is what the sheet does with 0,22%.
- **Section 4b is two alternatives, and that is the asymmetry.** Its selects
  read `All time` / `Either` / `Either` while its tokens read `last 12 months` /
  `owned only`. Two forms of one control drawn in one frame contradict each
  other; two forms carrying different figures, as in 4a, cannot. So 115 took the
  selects and the token line is [122](../issues/upcoming/122-filter-tokens.md),
  which has to decide which form the view wears — and what "+ add filter" even
  opens, given that `StatsFilters` is a closed struct.
- **The button primitive is now what a dialog's actions are.** Elsewhere every
  region still styles its own; `.repeat-button`, `.link-button` and
  `.history-button` are unrelated rules until their own issue migrates them.
  `.window-buttons` was a fourth until 119 deleted it.
- **Track list.** Done in 114. Section 03 holds one drawing, 3f, and the row
  treatment it applied comes from **7a** instead — the type specimen is the
  only place the sheet draws a playing row. 3f itself is 120, and it replaces
  the drill-in rather than the cover grid: the Releases view is a tile grid, so
  "grouped by release" was never a restyling of it.
- **Titlebar.** Done in 119: `decorations: false` gone, the OS draws the frame,
  and the 36px bar under it stopped being a title bar — `AppBar`, `.appbar*`,
  carrying the mark, the menus and the version. The shell file does not
  contradict the sheet here: it draws the window buttons behind an `sc-if`
  toggle, so the frame was always a parameter there. This also closed the
  frameless-window coverage gap, since the e2e build had pinned
  `decorations: true` all along.

## How the components come out

New primitives land in **`src/components/primitives/`** — one file per
component, drawn by **`src/styles/library.css`**, one file for all of them
(CSS Modules were declined, see conventions). The classes are global, so a
sheet per component would buy no scoping and would cost a guard: every sheet
is an entry in `App.css.test.ts`'s list, and one forgotten there drops that
primitive out of every check that asserts an absence.

`src/components/ui/` keeps the app chrome it holds today; a file moves only
when its own issue touches it.

Primitives the sheet specifies, against what exists:

| Primitive | Today |
| --- | --- |
| `Button` (primary / secondary / ghost / disabled) | **done, 110**; `destructive` added in 113 |
| `IconButton` (32px toolbar, 36px dialog, toggled) | **done, 110**; the 30px filter-rule place added in 113b |
| `Tag` (four tones), `Count` | **done, 110** — the sheet's tag and badge are one drawing, so one component |
| `Checkbox`, `Radio`, `Switch` | **done, 111** — `Switch` is Base UI, the other two draw over the native element |
| `Select`, `SearchField`, `SegmentedControl` | **done, 111** — `Select` is Base UI; the segments are a native radio group |
| `Slider`, `ProgressBar` | **`Slider` done, 111** (Base UI); **`ProgressBar` done, 117**, the rail `TaskLine` and 6f share. `Scrubber` and `VolumeControl` keep the transport's own treatment |
| `StatRow`, `StatTiles` | **done, 115** — `charts/StatTile` retired into the two |
| `FilterBar` | **done, 115** — `.stats-filters`. `FilterToken` is 122 |
| `Streak` | **done, 116a** — with `Streaks.last_seven` behind its week |
| `Heatmap` | **done, 116b** — stays in `charts/`, drawn by `library.css` |
| `Leaderboard` | **done, 116c** — `charts/BarList`, drawn by `library.css` |
| `Menu`, `MenuItem`, `MenuSeparator` | **done, 117** — drawn by `library.css` as `.menu-*`; `ui/ContextMenu` stays put, the item renderer and the trigger region being one vocabulary (116b's rule) |
| `Dialog` header / body / footer | **done, 113** — all eight dialogs |
| `TaskLine`, `Skeleton` | **`TaskLine` done, 117**; `.sidebar-task` is its placement and nothing else. `Skeleton` is 6f's pulse, which is 118 |

Base UI stays underneath the ones that need behaviour (menu, dialog, slider,
combobox). The primitive is what the app imports, so the library choice is
reversible the way the icon registry made Phosphor reversible.

## Storybook

`@storybook/react-vite@10.6` peers `vite ^8` and `react ^19` — both satisfied.
**`@storybook/addon-vitest` does not fit**: it peers `vitest ^3 || ^4` and this
repo is on `^5`. So no portable-story test runner for now; component behaviour
stays in the existing `*.test.tsx` under Vitest and appearance stays in the wdio
suite. Storybook earns its place as the place a primitive is drawn in every
state on both grounds at once, which is the thing neither suite shows.

## Order

Foundation first, then primitives, then the surfaces built out of them.

```
106 Storybook ──────→ 112 Storybook on Pages ──── parallel
119 Native titlebar ──────────────────────────── landed

107 Archivo ─┐
108 Grounds ─┼─→ 110 Buttons ─┐
109 Radius ──┘   111 Controls ┴─→ 113 Dialog chrome ─→ 113b Smart playlist editor
                                                       114 Track list row ─→ 120 Grouped release
                                                       115 Stat rows + tiles ─→ 122 Filter tokens
                                                       116a Streak
                                                       116b Heatmap
                                                       116c Leaderboard
                                                       117 Menu + task line
                                                       118 MusicBrainz review
```

107, 108 and 109 each rewrite guards in `App.css.test.ts` and all three touch
the token block — stack them rather than running them in parallel worktrees.
All three have landed, and 110 and 111 with them.
113b through 118 are independent of each other once 113 has landed. 113b, 114,
115 and 117 have landed too, each off main rather than stacked — 113 was in by
the time any of them started. 118 draws the same 4px rail 117 made a primitive,
so it has a `ProgressBar` to call rather than a second one to write.

**116 is three issues, and they share nothing.** 4c, 4d and 4e are three
drawings, not three views of one, and each carries its own decision: 116a a new
backend field, 116b the ramp — which `rampStep` shares with `Donut` — and 116c
whether the numbered list ships at all. The only file two of them
would both write is `library.css`, which is what 110 and 111 stacked for; here
the blocks are three separate sections, so they ran off main in parallel.
All three have landed.

**122 comes after 115 rather than beside it.** Both are section 4b, and the
question 122 opens — whether the view wears the selects or the tokens — is only
answerable once the selects are drawn.

**120 is stacked on 114 and is not ready to start.** Both draw a track row, so
the group's 28px row is the 32px row with two metrics changed rather than a
second drawing. 120 also has two unanswered questions of its own, which its
issue records.

**113 is the chrome and 113b is what one dialog holds.** Section 06 draws both
in one picture, but the rule grid and the disabled sort row touch nothing the
other six dialogs share, so they are a second branch stacked on the first
rather than half of a diff nobody can review.

**111 stacked on 110 rather than branching from main.** Both write
`library.css` and both add tokens, which is the same two files 107–109 were
stacked for.
