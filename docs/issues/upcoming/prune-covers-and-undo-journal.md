# Nothing prunes `covers` or `tag_undo`

Both grow without bound, and both are that way for a reason worth keeping.

- **`covers` is never pruned** because undo references replaced artwork by hash;
  that is what lets it put removed artwork back. Artwork replaced a hundred times
  leaves a hundred rows.
- **`tag_undo` gains a row per track per edit** and nothing trims it, so a
  library edited for years accumulates them.

Both fixes are small and neither is needed yet:

- A vacuum that keeps anything referenced by `tracks` **or** `tag_undo` is safe
  for covers.
- Capping the journal to the last N batches is a one-line delete — but it has to
  run *before* the cover vacuum, or the vacuum's safety argument depends on rows
  the cap is about to remove.

Worth a size readout somewhere first, so the trigger is a number rather than a
hunch.
