# Tag edits and export block the window

Both build their whole work on the IPC thread:

- **Tag edits are single-threaded.** 500 files are written one after another,
  with no progress in the dialog, and the window sits still for a large batch.
- **Export builds the whole document in memory** on the same thread, so a large
  library does the same thing at the moment the user picks a filename.

Both want the treatment scanning already has: `spawn_blocking` plus a progress
event, and a dialog that can be watched rather than one that appears hung.

The failure-reporting rule stays as it is: one bad file is counted and reported,
the rest are written, and failures are not journalled so undo will not try to
restore them.

Not urgent at the library sizes in use — worth doing before anyone bulk-edits a
whole collection.
