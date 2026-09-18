# 80 — The Statistics view

The shell the panels hang in, and the one tile row per tab that proves it works:
the sidebar item becomes a destination, two tabs, the filter bar, and drill state
in history. The charts are [84a](../upcoming/84a-what-you-have-heard.md) and
[84b](../upcoming/84b-what-you-own.md). Stacks on
[70](70-chart-primitives.md), [77](77-the-stats-query-layer.md) and
[78](78-import-the-lastfm-history.md), whose `loved` filter the bar draws.

**Two tabs, because the two questions have nothing in common but a chart
library.** Listening is what you have heard; Library is what you own.

## The tiles land here

[70](70-chart-primitives.md) wrote the rule and then obeyed it against its own
list: **each primitive lands with a caller or it does not land**, which is why
`Bar`, `Line`, `Donut` and `Heatmap` are not in the tree. A filter bar with
nothing to filter, a plays table with no rows and a CSV export with nothing to
export are that same thing one level up, and
[77](77-the-stats-query-layer.md) left its `ipc/index.ts` wrappers to land with
their callers, which a shell alone does not supply.

So the shell takes the two tile rows with it. `listen_totals` and
`library_totals` are one query each, `StatTile` shipped in 70, and they are the
only panels in the plan that need no primitive 70 declined to build. They are
also what makes the filter bar demonstrable: the range moves the Listening
numbers, the scope moves the Library ones. **84a and 84b lose their `Tiles:`
line** and keep their charts.

The plays table goes with 84a and `recent_plays`. CSV export is answered below
and built there.

## `ViewTab` gains `"stats"`

Statistics becomes a sidebar item like Songs — the same act, the same highlight
— and the placeholder in
[LibraryNav.tsx](../../../src/components/ui/LibraryNav.tsx) loses its
`disabled`, as does the assertion on it in `chrome.test.tsx` and the
`.sidebar-item:disabled` note in `App.css`. The icon registry's `statistics`
entry is renamed `stats`, because `LibraryNav` maps a `ViewTab` straight onto an
icon name and one alias in that map would be one alias to explain.

`ViewTab` is `"songs" | BrowseKind` today, so widening it is not free: every
`Record<ViewTab, …>` — `VIEW_TITLES` among them — gains an entry, and the places
treating a non-`"songs"` tab as a `BrowseKind` are found rather than assumed
absent. They are `loadGroups`, which would ask `browse_groups` for a grouping
that does not exist, `App`'s two `tab !== "songs"` branches, and
`viewSummary`, which as written falls through to its `genres` arm and reports
"No genres" under the Statistics view.

Statistics has nothing to count in the footer that it does not already say in
letters twice the size, so `viewSummary` returns an empty string for it.

## Navigating inside Statistics does not touch the library

`applyEntry` ends in `refresh()`, and `refresh` is a `library_stats` over the
open query plus a `browse_groups` for the tab. Left alone, entering Statistics
and then every donut slice and every breadcrumb would re-count 150k rows to
render nothing that reads the result.

So a stats entry takes a short path: `applyEntry` writes the history, the tab
and the path, and returns. **`refresh` is also a no-op while Statistics is
open**, because `library://changed` fires throughout an import and a resolve;
what it would have recomputed is recomputed on the way out, where `applyEntry`
takes its ordinary path — including `loadColumns` when leaving across a
playlist boundary, which entering Statistics from a playlist crosses.

## Drill state in history

Drill state does not fit `HistoryEntry`'s `browse: BrowseFilter | null`, so the
entry gains a field:

```ts
export type StatsTab = "listening" | "library";

/** One step of the drill-down: a slice, a bar, the thing clicked. */
export interface StatsCrumb {
  readonly kind: "artist" | "genre" | "album";
  readonly key: string;
}

export interface StatsPath {
  readonly tab: StatsTab;
  readonly crumbs: readonly StatsCrumb[];
}

export interface HistoryEntry {
  readonly tab: ViewTab;
  readonly browse: BrowseFilter | null;
  readonly playlistId: number | null;
  readonly stats: StatsPath | null;
}
```

**The Listening/Library choice is the root of the path, not state beside it.**
Held apart it would be the one navigation Back does not walk, and the tab a
drill-down belongs to would not travel with it.

`sameView` compares the path element-wise, so Back and Forward walk a genre
drill-down for free and `record`'s dedupe stops a re-click pushing a duplicate —
the treatment `browse` already gets.

**The path is library-store state**, `statsPath`, beside `browse` and named
apart from the `stats: LibraryStats` already there. History lives in that store
for a reason it states at the field: *a second store holding a copy of `tab`,
`browse` and `playlistId` would drift out of step with the ones the view
actually reads*. A path owned by `statsStore` and recorded in `HistoryEntry`
would be that drift, one field later. It costs `App` nothing — `App` subscribes
to `tab`, not to the path, and `StatisticsView` subscribes for itself.

**Clicks drill inside Statistics.** A donut slice narrows to its children, an
artist bar opens that artist's page, a breadcrumb walks back. Leaving for the
Songs table is a separate, explicit action — "Show these 412 songs" — so the
first click cannot end the exploration. Clicking Statistics in the sidebar while
already drilled in is a no-op, which is the rule the browse tabs already follow;
the breadcrumb is the way out.

## Filter state lives in its own `statsStore`

In the library store a range change would wake every library subscriber, and
[CLAUDE.md](../../../CLAUDE.md) says as much. `App` branches on `tab === "stats"`
and renders `StatisticsView`, which takes no props; ranges, facets and loaded
aggregates are subscribed inside the panels that draw them — the lesson
[frontend.md](../../knowledge/frontend.md) already paid for with `positionMs`
and `selection`.

The filter bar's contents follow the tab, because the subjects differ:

| Listening | Library |
| --- | --- |
| Range: all time / this year / last 12 months / this month / last 7 days / custom | Scope: whole library / current view / a playlist |
| Owned, Loved | Genre facet |

Both of those are three-state and therefore selects rather than toggles: "either"
is the default and the most common answer, so it has to be reachable. **The
drill-down's facet chips are 84a's**, with the panels that push one; the path
already narrows the query, which is what this phase owes them.

**The drill path does not persist** — that is what history is for. **The filters
do**, under one `stats.filters` key holding opaque JSON, which is what
`sidebar.sections` and `library.columns` already do and for their reason: which
filters exist is the frontend's business, and a settings constant with a command
pair and an IPC wrapper per filter would be three things to add every time 84a
or 84b grows a facet. It stays off `EXPORTABLE`, where `library.columns` and
`sidebar.sections` already are: an export is a copy of a library, and where its
statistics were last filtered is a view of one.

## CSV export, answered here and built in 84

`export/` is a Rust-side JSON writer over an `ExportScope` reporting on
`export://progress`, because it walks the whole library a page at a time. A
panel's export is the opposite in every dimension: forty rows the frontend has
already fetched and drawn. Reusing that path would mean a second scope kind and
a second query for rows already in hand, to report progress on a write that
takes no time.

So the answer is a small frontend path — rows to a string, the shell's save
dialog, `safeFileName` from [scope.ts](../../../src/features/export/scope.ts) —
and it lands with the first panel that exports, which is 84b's albums by mean
bitrate. Deciding it here is what this phase owed; building it here would be a
generator with no rows.

## Not from the design

The design project draws the dimmed sidebar placeholder and no Statistics
screen. The shell is therefore built from chrome that exists — the view heading
the browse tabs use, the sidebar item, the existing tokens — and invents no
visual language. Anything a later mockup specifies wins over it.

## Testing

History unit tests for the new field: `sameView` over two paths, over the same
crumbs under different tabs, a re-click asserted not to record, Back asserted to
walk a drill-down. Store tests that entering Statistics and drilling inside it
issue no library query, and that leaving it issues one.

A component test for the tab switch, for the tiles reading their aggregate, for
the tab nobody is looking at asserted not to query, and for the view opening on
the range it was left on. e2e screenshots for both tabs, after `library`, which
seeds the songs the Library tab counts — the Listening tab is empty in that build
and its empty state is the thing worth photographing there.

`xx-statistics-view.md` goes with this phase: it existed to say why the item was
dimmed.
