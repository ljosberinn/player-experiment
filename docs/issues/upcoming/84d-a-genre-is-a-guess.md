# 84d — A genre is a guess

The genre donut and its drill-down. Split from
[84b](../done/84b-what-you-own.md), which is the Library tab's reads. The
override editor that makes the guess fixable is [84e](84e-correct-a-guess.md),
which stacks on this.

Stacks on [75](../done/75-the-genre-tree.md) for the tree and on
[84b](../done/84b-what-you-own.md) for `useLibraryQuery` and the tab it hangs
in.

**The aggregate already exists.** `stats::genre_breakdown`, `GenreBreakdown`,
`GenreSlice` and `ParentSource` shipped with [77](../done/77-the-stats-query-layer.md)
and [80](../done/80-the-statistics-view.md), and `stats_genre_breakdown` is in
`invoke_handler`. Nothing in `src/ipc` binds it, so the command is unreachable
today. What is missing is the filter the drill needs, the binding, and the
drawing.

`Donut` and `d3-shape`, which nothing has needed yet: `scales.ts` is the only
file allowed to import d3, and an arc generator is the first thing to want this
half of it. **A single 100% slice is a full circle, which one SVG `A` command
cannot express** — that is the collapsing-arc case below, and it is what a
hand-rolled generator gets wrong.

## The drill has to narrow the tab, and cannot yet

On the Listening tab a crumb narrows every panel, because `listenQuery` puts it
in `ListenQuery.genre`, which walks the tree. The Library tab has no such
field. Its genre facet is `browse: { kind: "genres", key }`, an exact match on
the raw `tracks.genre` string, so a crumb holding a resolved label — `popular
music`, which no file is tagged with — would match nothing.

**So `TrackQuery` gains `genre: Option<String>`** — named and meaning what
`ListenQuery.genre` already does, at or below — and `query::scope` gains the
one condition, the same `json_each` over resolved members that `Plays::new`
already builds. A genre crumb then narrows the bitrates, the years and the tag
health the way an artist crumb narrows the Listening tab, and the breadcrumb
means one thing in both tabs.

**`genre_members` moves to `db::genres::members`.** It lives in `db::stats`
today, and `db::stats` imports `db::query`; `scope` calling back into it would
be a back-edge. It is a question about the tree, not about statistics.

### The facet and the crumb are one slot, and one meaning

The deepest genre crumb wins; with no crumb the facet fills it. **Both fill
`TrackQuery.genre`**, so the facet becomes a subtree filter too and `browse:
{ kind: "genres" }` stops being how the Library tab filters genre. Leave the
facet on `browse` and `black metal` in the Genre select means something
different from `black metal` in the breadcrumb, one row apart in the same bar.

The sidebar's Genres browse is untouched: it is a list of tags, and a tile
labelled with a tag should hold that tag's files.

**The "one browse slot" rule in `libraryQuery` goes with it.** A genre now
composes with the view's drill-in rather than replacing it. Asking for one
genre of an album that is not in it returns nothing, which is an answer every
panel already draws — it is the same state a search that matched nothing puts
them in.

### What it costs

`members` is `Tree::load` over four tables, then `SELECT DISTINCT genre FROM
tracks` — **`tracks.genre` carries no index** — then `lineage` per distinct
value. One Listening query pays that today. A Library drill pays it once per
panel, against the 150k rows [31](../done/31-150k-rows.md) fixed the table for.

Measured rather than pre-empted: `perf.rs` pins a genre-filtered `TrackQuery`.
`tag_values` already holds the distinct genres, keyed by `(field, value)`, and
is the lever if the scan is what hurts — but it is a second source of truth for
the same list, so it is not worth taking on a guess.

## The donut

A slice drills to its children through [75](../done/75-the-genre-tree.md)'s
`genres.parent`, which `genre_breakdown` already walks; the crumb is the level.
A slice whose parent was guessed from the label's suffix is **labelled as
derived** — `GenreSlice.parentSource` carries it — so a wrong guess is visible
before [84e](84e-correct-a-guess.md) makes it fixable. The primary-parent rule
is arbitrary by construction.

**Only a slice with `has_children` drills.** The field already ships and is
what says whether there is a level below; a leaf that opened onto nothing but
its own count would be a crumb with no way to tell before pressing it.

`genre_breakdown` also returns `own` and `untagged`, which are the two slices
that are not children: tracks tagged with the drilled genre itself, and tracks
tagged with nothing. Neither is a genre, so neither drills.

**The donut passes `parent` and strips `genre` from its own query.** Its
narrowing *is* the `parent` argument, and carrying both would be a second
`members` call for an identical result — `genre_breakdown` drops what is not
under `parent` anyway. The two must not disagree: with a facet set and
`parent: null` the donut would draw that genre's children at the root level,
`untagged` at zero, with no crumb on screen saying why.

## Testing

Geometry, not pixels: arc `path` command strings against a fixed measured size,
single-slice and empty inputs where the arc collapses.

`scope` asserted to include a tag that resolves into the subtree and to exclude
one that does not. `filters.test.ts`: a genre crumb asserted to reach
`TrackQuery.genre` and to beat the facet, and a genre asserted to compose with
the view's `browse` rather than replace it.

e2e screenshot of a drilled donut, over the fixture library rather than the
synthetic one: `Ambient`, `Downtempo` and `Modern Classical` resolve through
the real tree and the synthetic `Genre00`–`Genre19` resolve through none of it,
so the drill only exists over the six real files.
