# 146g — Stories for the Library tab of Statistics

Needs [146a](../done/146a-story-harness.md). Titles go under `Features/Statistics`.
146h does the Listening tab.

Each panel fetches its own data on mount through `useLibraryQuery` and
`usePanelQuery`, so every story answers the command for that panel. A panel
story draws only its own panel, and the `StatisticsView` story draws them all
together.

| Story file | Draws | IPC | States |
| --- | --- | --- | --- |
| `stats/StatisticsView.stories.tsx` | `StatisticsView` on `library`, and through it `LibraryPanels` | `loadStatsFilters` plus every command below | the whole library; an empty library |
| `stats/StatsFilterBar.stories.tsx` | `StatsFilterBar`, `StatsFilterTokens` | `browseGroups` | no filters; a playlist, a genre and a range all set |
| `stats/LibraryTiles.stories.tsx` | `LibraryTiles` | `statsLibraryTotals` | totals, all zero |
| `stats/panels/GenreDonut.stories.tsx` | `GenreDonut` | `statsGenreBreakdown` | many genres, one genre, none |
| `stats/panels/GenreOverrideDialog.stories.tsx` | `GenreOverrideDialog` | `genreSuggestions` | no override yet, an existing override |
| `stats/panels/HistogramPanel.stories.tsx` | `HistogramPanel`, `ReleaseYears`, `SampleRates` | `statsHistogram` | each with data; each empty |
| `stats/panels/TagHealthPanel.stories.tsx` | `TagHealthPanel` | `statsTagHealth` | gaps, all complete |
| `stats/panels/WorstByBitrate.stories.tsx` | `WorstByBitrate` | `statsWorstByBitrate` | a list, empty |

- Build the stats rows from `LIBRARY` in `.storybook/fixtures.ts`, so the
  figures agree across panels.
- `WorstByBitrate` exports CSV through `plugin:dialog|save` and
  `saveTextFile`. Answer both, with `null` for the dialog.
- Add `statsHandlers` to `.storybook/handlers.ts` and export it for 146h.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- The `StatisticsView` story shows no panel stuck loading.
