# 84b — What you own

The Library tab's panels over `tracks`, which this build has all of. Stacks on
[80](../done/80-the-statistics-view.md) and
[84a](../done/84a-what-you-have-heard.md) — for `usePanelQuery`, `BarList` and
the CSV path, not for the play log or the import, which this tab needs neither
of.

The tile row went to 80, which needed a caller for the shell it built.

A bitrate histogram; a sample-rate breakdown; a duration distribution; release
years with a decade rollup; **albums by mean bitrate ascending, exportable to
CSV**, which is the re-download list; and tag health as per-field missing
counts.

- **Every aggregate goes through `TrackQuery` and `scope()`**, so the tab's
  scope selector — whole library, current view, a playlist — works on all of
  them rather than on the ones that remembered. `useLibraryQuery` assembles it
  once from the filters and the three view fields; six panels subscribing to
  the same four things by hand is where one of them forgets `search`.
- **The CSV path is 80's decision and 84a's code**: rows the panel has already
  fetched to a string, and the shell's save dialog over a `save_text_file`
  command. This phase is the caller it was built for.
- Three `src/ipc/index.ts` wrappers land here with their callers, which is
  [70](../done/70-chart-primitives.md)'s rule one level up —
  `stats_histogram`, `stats_worst_by_bitrate`, `stats_tag_health`.
- `LibraryTiles` moves onto `usePanelQuery`: 84a wrote it for exactly the
  effect the tiles still hand-roll.

## `Bar` is this phase's, not 84c's

84c says "84a is `BarList`, 84c is `Bar` and `Heatmap`", and the two phases run
in parallel. A histogram is a bar chart, so as written both phases create
`src/components/charts/Bar.tsx`. It lands here, with three callers — bitrate,
duration, years — and **84c stacks on this phase for it** and keeps `Heatmap`.

Band scale over `{label, value}`, the panel formatting its own labels: a bin is
"128–160", a bucket is "2014", and the axis is not the place to know which.
Inside `ChartFrame`, which owns `role="img"` and the show-as-table toggle.

**Sample rate is not a histogram.** It is five values with names, so it is a
`BarList` — which exists, is HTML, and is already the table a chart would need
a toggle to become. `histogram(SampleRate)` bins at width 1 and returns exactly
those five rows.

**Years and decades are one query.** `histogram(Year)` bins at 1; a decade is
the same bins summed ten at a time, in the panel. One panel with a rollup
toggle, not two panels and two identical scans.

## What lost its place, and why it did not need using to decide

**The genre donut, its drill-down and override editing are
[84d](84d-a-genre-is-a-guess.md).** It is the whole of the view's writer half —
a command pair, a refusal rule, an FK to honour and an editor — and the drill
cannot narrow this tab without a new `TrackQuery` field, which is argued there.
Everything left here is a read.

**Library growth over time goes.** `added_at` is when the scanner first saw the
file ([`insert_track`](../../../src-tauri/src/scan/mod.rs)), not when the record
was bought, so for a library scanned once the chart is one bar and stays one
bar until a watch folder fires. `stats_added_over_time` keeps its command and
loses its wrapper, by 70's rule: no caller, nothing to land.

**Tag health is counts, and the rows do not link out.** The link out wants
"tracks with no genre" as a library query, and `TrackQuery` has no empty-field
filter — it would need the field, the library store, a `HistoryEntry` and a
chip to clear it, which is [19](../done/19-browse-by-group.md) again rather
than a bullet. The counts are the panel; the link is its own issue when one is
wanted.

## The seeded library measures nothing

`synthetic::seed` writes no `bitrate`, no `sample_rate` and `added_at = 0`, so
`histogram(Bitrate)`, `histogram(SampleRate)` and `added_over_time` are
one-group scans at 150k rows and the library budgets in `tests/perf.rs` are the
only ones that cannot assert a non-empty result. That is the mistake
`seed_plays` documents having already fixed for the play log.

So the seeder gives a track a bitrate, a sample rate and a spread `added_at`,
on cycles coprime with the existing ones. It is what makes the budgets measure
the query and not the NULL.

## Testing

Geometry, not pixels: `rect` extents against a fixed measured size, with empty
and single-datum inputs where the band domain collapses. The decade rollup
asserted to sum the year bins it was given. The CSV asserted to carry the rows
the panel drew, through 84a's `toCsv`. `useLibraryQuery` asserted to put the
scope selector's three kinds into a `TrackQuery`.

One e2e screenshot for the tab. It is photographed where the spec already
stands — after `virtualization`, so the panels have the synthetic library under
them and the year histogram has 55 bars rather than three.
