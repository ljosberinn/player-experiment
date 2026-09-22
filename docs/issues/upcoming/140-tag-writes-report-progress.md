# 140 — Tag writes report progress

"Writing n of n…" jumps from 0 to the total. Replace it with real progress,
drawn as a bar at the foot of the dialog.

**Cause.** `tags::write::apply` emits `tags://progress` once before the first
file, every `PROGRESS_INTERVAL` (25) files, and once after the last
([write.rs:720](../../../src-tauri/src/tags/write.rs#L720),
[write.rs:752](../../../src-tauri/src/tags/write.rs#L752),
[write.rs:56](../../../src-tauri/src/tags/write.rs#L56)). A release is almost
always under 25 files, so the only events are `0` and `total`. The frontend
reads every event; nothing is dropped there. After `total` the batch still runs
a whole-library `tag_values::rebuild` and `plays::resolve` in one transaction
([write.rs:760](../../../src-tauri/src/tags/write.rs#L760)), so the readout
also sits at "n of n" for that.

**Backend.** Emit every `max(1, total / 100)` files instead of every 25: per
file for a release, at most ~100 events for a 65k-track bulk edit. Keeps the
`0` and `total` events. Both senders go through `apply` —
`tagsource_apply` and `write_tags` via `apply_to_each`
([commands/mod.rs:946](../../../src-tauri/src/commands/mod.rs#L946),
[commands/mod.rs:585](../../../src-tauri/src/commands/mod.rs#L585)) — so both
dialogs get it.

**Frontend.** Both dialogs that draw the readout move it into the footer's
`lead` as a `TaskLine` (headline, no estimate, `done / total`;
[TaskLine.tsx](../../../src/components/primitives/TaskLine.tsx)) while writing:

- Lookup: the pane's note stops saying "Writing…"
  ([ReleaseLookup.tsx:418](../../../src/features/tagsource/ReleaseLookup.tsx#L418));
  the lead swaps its disabled Back to Results / Search again for the line
  ([ReleaseLookup.tsx:147](../../../src/features/tagsource/ReleaseLookup.tsx#L147)).
- Tag editor: replaces the `DialogStatus` text
  ([TagEditor.tsx:234](../../../src/features/editor/TagEditor.tsx#L234)).

At `done === total` the headline reads "Updating the library…" with the rail
full, covering the transaction. `total === 0` reads "Writing…" with an empty
rail. `apply` seeds `{ done: 0, total: edits.length }`
([store.ts:402](../../../src/features/tagsource/store.ts#L402)), but the
backend's total also counts the release's unselected files that only get the
identifiers ([commands/mod.rs:992](../../../src-tauri/src/commands/mod.rs#L992)),
so the denominator changes on the first event — seed `total: 0` instead.

Tests: a Rust test on `apply` for the emission sequence (small batch per file,
large batch bounded), like `export`'s
([export/mod.rs:663](../../../src-tauri/src/export/mod.rs#L663)); the
`ReleaseLookup` and `TagEditor` tests read the line from the footer
([TagEditor.test.tsx:592](../../../src/features/editor/TagEditor.test.tsx#L592)).
`docs/knowledge/frontend.md` on `tags://progress`.

Stacks on 139; both rework the lookup dialog's footer and CSS.

## Verification

- Applying a 12-track release steps the bar and the count file by file.
- A bulk edit of a few thousand tracks moves smoothly and the window stays
  responsive.
- After the last file the line reads "Updating the library…" until the dialog
  moves on.
- The lookup's denominator does not change mid-write.
