# 82a — What eight thousand releases break

A defect [82b](82b-the-unattended-lookup-pass.md) would walk straight into, and a
feature it would make absurd — neither visible at the ten releases a hand-driven
lookup does. Independent of the pass and of each other, so they land first and
alone.

## `library://changed` is a re-query per release

[62](../done/62-one-invalidation-channel.md) debounces both subscribers at
`INVALIDATE_DEBOUNCE_MS`, 250ms, and that window was tuned for a burst — a scan
committing in a tight loop. A lookup pass commits one release roughly every two
seconds for four and a half hours, which is wider than the window, so **every
ping fires a full re-query of the open view and a playlist recount**. 8,044 of
them. Debouncing harder in the frontend is the wrong end: the events are already
isolated by the time they arrive.

So it coalesces on the emit side, in `announcing`/`announcing_with` — one place,
which means every long write after this one inherits it, [83b](83b-moving-one-release.md)
included. Two constraints on the window:

- **Trailing edge, always.** A leading-edge throttle drops the final ping and
  leaves the view one release behind for as long as it stays open.
- **Seconds, not milliseconds.** The frontend debounce still runs underneath,
  so the two compose; the backend window is what decides how stale the view is
  allowed to be during a long pass.

*Open:* the window length. A number picked here is a guess until the pass
exists to feel it against — reasonable range is 2–5s, and the honest way to
settle it is to run 82b and watch.

## Undo goes

One row per track, one batch per release. A first pass leaves **65,535 rows in
8,044 batches** and nothing ever trims them: `undo_last` deletes only the batch
it restores. `can_undo` is `count(*) > 0`, so Edit ▸ Undo Tag Edit is enabled
forever, and `undo_last` takes `max(batch_id)`, so after a pass it reverts
**whichever release the pass happened to write last** — not the user's own last
edit, which is buried under thousands of batches with no way back to it.

Capping the journal fixes none of that honestly: only the last N of 8,044
batches would be revertible and which N is an accident of when the user looks,
so the menu item goes on promising what it cannot do. **The feature should never
have shipped.** It is one level, it is not itself undoable, and it stopped
restoring artwork the moment `covers` became a 500px re-encode — an edit that
replaced or removed a picture has been silently untakeable-back for phases. What
protects the user from a bad automatic write is 82b's threshold and
[82c](82c-the-review-queue-and-progress.md)'s review queue, not a journal that
cannot hold the pass anyway.

So the whole thing comes out, not its growth.

### What comes out

Backend: `tag_undo` and its index; `undo_tag_edit` and `can_undo_tag_edit`, the
`tags.undo` and `tags.can_undo` log ops and the `ScanLock` they take;
`undo_last`, `can_undo`, `TagSnapshot`, `snapshot`, the `batch_id` derivation
and the insert. Frontend: `canUndo`, `undo` and `refreshUndo`, Edit ▸ Undo Tag
Edit with the two menu parameters behind it, and `App`'s refresh on mount and
after a removal. `tags://progress` drops to two senders, a save and the pass.

**A save stops reading every file back before writing it.** `snapshot` is a full
lofty read per file, taken only to fill the journal.

**Migration 3 is deleted, not emptied.** `MIGRATIONS` goes from nine entries to
eight and 4–9 renumber to 3–8, so the schema reads as though the journal never
existed — which is the point of doing it now rather than living with a dead
table. Two consequences, both accepted at pre-v1:

- Every existing library sits at `user_version` 9, and `migrate` refuses it —
  *"database is at version 9, but this build only knows 8."* The file is deleted
  and the library rescanned by hand. There is no drop statement and no rebuild
  path in the app.
- Every migration number in prose moves: the table in
  [data-model.md](../../knowledge/data-model.md), the index
  [87](87-one-release-one-tile.md) says shipped in migration 9, and the comments
  in `db/covers.rs` and `scan/mod.rs` that name one.

**Edit with nothing selected is left holding only Settings…** — whether the menu
keeps a separator around it is decided when the item comes out, not here.

Three documented judgements describe something that no longer exists and go with
it: *Undo does not restore artwork* and *The undo journal is unbounded* in
[limitations.md](../../knowledge/limitations.md), *Undo is one level and is not
itself undoable* in [conventions.md](../../knowledge/conventions.md), and the
"nothing to undo" precondition in [design.md](../../knowledge/design.md).

Testing: the undo tests in `tags::write` are deleted rather than adapted; a fresh
database asserted to reach `user_version` 8 with no `tag_undo`; a batch write
asserted to touch the files and the rows it always did and nothing else.
