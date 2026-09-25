# 146h — Stories for the Listening tab of Statistics

Needs [146g](146g-statistics-library.md), and adds to its `statsHandlers`
and `emptyStatsHandlers`. Titles go under `Features/Statistics`. 146g already
draws the Listening half of `StatsFilterBar`.

| Story file | Draws | IPC | States |
| --- | --- | --- | --- |
| `stats/StatisticsView.stories.tsx` (stories added) | `StatisticsView` on `listening`, and through it `ListeningPanels` | every command below | full history; no plays yet |
| `stats/ListeningTiles.stories.tsx` | `ListeningTiles` | `statsListenTotals` | totals; no plays (the empty-state sentence) |
| `stats/panels/StreakPanel.stories.tsx` | `StreakPanel` | `statsStreaks` | ongoing; broken; none |
| `stats/panels/SeriesPanel.stories.tsx` | `SeriesPanel` | `statsPlaysOverTime`, `statsFirsts` | plays over time; new artists; empty |
| `stats/panels/WeekClock.stories.tsx` | `WeekClock` | `statsWeekClock` | all time; the last seven days; empty |
| `stats/panels/TopPanel.stories.tsx` | `TopPanel`, `AlbumLinkDialog` | `statsTop`, `statsAlbumGroup` | one per `dimension`; empty; drilled into Harbour Lights with the dialog opened by `play` |
| `stats/panels/HeardNeverOwned.stories.tsx` | `HeardNeverOwned` | `statsTop` | a list, empty |
| `stats/panels/RecentPlays.stories.tsx` | `RecentPlays` | `statsRecentPlays`, paged | all time; the last seven days (one page); empty |

- `.storybook/listening.ts` generates a seeded play log from `LIBRARY` plus
  three unowned albums, and computes every Listening aggregate over it. The
  log ends today: ranges and the current streak are cut from the clock.
- Harbour Lights is also scrobbled as its deluxe edition, which folds under
  it, so the grouping dialog has two spellings. Its first plays are undated.
- `openListening` in the same file is each story's `beforeEach`.
- The preview `beforeEach` calls `forgetListenTotals`: `listenTotalsOnce`
  holds module state that would otherwise carry across stories.

## Verification

- `npm run storybook`: every state in the table renders on both grounds.
- The `StatisticsView` Listening story shows no panel stuck loading.
