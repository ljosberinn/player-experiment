# 146h — Stories for the Listening tab of Statistics

Needs [146g](../done/146g-statistics-library.md), and adds to its
`statsHandlers` and `emptyStatsHandlers`. Titles go under
`Features/Statistics`. 146g already draws the Listening half of
`StatsFilterBar`.

Each panel fetches through `useListenQuery`. Most of them also call
`listenTotalsOnce` → `statsListenTotals`, so `statsHandlers` answers that
command once for every story in this issue.

| Story file | Draws | IPC | States |
| --- | --- | --- | --- |
| `stats/StatisticsView.stories.tsx` (story added) | `StatisticsView` on `listening`, and through it `ListeningPanels` | every command below | full history; no plays yet |
| `stats/ListeningTiles.stories.tsx` | `ListeningTiles` | `statsListenTotals` | totals, all zero |
| `stats/panels/StreakPanel.stories.tsx` | `StreakPanel` | `statsStreaks` | an ongoing streak, a broken one, none |
| `stats/panels/SeriesPanel.stories.tsx` | `SeriesPanel` | `statsPlaysOverTime`, `statsFirsts` | plays over time, firsts, empty |
| `stats/panels/WeekClock.stories.tsx` | `WeekClock` | `statsWeekClock` | a dense week, a sparse one, empty |
| `stats/panels/TopPanel.stories.tsx` | `TopPanel`, `AlbumLinkDialog` | `statsTop`, `statsAlbumGroup` | one per `dimension`; empty; the album link dialog opened by `play` |
| `stats/panels/HeardNeverOwned.stories.tsx` | `HeardNeverOwned` | `statsTop` | a list, empty |
| `stats/panels/RecentPlays.stories.tsx` | `RecentPlays` | `statsRecentPlays`, paged | several pages, one page, empty |

- `RecentPlays` is virtualised. Give it a parent with a set height, and page
  the handler the way `queryTracks` is paged in 146e.
- Build the play rows from `LIBRARY`, with a few plays that match no track,
  for *Heard, never owned*.
- `HeardNeverOwned` exports CSV. Answer it the way 146g answers
  `WorstByBitrate`.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- The `StatisticsView` Listening story shows no panel stuck loading.
