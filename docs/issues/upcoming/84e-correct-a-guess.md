# 84e — Correct a guess

The override editor behind [84d](84d-a-genre-is-a-guess.md)'s donut. The
Statistics view's only writer, and the first command pair over `db::genres`.

`set_override` and `clear_override` already exist and are unreachable: neither
has a command and nothing in `invoke_handler` names them.

- **An override that makes a genre its own ancestor is refused**, in
  `set_override` rather than in the command, so no caller can skip it. The
  check runs against the tree with the overrides already applied —
  `Tree::lineage(parent)` must not contain the normalised label, and the
  degenerate case is a genre named as its own parent. `Tree::lineage` survives
  a cycle by stopping at a label it has seen, but the donut would draw a loop
  and 84d's subtree filter would return the wrong members.
- **The parent field cannot be free text.** `genre_overrides.parent` has a
  foreign key into `genres`, so an unknown parent is a failed write with
  nothing useful to say. The editor picks from the 6,575 known labels, which
  needs a prefix query — one command, `limit`ed, off the IPC thread like the
  aggregates.
- Clearing an override is `clear_override`, which is not the same act as
  setting it to no parent: one forgets a correction, the other is the
  correction "this genre is a root".

## An override changes every genre-filtered aggregate

Not just the donut. The write bumps a version in `statsStore` that
`useLibraryQuery` lists as a dependency; a `library://changed` would be a lie,
since no track row moved.

**`useLibraryQuery` is the only site that needs it.** Base UI unmounts the
inactive tab — `StatisticsView` says so — and the editor lives on Library, so
the Listening panels remount and re-query on their own. Listing the version in
each panel's `usePanelQuery` by hand is fifteen edits and the failure
`useLibraryQuery`'s own doc comment exists to prevent.

## Testing

A cycle asserted refused in Rust, at `set_override`, with the tree unchanged
after it. The prefix query asserted to match on a normalised prefix and to
honour its limit. The editor asserted to re-parent a genre and the donut
asserted to redraw from it without a `library://changed`.
