# 147b — On this day

A third Statistics tab: what you played on today's date in earlier years.

- `StatsTab` gains `"onThisDay"`, titled *On this day*.
- One section per earlier year with a dated play on today's local month and
  day, newest year first. Heading `3 years ago · 25 Sep 2023` and the play
  count, then the plays newest first with `RecentPlays`' row content and
  *not owned* marker. Rows do not drill.
- 29 February matches 29 February only.
- Empty: `Nothing played on 25 September in earlier years.`
- The day is read when the tab mounts; it does not roll over at midnight.

## Filters

Range does not apply — the day is the range. The filter bar draws Owned and
Loved only, and `activeFilters` gives no range token on this tab.

## Query

No new Rust. One `statsRecentPlays` per earlier year, `range` set to that
year's day — local midnight to the next local midnight, as `rangeFor` builds
bounds — each on `idx_plays_started`. Years run from `firstAt`'s
(`listenTotalsOnce`) to last year. `limit` is `MAX_LIMIT`; a day past 1,000
plays says the list is cut.

Not `strftime('%m-%d')` in SQL: that is a scan of every play for twenty
indexed lookups' answer.

## Testing

- Per-year ranges: across DST, 29 February in leap and common years, a history
  starting this year.
- Range filter set: ignored here, no token.
- Empty years left out; empty state.
- Story under `Features/Statistics` for the tab: several years, none.
