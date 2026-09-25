# 146g — Stories for the Library tab of Statistics

Needs [146a](146a-story-harness.md). Titles go under `Features/Statistics`.
146h does the Listening tab.

Each panel fetches its own data on mount through `useLibraryQuery` and
`usePanelQuery`, so every story answers the command for that panel. A panel
story draws only its own panel, and the `StatisticsView` story draws them all
together.

| Story file | Draws | IPC | States |
| --- | --- | --- | --- |
| `stats/StatisticsView.stories.tsx` | `StatisticsView` on `library`, and through it `LibraryPanels` | `loadStatsFilters` plus every command below | the whole library; an empty library |
| `stats/StatsFilterBar.stories.tsx` | `StatsFilterBar`, `StatsFilterTokens` | `browseGroups` | no filters; Library with a playlist and a genre; Listening with a custom range, owned and not loved |
| `stats/LibraryTiles.stories.tsx` | `LibraryTiles` | `statsLibraryTotals` | totals, all zero |
| `stats/panels/GenreDonut.stories.tsx` | `GenreDonut` | `statsGenreBreakdown` | the roots; one genre (drilled into Pop); none |
| `stats/panels/GenreOverrideDialog.stories.tsx` | `GenreOverrideDialog` | `genreSuggestions`, `setGenreOverride` | at the root; on a genre; refused after Save in `play` |
| `stats/panels/HistogramPanel.stories.tsx` | `HistogramPanel`, `ReleaseYears`, `SampleRates` | `statsHistogram` | each with data; decades; all four empty |
| `stats/panels/TagHealthPanel.stories.tsx` | `TagHealthPanel` | `statsTagHealth` | gaps, all complete |
| `stats/panels/WorstByBitrate.stories.tsx` | `WorstByBitrate` | `statsWorstByBitrate` | a list, empty |

- The dialog cannot show an existing override: it always opens with an empty
  parent, and nothing reads an override back.
- `.storybook/stats.ts` computes the aggregates over `library.ts`'s `rows`,
  so the figures agree across panels and a scope or genre crumb narrows all
  of them. `rows` filters `TrackQuery.genre` as a branch of `GENRE_PARENTS`.
- Each `LIBRARY` album has its own bitrate and sample rate.
- `WorstByBitrate` exports CSV through `plugin:dialog|save` and
  `saveTextFile`. The dialog answers `null`.
- `statsHandlers` and `emptyStatsHandlers` in `.storybook/handlers.ts`;
  `inStatsPanels` in `.storybook/decorators.tsx`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- The `StatisticsView` story shows no panel stuck loading.
