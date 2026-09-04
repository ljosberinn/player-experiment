# 70 — Chart primitives

The drawing half of [plans/statistics.md](../../plans/statistics.md), built
before there is a panel to draw. Depends on nothing, and 80 waits on it.

```
src/components/charts/
  scales.ts       -- the only file importing d3-scale / d3-shape
  ChartFrame.tsx  -- ResizeObserver measure, axes, empty and loading states
  Bar.tsx  Line.tsx  Donut.tsx  Heatmap.tsx  Sparkline.tsx  StatTile.tsx
  Tooltip.tsx
```

**`d3-scale` and `d3-shape`, and nothing else from d3.** Both are pure
functions with no DOM and no React, and they cover ticks and the arc and area
path generators. Every element and every colour is ours, which is what the
design and `e2e/contrast.ts` require. Recharts owns its own markup and its own
colours, and has no heatmap.

- **Colours are tokens only.** No literal in a chart file, so the contrast rule
  holds by construction rather than by inspection.
- **Measure the `<section>`, not the scroll container**, and measure into state
  through a `ResizeObserver` — `BrowseView`'s rule, for the reason it paid for.
  No ref read during render.
- **`Heatmap` serves the weekday-by-hour grid and the calendar year alike.** One
  component, two domains; a second heatmap component is what would be wrong.
- Charts are pure functions of their props and hold no virtualizer, so unlike
  `SongTable` and `BrowseView` they compile clean under the React compiler and
  want no `"use no memo"`.

**Each primitive lands with a caller or it does not land.** Without a panel the
only honest caller is its own test, so the set above is a ceiling, not a
checklist: build what 80's shell and the first panels need and leave the rest
for 84.

Accessibility is a primitive concern, not a panel one: `ChartFrame` takes the
`role="img"` label and hosts the show-as-table toggle, so every chart gets both
and no panel has to remember.

Testing: geometry, never pixels — `path` command strings and `rect` extents,
against a fixed measured size. Empty and single-datum inputs for every
primitive, which is where scale domains collapse.
