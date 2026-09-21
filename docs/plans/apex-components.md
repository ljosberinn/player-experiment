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
- **The button primitive is now what a dialog's actions are.** Elsewhere every
  region still styles its own; `.window-buttons`, `.repeat-button`,
  `.link-button` and `.history-button` are unrelated rules until their own
  issue migrates them.
- **Track list.** 3f (grouped by release, 168px art gutter, footer total row) is
  marked *Selected* and is a layout the Releases view does not have.
- **Titlebar.** `decorations: false` and a drawn 36px bar. The design assumes
  the OS draws it.

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
| `IconButton` (32px toolbar, 36px dialog, toggled) | **done, 110** |
| `Tag` (four tones), `Count` | **done, 110** — the sheet's tag and badge are one drawing, so one component |
| `Checkbox`, `Radio`, `Switch` | **done, 111** — `Switch` is Base UI, the other two draw over the native element |
| `Select`, `SearchField`, `SegmentedControl` | **done, 111** — `Select` is Base UI; the segments are a native radio group |
| `Slider`, `ProgressBar` | **`Slider` done, 111** (Base UI). `Scrubber` and `VolumeControl` keep the transport's own treatment |
| `StatRow`, `StatTile` | `charts/StatTile` (close) |
| `FilterBar`, `FilterToken` | `.stats-filter` |
| `Leaderboard`, `Heatmap`, `Streak` | `charts/BarList`, `charts/Heatmap` |
| `Menu`, `MenuItem`, `MenuSeparator` | `ui/ContextMenu` (Base UI, close) |
| `Dialog` header / body / footer | **done, 113** — all eight dialogs |
| `TaskLine`, `Skeleton` | `.sidebar-task`, ad-hoc |

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
119 Native titlebar ───────────────────────────── parallel

107 Archivo ─┐
108 Grounds ─┼─→ 110 Buttons ─┐
109 Radius ──┘   111 Controls ┴─→ 113 Dialog chrome ─→ 113b Smart playlist editor
                                                       114 Track list
                                                       115 Stat tiles
                                                       116 Streaks etc.
                                                       117 Menu + task line
                                                       118 MusicBrainz review
```

107, 108 and 109 each rewrite guards in `App.css.test.ts` and all three touch
the token block — stack them rather than running them in parallel worktrees.
All three have landed, and 110 and 111 with them.
113b through 118 are independent of each other once 113 has landed.

**113 is the chrome and 113b is what one dialog holds.** Section 06 draws both
in one picture, but the rule grid and the disabled sort row touch nothing the
other six dialogs share, so they are a second branch stacked on the first
rather than half of a diff nobody can review.

**111 stacked on 110 rather than branching from main.** Both write
`library.css` and both add tokens, which is the same two files 107–109 were
stacked for.
