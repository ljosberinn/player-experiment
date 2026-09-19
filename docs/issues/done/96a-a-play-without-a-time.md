# 96a — A play without a time

44,005 of the live library's 237,665 plays carry a `started_at` of 1 through
44,005 — one per second, ordered by artist then title, all `source = 'lastfm'`.
They are a bulk import into last.fm from before it kept dates; the API serves
them with `date.uts` set to that counter and `lastfm/import.rs::scrobble`
stores it verbatim. In local time they land on Thursday 1970-01-01, 01:00:01
to 13:13:25. The first dated play is 2011-09-14.

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
- **New artists**, again: 1,134 of 9,476 artists are first heard in 1970.
- **Listening days**: 1970-01-01 is a day, and the tile's `since` reads
  1/1/1970.
- **Recent plays**: the tail of the list is 44,005 rows dated 1/1/1970.

## The floor, not a zero check

The values are 1 to 44,005, so `started_at > 0` does nothing. The test that
works is that no scrobble can predate the service: one constant at
2002-01-01, below which a timestamp is a placeholder rather than a time.

Stored verbatim still: `(started_at, match_key)` is the import's dedupe key.

## Where it applies, and where it does not

`Plays` grows a dated variant of `clause`, used by `plays_over_time`,
`week_clock`, `streaks`, and the `days`, `first_at` and `last_at` columns of
`listen_totals`.

`firsts` does not take it. An undated play predates every dated one, so an
artist with one was first heard before the log can say when. Moving them to
their first dated play would make 265 of 2011's 386 new artists, and 280 more
spread across later years, new when they were not. The first play is still
found over all plays, and an artist whose first is undated is left out.

`listen_totals.plays`, `top` and `recent_plays` keep counting them. They are
plays; an undated one still belongs to its artist and its album, and dropping
18% of the log from the top lists to fix an axis is a worse lie than the one
being fixed. This is `with_genre`'s rule: the number stays whole and the panel
that cannot cover it says so — [96b](../upcoming/96b-what-the-charts-cannot-place.md)
is where it says it.

So `ListenTotals` gains `dated` beside `timed`, and `Play.started_at` is `null`
below the floor; Recent plays shows no date for it.

## Testing

A fixture with a block below the floor beside dated plays. `plays_over_time`,
`week_clock`, `streaks` asserted to ignore it; `firsts` asserted to drop an
artist first heard undated and to keep one heard only dated; `plays`,
`artists` and `top` asserted to still count it; `first_at` the first dated
play; `days` unchanged by the block. The floor itself asserted at its boundary
second. Recent plays' undated row asserted to show no date.
