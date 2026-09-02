# 71 — Watch folders actually watch

The table is called `watch_folders` and nothing watches. A folder is a scan
root, and a scan happens when the user picks File ▸ Rescan or presses F5.

**Poll, on a timer, reusing `scan()`.** It is already incremental by
`(mtime, size)`, so a pass that finds nothing costs a directory walk and
`load_known`'s 65,535 rows, and no tag reads at all.

Not `notify`/ReadDirectoryChangesW. A live event stream drops events on network
and removable volumes, sees nothing that happened while the app was closed, and
so needs the full walk on startup regardless — it would be a second code path
that does not replace the first.

**The timer is a `library-watch` thread**, the same shape as `watch_output` in
`audio/mod.rs`: its own named thread, sleeping in short units and reading the
interval from `settings` each wake, so changing it in Settings applies without a
restart and needs no channel. Not a webview `setInterval` — WebView2 throttles
timers in a hidden window, which is exactly when a background pass is wanted,
and the exclusion below has to be Rust-side either way.

**One pass shortly after launch**, then on the interval. That is what makes a
poll a replacement rather than an addition: nothing else notices what changed
while the app was closed, and there is no scan at startup today.

**Exclusion needs a lock, and there is none.** `busy` in `scan.ts` is frontend
state, and `undo_tag_edit` is not behind it at all. Managed state — a
`Mutex<()>` alongside `Db`, poison-tolerant, since a panicking scan must not
disable scanning for the rest of the session — taken by `scan_library`,
`undo_tag_edit` and the poll. The poll `try_lock`s and skips the pass entirely;
a user-asked scan waits for it, because a Rescan that silently does nothing is
worse than one that starts a walk late. [82](82-lookup-runs-itself.md)'s lookup
and [83](83-the-library-folder.md)'s mover take it too when they land — those
chain off an ingest rather than racing it.

**A root that is not there must be skipped, not walked.** `walk` on a missing
root yields nothing, and `plan` then marks every track under it missing. That is
correct when the user asked for a scan and ruinous on a timer: unplug the
external drive and 65,535 tracks quietly go missing, on their own, while nobody
is looking. So the poll filters roots by existence first, and a root that is
gone contributes nothing to that pass — neither its files nor their absence. A
manual Rescan keeps today's behaviour: the user asked for the answer, and those
marks are what feeds Remove Missing.

`scan()` reads its own roots through `watch_folders(conn)`, so the roots become
a parameter — `scan()` stays the every-root entry point the tests and
`scan_library` call, and the poll passes the filtered list.

**A poll that changed nothing says nothing.** No `library://changed`, no scan
bar. A success the user did not ask for is as quiet as a failure they did not,
and a failure of one goes to the log rather than the error popover. That rules
out going through `scan_library`: it announces unconditionally, and `scan()`
emits a progress event before it knows whether there is work and another when it
is done, which is enough to flash "Scanning 0 of 0". The poll passes its own
`on_progress` that swallows events while `total` is 0, and announces only when
`added + updated + missing + returned` is non-zero.

**Interval in Settings.** `library.watchInterval`, minutes, beside the zoom
factor; Off / 5 / 15 / 30 / 60, defaulting to 15 when unset or unparseable the
way `settings::volume` does. Off stops the pass, not the thread.

**Nothing lists the watch folders.** "Add Folders…" adds them and there is no
way to see or remove one. A folder that is re-walked every quarter of an hour
needs both, so Settings gains the list with a remove per row.
`remove_watch_folder(path)` deletes that row and nothing else: its tracks stay
until a scan does not find them and marks them missing, which is the path that
already exists rather than a second kind of removal. The row has to say so,
since it is the unattended pass that will do the marking.

Surface: `remove_watch_folder`, `load_watch_interval`, `save_watch_interval`
next to `load_zoom`/`save_zoom`, with wrappers in `src/ipc/index.ts`. No
`#[derive(TS)]` type changes, so no bindings churn, and own commands need no
capabilities entry.

Worth a test each in `src-tauri/tests/scan.rs`: a pass over an absent root marks
nothing while a manual scan over that same root marks everything; a pass that
finds nothing reports no progress and does not announce; a pass skips while the
lock is held. Frontend: the folder list renders and removes, and the interval
round-trips.

`scan/mod.rs`'s header and architecture.md both say scanning is explicit rather
than filesystem-watched, and limitations.md wants the entry the output-device
poll already has: a change is noticed within the interval, not when it happens.
