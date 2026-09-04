# 83c — Turning the Library folder on

The setting, the backfill and the standing behaviour: a root folder, and
everything in the library moved into it by [83b](../done/83b-moving-one-release.md)
under [83a](../done/83a-where-a-file-goes.md)'s layout. Opt-in, off by default.

## Opting in

A **Library Folder** section in Settings, above `WatchFolderSettings` — it is
the stronger statement of the same thing, what the app does to the library while
nobody is watching. A checkbox and a folder picker, two keys beside
`WATCH_INTERVAL`: `library.organize` and `library.root`.

- **Neither joins `EXPORTABLE`.** A root path is machine-local and an export
  that carried it would name a folder that does not exist on the machine
  reading it.
- **The root becomes a watch folder** when it is picked, or the moved files
  leave the library on the next scan.
- **A root with no path budget left is refused at the picker**, per 83a: better
  a sentence in Settings than every filename in the library truncated to
  nothing.
- **Turning it off stops the worker and moves nothing back.** The files are
  where the user asked them to be; a second bulk move to undo a bulk move is not
  an undo, it is another four hours.

*Open:* what changing the root to a different folder means. It is either a
second full backfill or a no-op that leaves the library split across two roots,
and both are defensible. Recommendation: a full backfill, with the confirmation
that names the cost — it is the only reading under which the setting keeps
meaning what it says.

## The backfill

The same shape as [82b](../done/82b-the-unattended-lookup-pass.md)'s pass and for the
same reasons: a named thread owning a `Db` handle and a cancel flag, started
from `lib.rs`, not `commands::blocking`. Cancellable, and the switch going off
cancels a run in flight.

**There is no resume table and no migration.** A release whose files all sit at
their computed target is done, and the computation is 65,535 string builds with
no I/O in them. The state is derived from the paths, which is the same property
that makes 83b's retries free, and it survives the setting being turned off and
on again.

**Second producer for [82c](../done/82c-the-review-queue-and-progress.md)'s progress
readout** — that channel is a label, a done, a total and an estimate, and it
exists in that shape because of this phase. Total is the releases not yet at
their targets when the run starts.

## Standing behaviour

Every file a scan adds from then on is moved, in the same worker, after the scan
commits — not inside it, or a `ScanLock` held per release would deadlock against
the scan that is holding it. A pass that finds nothing to move costs the derived
check and no filesystem calls at all.

*Open:* what happens to a release [82b](../done/82b-the-unattended-lookup-pass.md) has
not looked up yet, when both features are on. Placing it now means placing it
from its own tags with `Album` as the type, and then moving it a second time
when the lookup writes the real type and possibly a different album artist —
8,044 releases moved twice. Recommendation: with lookup enabled, the mover waits
for a `release_lookup` row; with lookup off, it places from tags immediately.
The alternative is honest too, and it is a decision rather than a detail.

Testing: the worker asserted to move only what is not already placed, to resume
after a kill without repeating work, and to stop within a tick of the switch
going off. E2E screenshot of the Settings section, per `CLAUDE.md` — the
sidebar readout is 82c's to capture. Specs written and pushed for CI to run.
