# 82a — Undo goes

A feature [82b](82b-the-unattended-lookup-pass.md) would make absurd, invisible
at the ten releases a hand-driven lookup does. Independent of the pass, so it
lands first and alone.

This phase's other half — coalescing `library://changed` on the emit side — has
shipped, in [82a](82a-what-eight-thousand-releases-break.md). Bounding
the journal was tried on that branch and reverted.

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
after a removal. `tags://progress` drops from three senders to one, a save;
82b's pass makes it two again.

**A save stops reading every file back before writing it.** `snapshot` is a full
lofty read per file, taken only to fill the journal.

**Migration 3 is deleted, not emptied.** `MIGRATIONS` goes from nine entries to
eight and 4–9 renumber to 3–8, so the schema reads as though the journal never
existed — which is the point of doing it now rather than living with a dead
table. Three consequences, all accepted at pre-v1:

- **Migrations stop being append-only**, which `db/schema.rs` and
  [data-model.md](../../knowledge/data-model.md) both state as a rule. The rule
  stays — a released build could not do this — so both places record the
  deletion as a one-time exception taken before v1 rather than dropping it.
- Every existing library sits at `user_version` 9, and `migrate` refuses it —
  *"database is at version 9, but this build only knows 8."* The file is deleted
  and the library rescanned by hand. There is no drop statement and no rebuild
  path in the app.
- Every migration number in prose moves: the table in
  [data-model.md](../../knowledge/data-model.md), the index
  [87](../upcoming/87-one-release-one-tile.md) says shipped in migration 9,
  [83a](83a-where-a-file-goes.md)'s reference to migration 9's two MBIDs, and
  the comments in `db/covers.rs` and `scan/mod.rs` that name one.

**Edit with nothing selected is left holding only Settings…** — whether the menu
keeps a separator around it is decided when the item comes out, not here.

Three documented judgements describe something that no longer exists and go with
it: *Undo does not restore artwork* and *The undo journal is unbounded* in
[limitations.md](../../knowledge/limitations.md), *Undo is one level and is not
itself undoable* in [conventions.md](../../knowledge/conventions.md), and the
"nothing to undo" precondition in [design.md](../../knowledge/design.md).
Several more places describe it as machinery rather than as a judgement and are
edited in passing: the module map, the `ScanLock` holders and both event lists in
[architecture.md](../../knowledge/architecture.md), the sender count and the
per-release undoable batch in [frontend.md](../../knowledge/frontend.md), the
Rust integration row in [testing.md](../../knowledge/testing.md), and the
comments in `commands/mod.rs`, `scan/mod.rs`, `db/tag_values.rs` and
`db/covers.rs` that name undo as a caller.

Testing: the undo tests in `tags::write` and `tests/tagwrite.rs` are deleted
rather than adapted, as are the frontend ones — the store's undo cases, the
`ipc` pair, the Edit ▸ Undo menu test, `App`'s "a removal refreshes undo", and
the `canUndoTagEdit` stub every component test carries. Several tests in
`tagwrite.rs` are *about* the write and close with an undo clause — the batch of
per-track edits, the cover-art round trip, both MBID ones — and lose the clause
rather than being deleted. A fresh database asserted to reach `user_version` 8
with no `tag_undo`; a batch write asserted to touch the files and the rows it
always did and nothing else.

Two e2e specs assert the item by name — the Edit menu's contents in
`menus.test.ts` and the row menu in `row-menu.test.ts` — and the
`menubar-edit-with-a-selection` screenshot has it in frame, so it is recaptured.
