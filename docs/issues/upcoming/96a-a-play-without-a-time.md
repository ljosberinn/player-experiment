# 96a — A play without a time

44,005 of the live library's 237,665 plays carry a `started_at` of 1 through
44,005 — one per second, ordered by artist then title, all `source = 'lastfm'`.
They are a bulk import into last.fm from before it kept dates; the API serves
them with `date.uts` set to that counter and `lastfm/import.rs::scrobble`
stores it verbatim. In local time they land on Thursday 1970-01-01, 01:00:01
to 13:13:25.

They are real plays. What they are not is a point in time, and every aggregate
in `db/stats.rs` that cuts the log by the clock currently treats them as one.

## What it breaks

Under all time only — every range filter already excludes them.

- **Plays over time** and **New artists**: `listen_totals.first_at` is 1, so
  `SeriesPanel`'s span is 1970 to now and `bucketFor` picks `year`. Both charts
  become 57 bars, 41 of them empty, with 1970 the tallest at 44,005 against a
  real best year of 25,300.
- **When you listen**: Thursday holds exactly 3,600 in each of the hours 01
  through 12, and 806 in hour 13. 44,005 of Thursday's 72,348 plays are these,
  and no other weekday is close.
- **New artists**, again and separately: `firsts` takes each artist's `min`, so
  1,134 of 9,476 artists are dated to 1970 — they are not only a false bar,
  they are missing from the bucket where they were first heard.
- **Listening days**: 1970-01-01 is a day, and the tile's `since` reads
  1/1/1970.

## The floor, not a zero check

The values are 1 to 44,005, so `started_at > 0` does nothing. The test that
works is that no scrobble can predate the service: one constant at
2002-01-01, below which a timestamp is a placeholder rather than a time.

## Where it applies, and where it does not

`Plays` grows a dated variant of `clause` rather than a blanket condition in
`Plays::new`, and it is used by the aggregates whose answer is a position on a
clock: `plays_over_time`, `firsts`, `week_clock`, `streaks`, and the `days`,
`first_at` and `last_at` columns of `listen_totals`.

`listen_totals.plays`, `top` and `recent_plays` keep counting them. They are
plays; an undated one still belongs to its artist and its album, and dropping
18% of the log from the top lists to fix an axis is a worse lie than the one
being fixed. This is `with_genre`'s rule: the number stays whole and the panel
that cannot cover it says so — [96b](96b-what-the-charts-cannot-place.md) is
where it says it.

So `ListenTotals` gains `dated` beside `timed`, counting the plays the
time-shaped panels can place.

## Testing

A fixture with a block below the floor beside dated plays. Each of the five
aggregates asserted to ignore it; `plays`, `artists` and `top` asserted to
still count it; `first_at` the first dated play; `days` unchanged by the block.
The floor itself asserted at its boundary second.
