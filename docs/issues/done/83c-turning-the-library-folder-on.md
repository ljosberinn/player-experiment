# 83c — Turning the Library folder on

The setting, the backfill and the standing behaviour: a root folder, and
everything in the library moved into it by [83b](83b-moving-one-release.md)
under [83a](83a-where-a-file-goes.md)'s layout. Opt-in, off by default.

## Opting in

A **Library Folder** section in Settings, above `WatchFolderSettings` — it is
the stronger statement of the same thing, what the app does to the library while
nobody is watching. A checkbox and a folder picker, two keys beside
`WATCH_INTERVAL`: `library.organize` and `library.root`.

Its own component next to `WatchFolderSettings`, with local state rather than a
store, and for that component's reason: the dialog is mounted only while it is
open, so there is nothing to keep in step while it is closed.

- **Neither joins `EXPORTABLE`.** A root path is machine-local and an export
  that carried it would name a folder that does not exist on the machine
  reading it.
- **The checkbox is disabled until a root is picked**, so organize-on with no
  root is not a state the UI can reach. The worker treats it as off anyway: two
  keys have four combinations and only three of them mean anything.
- **A root with no path budget left is refused at the picker**, per 83a's
  `has_path_budget`: better a sentence in Settings than every filename in the
  library truncated to nothing. The sentence goes in the section rather than on
  the status bar — it is about the folder the user has this moment chosen.
- **Turning it off stops the step and moves nothing back.** The files are where
  the user asked them to be; a second bulk move to undo a bulk move is not an
  undo, it is another four hours. A half-finished backfill is safe to leave
  because of the watch-folder rule below: both trees are watched, so no row goes
  missing whichever side of the run it is on.

*Settled:* **changing the root is a full backfill**, confirmed at the picker
with the count it is about to move. It is the only reading under which the
setting keeps meaning what it says, and the derived state below makes it
automatic rather than something to implement — every file is off its target the
moment the root changes. The confirmation belongs to the picker alone: it is
where the cost is committed, and turning the checkbox on afterwards costs
nothing the picker did not already name.

### The root is a watch folder, and stays one

`scan::plan` marks missing **every** known row it did not walk, not only rows
under the roots it walked — `absent` exempts an unplugged drive and nothing
else. So a library organised into a folder nobody watches is a library marked
missing in full on the next scan.

Picking a root therefore adds it to `watch_folders`, and **`remove_watch_folder`
refuses it while `library.organize` is on**. `WatchFolderSettings` shows the row
without a Remove button and points at the section above; turning the checkbox
off is what releases it. The invariant is enforced where the user can reach it,
because two clicks in the panel directly below is not far enough away from
65,535 rows marked missing.

The **previous root stays watched and stays listed** after a change. It is where
the files came from, `prune_empty` never removes a watch root, and nothing else
in the app knows to keep looking at it.

## One pass, not two

*Settled:* **this is a second step in [82b](82b-the-unattended-lookup-pass.md)'s
worker, not a second worker.**

Placing a release means reading the tags the lookup writes, so as two passes the
two are coupled per release and every way of expressing that coupling is worse
than not having it. A gate — place only a release the lookup has reached — stalls
the whole backfill behind forty-five hours on a fresh library, counts 8,044
releases in a total it will never complete, and leaves 82c's single-payload
`task://progress` with two live producers whose labels overwrite each other. No
gate means 8,044 releases moved twice. One pass has neither problem: the release
is looked up and placed in the same visit, in that order, and there is nothing to
coordinate because there is nothing running alongside.

So the thread moves to `library::worker`; `tagsource::pass::look_up` stays where
it is and is called from there. It runs while **either** switch is on, and reads
both per release, so either one going off cancels its own step mid-pass without
touching the other.

Per release, in order: look it up if lookup is on and `release_lookup` has no
row, then place it if organize is on and it is not already placed.

- **Placement follows the visit's lookup whatever the verdict** — written,
  queued for review, or nothing found. A release the lookup could not resolve is
  placed from its own tags with `Album` as the type, which is what 83a already
  says such a release gets.
- **The one legitimate second move is the user's own.** Applying a review from
  82c's queue rewrites the release's identity, so its target changes and the next
  sweep moves it. That is the edit doing what it says, not the pass changing its
  mind.
- **One label, one total, one estimate.** 82c's channel gets the single producer
  it was drawn for, and `backgroundTaskStore`'s note that two tasks cannot run at
  once becomes true rather than merely believed. The label names the steps that
  are on and does not change during a run. The estimate is unchanged: it already
  averages the last 100 releases because the rate is not steady, and a ten-second
  lookup beside a sub-second move is only more of that.
- **Total is the releases the survey found with either step left to do**, which
  is the number that reaches 100%.
- **`APEX_LOOKUP_DRY_RUN` moves no files either.** It reports the verdict it
  would reach and writes nothing, and a rehearsal that renamed the library would
  be the opposite of the mode.

## The survey

**There is no resume table and no migration.** A release whose files all sit at
their computed target is done, and the computation is string builds with no I/O
in them. The state is derived from the paths, which is the same property that
makes 83b's retries free, and it survives the setting being turned off and on
again.

### One scan, not one per release

`query::release_files` matches on a grouping expression, so a call per release
is a full table scan per release — 8,044 of them over 65,535 rows to be told a
filed library is filed. A sweep opens instead with one ordered pass over
`tracks`, grouping consecutive rows the way `release_selections` does, against
one read of `release_lookup`'s keys. Only the releases that come out with work
to do pay for a second read.

No filesystem calls: the row's path is where the file is, and a file that is not
there is what a scan marks missing.

**A release is placed when every file of it is at its target**, or at that
target with a trailing ` (n)` — which is 83b's collision suffix and not a file
out of place. Folding the suffix in is what keeps a collided release from
reading as unplaced on every sweep, forever. Missing rows do not count either
way: there is no file to move.

**The survey calls `mover`'s own `shape` and `track` builders**, made
`pub(crate)` for it, rather than rebuilding the target beside them. Two answers
to where a file goes is the defect: the harmless direction is a release the
survey calls placed and the mover would have moved, and the other direction is a
sweep that offers the same release to a mover that does nothing with it, every
sweep, forever.

**It is not free.** The order is over `coalesce(nullif(…))` expressions with no
index behind them, so it is a temp-b-tree sort of every row in `tracks` plus a
`relative_path` per row. That is why the idle backoff below is not optional, and
it is re-run per batch rather than once per sweep: a sweep runs for forty-five
hours and a release retagged inside one has to be picked up before it ends.

## Standing behaviour

Every file a scan adds from then on is moved by the same worker on its own
cadence — 82b's `TICK` and `IDLE_MAX`, unchanged. No signal from the scan is
needed: the files it adds are not at their targets, so the next survey finds
them, the same way a release with no `release_lookup` row is what the lookup's
next sweep finds. A sweep that finds nothing to do costs the survey and no
filesystem calls at all, which is what `IDLE_MAX` is for.

Moving from inside the scan is not an option in any case: a scan holds the
`ScanLock` for its whole length and `mover::move_release` takes it per release,
so a call from inside one would deadlock on a mutex that is not reentrant.

**A release that fails to move is logged, skipped, and not offered again during
that run.** The sweep carries on to the next one — a locked file must not end a
four-hour backfill — and an in-memory set for the run's length is what keeps a
permanent failure from being retried within it, without a table or a migration.
Across sweeps it is retried, which costs one attempt and one log line each: the
alternative is a status column, and a file the user unlocks tomorrow is worth
more than the noise.

**A deferred release goes to a tail tried once at the end of the sweep**, and
otherwise waits for the next one. It never re-enters the survey mid-sweep, so an
album left playing all evening cannot spin the pass — and a user who leaves one
album on does not find it the only one left behind.

**Which files the player holds open is the worker's to say.** 83b left that to
its caller because the sink's prepared successor is not reachable from outside
`audio::engine`. So `EngineState` carries the queue's next track beside the
current one, reported whether or not that successor has actually been prepared,
and `library::worker` reads it through a closure the way it reads the switches.
At worst it defers one release more than it had to.

It is a snapshot, so playback can prepare a track of a release the worker has
already decided to move. The damage is bounded rather than prevented: Rust opens
files with `FILE_SHARE_DELETE`, so the rename or the cross-volume delete still
succeeds and the decoder keeps reading the handle it already has.

One `log::Op` per release through `announcing_with` and one `library://changed`
per release, coalesced on the emit side by 82a — the wiring 83b returns its
counts for.

Testing: the survey asserted to hold a placed release, a release one file short
of placed, a collision suffix and a missing row apart, and asserted to agree with
the mover on a release the mover then reports nothing to do for. The pass
asserted to look up and place a release in one visit, to place a release the
lookup queued or missed, to move only what is not already placed, to resume after
a kill without repeating work, to carry on past a release that fails to move and
not retry it in the same run, to defer the playing release to the end of a run
rather than dropping it, and to stop each step within a tick of its own switch
going off. `remove_watch_folder` asserted to refuse the root while organize is
on. E2E screenshot of the Settings section, per `CLAUDE.md` — the sidebar readout
is 82c's to capture. Specs written and pushed for CI to run.
