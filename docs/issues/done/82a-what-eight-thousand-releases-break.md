# 82a — What eight thousand releases break

Two defects [82b](../upcoming/82b-the-unattended-lookup-pass.md) would walk straight into,
neither visible at the ten releases a hand-driven lookup does. Independent of
the pass and of each other, so they land first and alone.

## `library://changed` is a re-query per release

[62](62-one-invalidation-channel.md) debounces both subscribers at
`INVALIDATE_DEBOUNCE_MS`, 250ms, and that window was tuned for a burst — a scan
committing in a tight loop. A lookup pass commits one release roughly every two
seconds for four and a half hours, which is wider than the window, so **every
ping fires a full re-query of the open view and a playlist recount**. 8,044 of
them. Debouncing harder in the frontend is the wrong end: the events are already
isolated by the time they arrive.

So it coalesces on the emit side, in `announcing`/`announcing_with` — one place,
which means every long write after this one inherits it, [83b](../upcoming/83b-moving-one-release.md)
included. Two constraints on the window:

- **Trailing edge, always.** A leading-edge throttle drops the final ping and
  leaves the view one release behind for as long as it stays open.
- **Seconds, not milliseconds.** The frontend debounce still runs underneath,
  so the two compose; the backend window is what decides how stale the view is
  allowed to be during a long pass.

*Settled:* **5s, and the leading edge is kept.** "Trailing edge, always" is
read as "the trailing ping must always fire", not "never fire on the leading
edge" — a trailing-only throttle would put the whole window in front of every
ordinary edit, and 62 already called the frontend's 250ms the one visible
behaviour change. So an isolated write is announced at once, and a run is
announced once per window, the trailing ping opening the next window rather
than leaving the next writer to take a leading edge.

5s because the range's low end buys nothing: the pass commits about every 2s,
so a 2s window coalesces roughly nothing and 3s takes 8,044 pings to ~5,400,
where 5s takes them to ~3,200. Provisional until 82b exists to measure against.

## `tag_undo` is unbounded, and Undo stops meaning what it says

One row per track, one batch per release. A first pass leaves **65,535 rows in
8,044 batches** and nothing ever trims them: `undo_last` deletes only the batch
it restores. Three separate problems fall out of that, and the third is the one
that bites:

- The table grows without limit from this phase on.
- `can_undo` is `count(*) > 0`, so Edit ▸ Undo is enabled forever.
- `undo_last` takes `max(batch_id)`, so after a pass **Undo reverts whichever
  release the pass happened to write last** — not the user's own last edit,
  which is now buried under thousands of batches with no way back to it.

### The cap

The last N batches, trimmed in the same transaction as the insert. One
statement. But it interacts with something:

**`batch_id` is derived from `count(*) FROM tag_undo`** —
`now * 1000 + count(*)`. Trimming shrinks that count, so two batches inside the
same second can be handed the same id, or a later batch an id below an earlier
one, and `max(batch_id)` then undoes the wrong thing. The derivation has to
become monotonic — `max(batch_id) + 1` floored at `now * 1000`, or a counter
that does not depend on the table's height — **and that change belongs with the
cap, not after it.**

*Settled:* the cap is 50 and the unattended write is **not** journalled — a
decision 82b carries out, since there is no unattended writer yet.

Both readings hold. Journalling it means an automatic mistag is takeable-back,
which is the whole appeal. Not journalling it means Undo keeps meaning "the last
thing I did", which is what the word promises and what the menu item is beside.

The recommendation is **not to journal it**, and to cap the journal anyway. A
cap makes the first reading a false promise regardless — only the last N of
8,044 batches would be revertible, and which N is an accident of when the user
looks. What actually protects the user from a bad automatic write is 82b's
threshold and 82c's review queue, not a journal that cannot hold the pass.
Decide before 82b writes its first file; N is a decision either way and 50 is
enough for a session's manual editing.
