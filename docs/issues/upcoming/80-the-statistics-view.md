# 80 — The Statistics view

The shell the panels hang in: the sidebar item becomes a destination, two tabs,
the filter bar, and drill state in history. No panel yet — that is
[84a](84a-what-you-have-heard.md) and [84b](84b-what-you-own.md). Stacks on
[70](70-chart-primitives.md) and [77](77-the-stats-query-layer.md).

**Two tabs, because the two questions have nothing in common but a chart
library.** Listening is what you have heard; Library is what you own.

## `ViewTab` gains `"stats"`

Statistics becomes a sidebar item like Songs — the same act, the same highlight
— and the placeholder in
[LibraryNav.tsx](../../../src/components/ui/LibraryNav.tsx) loses its
`disabled`, as does the assertion on it in `chrome.test.tsx`.

`ViewTab` is `"songs" | BrowseKind` today, so widening it is not free: every
`Record<ViewTab, …>` — `VIEW_TITLES` among them — gains an entry, and anything
treating a non-`"songs"` tab as a `BrowseKind` has to be found rather than
assumed absent. The App.css note on the placeholder goes with it.

## Drill state in history

Drill state does not fit `HistoryEntry`'s `browse: BrowseFilter | null`, so the
entry gains a field:

```ts
export interface HistoryEntry {
  readonly tab: ViewTab;
  readonly browse: BrowseFilter | null;
  readonly playlistId: number | null;
  readonly stats: StatsPath | null;
}
```

`sameView` compares the path element-wise, so Back and Forward walk a genre
drill-down for free and `record`'s dedupe stops a re-click pushing a duplicate —
the treatment `browse` already gets.

**Clicks drill inside Statistics.** A donut slice narrows to its children, an
artist bar opens that artist's page, a breadcrumb walks back. Leaving for the
Songs table is a separate, explicit action — "Show these 412 songs" — so the
first click cannot end the exploration.

## Filter state lives in its own `statsStore`

In the library store a range change would wake every library subscriber, and
[CLAUDE.md](../../../CLAUDE.md) says as much. `App` branches on `tab === "stats"`
and renders `StatisticsView`; ranges, facets and loaded aggregates are subscribed
inside the panels that draw them — the lesson
[frontend.md](../../knowledge/frontend.md) already paid for with `positionMs`
and `selection`.

The filter bar's contents follow the tab, because the subjects differ:

| Listening | Library |
| --- | --- |
| Range: all time / this year / last 12 months / this month / last 7 days / custom | Scope: whole library / current view / a playlist |
| Facet chips pushed by the drill-down (artist, genre, album) | Genre facet |
| Owned · Loved toggles | — |

**The range persists in `settings`**, the way a column layout does. **The drill
path does not** — that is what history is for.

## A plays table is not a `SongTable`

Its rows are plays, and it needs no selection, no drag, no column config and no
row menu. Separate, small, virtualized. Rule of three is nowhere near met.

*Open, and decided here:* **CSV export mechanics** — whether a panel's row export
reuses `export/`'s generator and `export://progress` or gets a smaller path of
its own. This phase has the first export to shape it; 84 then has an answer
rather than a question.

Testing: history unit tests for the new field — `sameView` over two paths, a
re-click asserted not to record, Back asserted to walk a drill-down. A component
test for the tab switch and the range persisting. e2e screenshots for both tabs,
empty of panels but framed.
