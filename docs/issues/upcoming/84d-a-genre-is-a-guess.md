# 84d — A genre is a guess

The genre donut, its drill-down and the override editor behind it. Split from
[84b](84b-what-you-own.md), which is the Library tab's reads; this is the
Statistics view's only writer. Stacks on
[75](../done/75-the-genre-tree.md) for the tree and on
[84b](84b-what-you-own.md) for `useLibraryQuery` and the tab it hangs in.

`Donut` and `d3-shape`, which nothing has needed yet: `scales.ts` is the only
file allowed to import it, and an arc generator is the first thing to want it.

## The drill has to narrow the tab, and cannot yet

On the Listening tab a crumb narrows every panel, because `listenQuery` puts it
in `ListenQuery.genre`, which walks the tree. The Library tab has no such
field. Its genre facet is `browse: { kind: "genres", key }`, an exact match on
the raw `tracks.genre` string, so a crumb holding a resolved label — `popular
music`, which no file is tagged with — would match nothing.

**So `TrackQuery` gains a genre-subtree filter** and `query::scope` gains the
one condition, the same `json_each` over resolved members that
`stats::genre_members` already builds for `ListenQuery`. A genre crumb then
narrows the bitrates, the years and the tag health the way an artist crumb
narrows the Listening tab, and the breadcrumb means one thing in both tabs.

The facet and the crumb are one slot: the deepest genre crumb wins, and with no
crumb the facet is what fills it.

## The donut

A slice drills to its children through [75](../done/75-the-genre-tree.md)'s
`genres.parent`, which `genre_breakdown` already walks; the crumb is the level.
A slice whose parent was guessed from the label's suffix is **labelled as
derived** — `GenreSlice.parentSource` carries it — so a wrong guess is visible
and fixable rather than trusted. The primary-parent rule is arbitrary by
construction and the override is what corrects it.

`genre_breakdown` also returns `own` and `untagged`, which are the two slices
that are not children: tracks tagged with the drilled genre itself, and tracks
tagged with nothing.

## The override editor

The only writer of `genre_overrides`, and the first command pair over
`db::genres`.

- **An override that makes a genre its own ancestor is refused**, in
  `set_override` rather than in the command, so no caller can skip it.
  `Tree::lineage` survives a cycle by stopping at a label it has seen, but the
  donut would draw a loop and the subtree filter would return the wrong
  members.
- **The parent field cannot be free text.** `genre_overrides.parent` has a
  foreign key into `genres`, so an unknown parent is a failed write with
  nothing useful to say. The editor picks from the 6,575 known labels, which
  needs a prefix query — one command, `limit`ed, off the IPC thread like the
  aggregates.
- Clearing an override is `clear_override`, which is not the same act as
  setting it to no parent: one forgets a correction, the other is the
  correction "this genre is a root".
- **An override changes every genre-filtered aggregate**, not just the donut.
  The write bumps a version in `statsStore` that every panel's `usePanelQuery`
  lists as a dependency; a `library://changed` would be a lie, since no track
  row moved.

## Testing

Geometry, not pixels: arc `path` command strings against a fixed measured size,
single-slice and empty inputs where the arc collapses. The override editor
asserted to re-parent a genre and the donut asserted to redraw from it. A cycle
asserted refused in Rust, at `set_override`, with the tree unchanged after it.
A genre crumb asserted to reach `TrackQuery` and to beat the facet.

e2e screenshot of a drilled donut, over the fixture library rather than the
synthetic one: `Ambient`, `Downtempo` and `Modern Classical` resolve through
the real tree and the synthetic `Genre00`–`Genre19` resolve through none of it,
so the drill only exists over the six real files.
