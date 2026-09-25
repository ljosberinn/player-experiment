# 147b — On this day

A third Statistics tab: what you played on today's date in earlier years.

- `StatsTab` gains `"onThisDay"`, titled *On this day*.
- One `StatsPanel` per earlier year with a play on today's local month and
  day, newest year first, titled `3 years ago · 25 Sep 2023` with the play
  count beside it. Plays newest first, time only, through `PlayRowContent`
  (shared with `RecentPlays`), *not owned* marker kept. Rows do not drill.
- 29 February matches 29 February only.
- Empty: `Nothing played on 25 September in earlier years.`
- The day is read when the tab mounts; it does not roll over at midnight.

## Filters

The filter bar draws Owned and Loved only; `activeFilters` gives no range,
scope or genre token on this tab.

## Query

No new Rust. `OnThisDay` sends one `statsRecentPlays` per year from 2002
(`DATED_FROM`) to last year, in parallel, each over `dayRange` - local
midnight to the next. Not `listenTotalsOnce`'s `firstAt`: that runs the
dearest aggregate unless the exact query is cached. `limit` is 1,000, the
backend's `MAX_LIMIT`; a year that fills it reads *1,000+ plays* and says it
is cut.

## Stories

`Features/Statistics/OnThisDay` (several years; none) and an `OnThisDay`
story on `StatisticsView`, through `onThisDayHandlers`: the Listening log plus
plays on today's date 2, 3, 5 and 9 years back, kept out of the log the
other panels count.
