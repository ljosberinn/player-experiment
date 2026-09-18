# 84a — What you have heard

The Listening tab's lists and numbers. Stacks on
[78](../done/78-import-the-lastfm-history.md) and
[80](../done/80-the-statistics-view.md); the tab's charts are
[84c](84c-the-shape-of-a-week.md), which stacks on this. Independent of
[84b](84b-what-you-own.md), which is the other tab and now takes the CSV path
from here.

Split off from the plan's single phase 84 for that independence, and because one
phase drawing both tabs is not workable as written.

The tile row went to 80, which needed a caller for the shell it built.

Recent plays; top artists, albums, tracks and genres as bar lists with share;
current and longest streak; and **heard, never owned**, exportable.

An artist bar drills to that artist — and drilling narrows the tab rather than
opening a page. The crumb is already fed into `ListenQuery` by `listenQuery`, so
every panel re-queries narrowed for free; what changes is which panels render,
because an artist's top artist is themselves.

**Which of those earn their place is answered by using them, not by this file.**

## The primitives do not exist

[70](../done/70-chart-primitives.md) landed `scales.ts`, `ChartFrame`, `Tooltip`
and `StatTile`, and declined `Bar`, `Line`, `Donut`, `Heatmap` and `Sparkline`
under its own rule: each primitive lands with a caller or it does not land. So a
panel here is not "a `ListenQuery` and a primitive that both already exist", and
dropping a panel that is a primitive's only caller drops the primitive with it.
That is the seam between this phase and 84c: **84a is `BarList`, 84c is `Bar`
and `Heatmap`.**

Three of `db/stats.rs`'s commands get their `src/ipc/index.ts` wrappers here —
`stats_recent_plays`, `stats_top`, `stats_streaks`. The other three land in 84c
with their callers, which is 70's rule one level up.

## `BarList` is HTML, and is not a `ChartFrame`

An `<ol>` of rows, each a `<button>` where it drills, with the fill width as a
share of the largest value. Names truncate, rows take focus, and a screen reader
gets a list.

**So it does not use `ChartFrame`, and that is deliberate.** `ChartFrame` owns
`role="img"` and the show-as-table toggle so that no chart can ship without
either; a ranked list is already the table, and wrapping it in one `role="img"`
would take away the reading it has. `BarList` owns its own empty and loading
states for the same reason. Every SVG chart still goes through `ChartFrame`, and
all of those are 84c's.

Nothing here touches d3 or draws an element: a share is a percentage.
`scales.ts` gets its first real caller in 84c.

## Panels

- **`usePanelQuery`.** Eight panels would otherwise repeat `ListeningTiles`'
  effect verbatim — fetch, cancel on change, `report` on failure.
  `ListeningTiles` moves onto it. **No request dedupe**: the only query wanted
  twice is `listen_totals`, by the tiles and by the genre panel's caption, and
  one duplicate is not the rule of three.
- **`TopPanel` is one component with four callers.** Artist, album and genre
  rows drill, which is exactly the three `StatsCrumb` kinds `path.ts` has; a
  track row does not, because `ListenQuery` has no track field.
- **A genre panel says what it covers** — "genre known for 84% of plays", from
  `listen_totals` — because genre is only knowable for matched plays and
  reporting a subset as the whole is the failure mode.
- **The plays table is not a `SongTable`.** Its rows are plays: no selection, no
  drag, no column config, no row menu. Its own fixed-height scroll container,
  virtualized, paged through `recent_plays`.
- **Heard, never owned is the point of the residue, not a leftover.** It is a
  shopping list, and it is why plays with no matching file are kept rather than
  discarded at import. It **overrides the filter bar's Owned select rather than
  obeying it**, and says so on the panel: it is the owned=false view.
- Streaks are two numbers, so they are two `StatTile`s and not a chart.
- Every panel subscribes to `statsStore` itself. `App` must not re-render
  because a range changed.

## The CSV path lands here, and needs ten lines of Rust

[80](../done/80-the-statistics-view.md) decided the mechanics and gave them to
84b's first exporting panel. **Heard, never owned exports too, and the two
phases were meant to run in parallel**, so one of them has to own it; this one
is the lower number and lands first. 84b stacks on it.

80 called it "a small frontend path — rows to a string, the shell's save
dialog". The dialog is there and `dialog:allow-save` is already granted, but
**nothing in the frontend can write the bytes**: `@tauri-apps/plugin-fs` is not
a dependency, and adding it means a plugin, a capability and an fs scope over an
arbitrary user-chosen path. So `csv.ts` builds the string and a
`save_text_file` command beside `export_library` writes it — through the logged
command surface, with no new capability.

## Testing

`csv.ts` quoting against a table of cases. `usePanelQuery` cancelled mid-flight
by a dep change. `BarList` fill shares, row order, single-datum and empty.
`TopPanel` asserted to push the right crumb kind. Heard, never owned asserted to
send `owned: false` whatever the filter bar says. An artist crumb asserted to
drop the top-artists panel and narrow the rest.

**The e2e suite has one play to photograph** — `library.test.ts` plays Anchor
for a second, which is the whole of the Listening tab's data. So a
`seed_synthetic_plays` command behind `e2e_only`, the way `seed_synthetic_tracks`
is, calling `synthetic::seed_plays` and then `plays::resolve`: the seeder leaves
`track_id` null, and without resolve the owned share and the shopping list are
both empty. Seeded before the view opens, because 80 made `refresh` a no-op
while Statistics is open. Two thirds of seeded plays match a synthetic track and
one third never do, which is what fills the shopping list for the photograph.
The seeded history ends in 2023, so the current streak reads 0 — true, and not
worth faking.
