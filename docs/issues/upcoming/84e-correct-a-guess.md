# 84e — Correct a guess

The override editor behind [84d](../done/84d-a-genre-is-a-guess.md)'s donut. The
Statistics view's only writer, and the first command pair over `db::genres`.

`set_override` and `clear_override` already exist and are unreachable: neither
has a command and nothing in `invoke_handler` names them.

## Both refusals live in `set_override`

Not in the command, so no caller can skip either.

- **An override that makes a genre its own ancestor is refused.**
  `Tree::lineage` returns the resolved label at index 0, so
  `lineage(parent).contains(normalize(label))` catches a genre named as its own
  parent and a deeper loop with one condition. `lineage` survives a cycle by
  stopping at a label it has seen, but the donut would draw a loop and 84d's
  subtree filter would return the wrong members.
- **An unknown parent is refused with something to say.**
  `genre_overrides.parent` has a foreign key into `genres` and
  `foreign_keys` is ON, so without this the failure is a constraint violation
  naming neither the genre nor the label that was typed.

**The field stays free text, and the refusal is the guard.** The app already
has this control — `TagCombobox` — and its doc comment is an argument for free
text: a value the library has never seen has to be typeable, and nothing is
filled in without a deliberate Enter, Tab or click. A strict picker here would
be a second component, or a mode on that one that contradicts what it says
about itself. The cure for a useless error is a useful error, which is where
the cycle check was already going.

Clearing an override is `clear_override`, which is not the same act as setting
it to no parent: one forgets a correction, the other is the correction "this
genre is a root".

## The suggestions match the way the other ones do

`tag_values::suggest` matches anywhere in the value and **ranks prefix matches
first**, escaping `%` and `_` so a label containing either is not a wildcard.
The genre labels take the same rule rather than the plain prefix query: typing
`metal` should offer `black metal`, and two autocompletes in one window that
filter by different rules is a papercut.

`genres` has no `uses` column, so the rank is the prefix match and then the
label. One command, `limit`ed, off the IPC thread like the aggregates.

## Where it opens from

84d's donut has no control that opens one — a slice drills and that is all. It
opens from the Genres panel's `StatsPanel` action, the slot `ReleaseYears` and
`WorstByBitrate` already use.

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
after it — including the degenerate case of a genre named as its own parent.
An unknown parent asserted refused there too, rather than reaching the foreign
key. The suggestions asserted to rank a prefix match above a match in the
middle, and to honour their limit. The editor asserted to re-parent a genre and
the donut asserted to redraw from it without a `library://changed`.
