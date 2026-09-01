# 61 — One error channel instead of six

`set({ error: String(cause) })` appears twenty-seven times across six stores -
library, playlists, editor, player, scan and updater - each in its own
`try`/`catch` around an `ipc` call. The shell then reassembles them: `problem`
picks the first of five, `dismissProblem` clears all five, and `App` holds ten
subscriptions to do it (`App.tsx`). A seventh store means a seventh field, an
eleventh subscription and an edit to the merge.

Notices are the same shape one size smaller: `playlists.notice`,
`editor.notice` and `App`'s own `toolbarNotice` are merged into one line, with
two identical `NOTICE_MS` timers in `App` to expire two of them.

One `useStatusStore` with `report(cause)` and `notify(text)`, owning the timer
and the one-at-a-time rule, removes the merge, both timers and ten
subscriptions, and gives the next feature store both surfaces for free.

To decide:

- **What reports.** A zustand middleware, a wrapper around the `ipc` module, or
  plain calls in the catches. The wrapper is the only one that cannot be
  forgotten, and the only one that cannot tell a failure worth a popover from
  one worth nothing.
- **The catches that deliberately say nothing.** `loadColumns`, `loadSections`
  and `toggleSection` swallow on purpose - nothing the user did has failed and
  the defaults work. Whatever reports has to keep that possible without making
  silence the easy path.
- **Where per-store error state is still read.** `playerError` and the rest are
  currently only read by the shell; confirm before removing the fields.
- Whether the store keeps a queue or a single slot. The current behaviour is a
  slot that five sources overwrite, and dismissing clears all five rather than
  uncovering the next - deliberate, and worth keeping as written.
