# 140 — Tag writes report progress

"Writing n of n…" jumps from 0 to the total. Replace it with real progress,
drawn as a bar at the foot of the dialog.

**Cause.** `tags::write::apply` emitted `tags://progress` once before the first
file, every 25 files, and once after the last. A release is almost always
under 25 files, so the only events were `0` and `total`. After `total` the
batch still runs a whole-library `tag_values::rebuild` and `plays::resolve` in
one transaction, so the readout also sat at "n of n" for that.

**Backend.** Emit every `ceil(total / 100)` files: per file for a release, at
most 100 events after the first for any batch. The last file always emits,
replacing the separate post-loop event. Both senders go through `apply` —
`tagsource_apply`, and `write_tags` via `apply_to_each` — so both dialogs get
it.

**Frontend.** Both dialogs draw the readout in the footer's `lead` as
`editor/WriteLine`, a `TaskLine` (headline, no estimate, `done / total`) while
writing:

- Lookup: the pane's note stops saying "Writing…"; the lead swaps Back to
  Results / Search again for the line.
- Tag editor: replaces the `DialogStatus` text.

At `done === total` the headline reads "Updating the library…" with the rail
full, covering the transaction. No progress, or `total === 0`, reads
"Writing…" with an empty rail. The lookup's `apply` seeds no progress: the
backend's total also counts the release's unselected files that only get the
identifiers, so a seeded `edits.length` changed on the first event.

Tests: `tests/tagwrite.rs` pins a small batch to per file and the 120-file
batch to at most 101 events; the `ReleaseLookup` and `TagEditor` tests read the
line from the footer. `docs/knowledge/frontend.md` on `tags://progress` and the
footer's `lead`.

## Verification

- Applying a 12-track release steps the bar and the count file by file.
- A bulk edit of a few thousand tracks moves smoothly and the window stays
  responsive.
- After the last file the line reads "Updating the library…" until the dialog
  moves on.
- The lookup's denominator does not change mid-write.
