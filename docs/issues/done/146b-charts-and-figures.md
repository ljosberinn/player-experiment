# 146b — Stories for the charts and statistic figures

These components render from props alone, so they need no harness. This issue
is independent of the others in the series and gets its own worktree.

Each story file sits beside its component and draws every state on one sheet,
like the primitive stories before it.

| Story file | Draws | States |
| --- | --- | --- |
| `components/charts/Bar.stories.tsx` | `Bar` (and `ChartFrame`, `ChartShell` through it) | 55 thinned years, 24 hours, three bands with a zero, empty, loading |
| `components/charts/BarList.stories.tsx` | `BarList` | short list; ten rows with `secondary`, truncating labels, `onSelect` and `caption`; empty; loading |
| `components/charts/Donut.stories.tsx` | `Donut` | many slices (a `note`, drilling and inert slices), one slice, empty, loading |
| `components/charts/Heatmap.stories.tsx` | `Heatmap` | a full week clock, a sparse one, all zero, empty, loading |
| `features/stats/panels/StatsPanel.stories.tsx` | `StatsPanel` | title only, with `action`, with `caption` |
| `components/primitives/StatTiles.stories.tsx` | `StatRow`, `StatTiles`, `StatFigure` | word and symbol units, no unit, `caption`, `delta`, long values |
| `components/primitives/Streak.stories.tsx` | `Streak` | current = longest, current < longest, no streak, before the answer |
| `components/primitives/TaskLine.stories.tsx` | `TaskLine`, `ProgressBar` | not started, a sliver, part done, done, with and without `estimate` |
| `features/editor/WriteLine.stories.tsx` | `WriteLine` | `null`, part way, `done === total` |
| `components/icons/Icon.stories.tsx` | `Icon` | every key of `ICONS` at every size a call site uses |

- Charts sit in a `StatsPanel`: the table view's styles are scoped to
  `.stats-panel`. A `.chart` has a fixed height, so a panel only needs a width.
- The table view is shown live through each chart's toggle.
- The icon sheet reads its rows from the keys of `ICONS`.
- `charts/Tooltip` is not in use, so it gets no story.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
