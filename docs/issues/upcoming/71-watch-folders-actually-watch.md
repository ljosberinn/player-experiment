# 71 — Watch folders actually watch

The table is called `watch_folders` and nothing watches. A folder is a scan
root, and a scan happens when the user picks File ▸ Rescan.

**Poll, on a timer, reusing `scan()`.** It is already incremental by
`(mtime, size)`, so a poll that finds nothing costs a directory walk and
`load_known`'s 65,535 rows, and no tag reads at all.

Not `notify`/ReadDirectoryChangesW. A live event stream drops events on network
and removable volumes, sees nothing that happened while the app was closed, and
so needs the full walk on startup regardless — it would be a second code path
that does not replace the first.

**A root that is not there must be skipped, not walked.** `walk` on a missing
root yields nothing, and `plan` then marks every track under it missing. That is
correct when the user asked for a scan and ruinous on a timer: unplug the
external drive and 65,535 tracks quietly go missing, on their own, while nobody
is looking. Each root's existence is checked first, and a root that is gone
contributes nothing to that pass — neither its files nor their absence.

**A poll that changed nothing says nothing.** No `library://changed`, no scan
bar. A success the user did not ask for is as quiet as a failure they did not.

Interval in Settings, and skipped while a scan or an undo already holds the
library. [82](82-lookup-runs-itself.md)'s lookup and
[83](83-the-library-folder.md)'s mover join that list when they land — those
chain off an ingest rather than racing it.

**Nothing lists the watch folders.** "Add Folders…" adds them and there is no
way to see or remove one. A folder that is silently re-walked every quarter of
an hour needs both.
