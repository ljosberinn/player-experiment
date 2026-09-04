# xx — Statistics

The sidebar ships a dimmed, inert **Statistics** item, as the design draws it —
`LibraryNav.tsx`, asserted disabled in `chrome.test.tsx`.

**Not work, and deliberately not.** It is decided in
[plans/statistics.md](../../plans/statistics.md) and split into
[70](70-chart-primitives.md), [75](75-the-genre-tree.md),
[76](76-the-play-log.md), [77](77-the-stats-query-layer.md),
[78](78-import-the-lastfm-history.md), [80](80-the-statistics-view.md),
[84a](84a-what-you-have-heard.md) and [84b](84b-what-you-own.md). This file is
the pointer that says why the item is dimmed, and it goes when 80 lands and the
item becomes a destination.

Nothing here waits on [82](../done/82b-the-unattended-lookup-pass.md),
[83](../done/83a-where-a-file-goes.md) or [87](87-one-release-one-tile.md), and none of
them wait on it.
