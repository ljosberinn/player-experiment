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
- **Controls are native.** `input[type=checkbox|radio]` and `select` are
  browser widgets with light styling. The design draws all four itself, plus a
  switch the app does not have.
- **The button primitive exists but nothing uses it.** Every region still
  styles its own; `.window-buttons`, `.repeat-button`, `.link-button`,
  `.history-button`, `.modal button` are unrelated rules until their own issue
  migrates them.
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
| `Button` (primary / secondary / ghost / disabled) | **done, 110** |
| `IconButton` (32px toolbar, 36px dialog, toggled) | **done, 110** |
| `Tag` (four tones), `Count` | **done, 110** — the sheet's tag and badge are one drawing, so one component |
| `Checkbox`, `Radio`, `Switch` | native elements |
| `Select`, `SearchField`, `SegmentedControl` | native `select`, ad-hoc inputs |
| `Slider`, `ProgressBar` | `Scrubber`, `VolumeControl` (Base UI) |
| `StatRow`, `StatTile` | `charts/StatTile` (close) |
| `FilterBar`, `FilterToken` | `.stats-filter` |
| `Leaderboard`, `Heatmap`, `Streak` | `charts/BarList`, `charts/Heatmap` |
| `Menu`, `MenuItem`, `MenuSeparator` | `ui/ContextMenu` (Base UI, close) |
| `Dialog` header / body / footer | `.modal`, per-dialog |
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
106 Storybook ─────────────────────────────── parallel
118 Native titlebar ───────────────────────── parallel

107 Archivo ─┐
108 Grounds ─┼─→ 110 Buttons ─┐
109 Radius ──┘   111 Controls ┴─→ 112 Dialog chrome ─→ 113 Track list
                                                       114 Stat tiles
                                                       115 Streaks etc.
                                                       116 Menu + task line
                                                       117 MusicBrainz review
```

107, 108 and 109 each rewrite guards in `App.css.test.ts` and all three touch
the token block — stack them rather than running them in parallel worktrees.
All three have landed, and 110 with them.
113 through 117 are independent of each other once 112 has landed.

**111 now stacks on 110 rather than branching from main.** Both write
`library.css` and both add tokens, which is the same two files 107–109 were
stacked for.
