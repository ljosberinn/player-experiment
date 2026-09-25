# 146b — Stories for the charts and statistic figures

These components render from props alone, so they need no harness. This issue
is independent of the others in the series and gets its own worktree.

Each story file sits beside its component. Titles go under `Charts/` or
`Primitives/`.

| Story file | Draws | States |
| --- | --- | --- |
| `charts/Bar.stories.tsx` | `Bar` (and `ChartFrame`, `ChartShell` through it) | data, `columns`, `empty`, `loading` |
| `charts/BarList.stories.tsx` | `BarList` | short list, long list with truncating labels, empty, loading |
| `charts/Donut.stories.tsx` | `Donut` | many slices, one slice, `column`, empty, loading |
| `charts/Heatmap.stories.tsx` | `Heatmap` | a full week clock, a sparse one, all zero |
| `primitives/StatTiles.stories.tsx` | `StatTiles`, `StatRow`, `StatFigure` | figures with and without a unit, long values |
| `primitives/Streak.stories.tsx` | `Streak` | current = longest, current < longest, no streak |
| `primitives/TaskLine.stories.tsx` | `TaskLine`, `ProgressBar`, `WriteLine` | indeterminate, part done, done, with and without `estimate`; `WriteLine` with `null` and with progress |
| `icons/Icon.stories.tsx` | `Icon` | every key of `ICONS`, labelled, at every size in use |
| `features/stats/panels/StatsPanel.stories.tsx` | `StatsPanel` | title only, with `action`, with `caption` |

- Put a chart inside a parent with a set width and height. `ChartFrame`
  measures its parent with `ResizeObserver`.
- Build the icon sheet from the keys of `ICONS`, not from a list written out
  by hand. That way it can't go stale.
- `charts/Tooltip` is not in use, so it gets no story.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
