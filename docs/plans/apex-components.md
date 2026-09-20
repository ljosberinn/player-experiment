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

- **Tokens.** One `:root` block in `App.css`, dark only, everything in `oklch`
  on hue 55. The design states hex. Convert to `oklch` rather than adopting the
  hex: `App.css.test.ts` computes every contrast ratio from the oklch channels,
  and hex would cost that guard. Record the design's hex beside each token.
- **Two grounds is the structural change.** The guard slices the *first*
  `:root {` block and reads tokens out of it by name; a second theme needs the
  guard to iterate themes and assert the contrast pairs twice.
- **Radius.** 48 `border-radius` declarations, from `2px` to `50%` (the play
  button, the cover ring, the transport pill). All go.
- **Type.** Segoe UI for prose, Space Grotesk for numerals, and a guard that
  asserts exactly that split. 7a is one face, so the guard inverts.
- **Controls are native.** `input[type=checkbox|radio]` and `select` are
  browser widgets with light styling. The design draws all four itself, plus a
  switch the app does not have.
- **No button primitive.** Every region styles its own; `.window-buttons`,
  `.repeat-button`, `.link-button`, `.history-button`, `.modal button` are
  unrelated rules.
- **Track list.** 3f (grouped by release, 168px art gutter, footer total row) is
  marked *Selected* and is a layout the Releases view does not have.
- **Titlebar.** `decorations: false` and a drawn 36px bar. The design assumes
  the OS draws it.

## How the components come out

New primitives land in **`src/components/primitives/`** — one file per
component, global classes in the sheet as everywhere else (CSS Modules were
declined, see conventions). `src/components/ui/` keeps the app chrome it holds
today; a file moves only when its own issue touches it.

Primitives the sheet specifies, against what exists:

| Primitive | Today |
| --- | --- |
| `Button` (primary / secondary / ghost / disabled) | nothing shared |
| `IconButton` (32px toolbar, 36px dialog, toggled) | nothing shared |
| `Tag`, `Badge`, `Count` | nothing shared |
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
113 through 117 are independent of each other once 112 has landed.
