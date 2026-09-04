# 84b — What you own

The Library tab's panels — static data over `tracks`, which this build has all
of. Stacks on [75](75-the-genre-tree.md) and [80](80-the-statistics-view.md).
Independent of [84a](84a-what-you-have-heard.md), and needs neither the play log
nor the import.

Tiles: tracks, artists, albums, bytes, duration, missing. Then a bitrate
histogram; a sample-rate breakdown; **albums by mean bitrate ascending,
exportable to CSV**, which is the re-download list; the genre donut with
drill-down and override editing; release years and decades; library growth over
time; a duration distribution; and tag health as per-field missing counts, each
row a link into the filtered Songs table.

**Which of those earn their place is answered by using them.** Expect the list
to lose entries.

- **Every aggregate goes through `TrackQuery` and `scope()`**, so the tab's
  scope selector — whole library, current view, a playlist — works on all of
  them rather than on the ones that remembered.
- **The genre donut is the only writer of `genre_overrides`.** A slice drills to
  its children through [75](75-the-genre-tree.md)'s `genres.parent`; a
  suffix-derived parent is **labelled as derived**, so a wrong guess is visible
  and fixable rather than trusted. The primary-parent rule is arbitrary by
  construction and the override is what corrects it.
- Tag health rows leave Statistics deliberately — that is the Songs table, and
  it is the one link out that is a link out.

Testing: geometry, not pixels. The override editor asserted to re-parent a genre
and the donut asserted to redraw from it. e2e screenshots for the tab and for a
drilled genre donut.
