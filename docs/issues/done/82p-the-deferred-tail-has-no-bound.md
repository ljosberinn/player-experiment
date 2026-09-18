# 82p — A release the player held open is stranded for the length of the sweep

`Outcome::Deferred` says what the tail is for: "Tried once more at the end of
the sweep rather than dropped: a user who leaves one album on must not find it
the only one left behind." That was written when a sweep was seconds long —
[82g](82g-a-503-defers-the-release.md) counted 34 of 38 sweeps in an evening
ending within five seconds of a fatal `lookup.release`, so the tail ran every
few minutes.

**82g and [82l](82l-a-run-that-dies-with-the-sweep.md) made the sweep survive,
and nothing re-examined the deferral.** `skip` takes the key when the batch
visits the release, so the survey cannot offer it again this sweep; rescanning
does nothing, because `scan` writes rows and the pass has already spent its one
decision. Nothing frees it but the tail — or a restart, which drops `skip` with
the process.

Reproduced, 2026-09-17:

```
10:27:10  library.place  album=White Tomb artist=Altar of Plagues status=playing
10:58:59  playback.load  track=2908          ← playback leaves the release
10:59:44  scan           added=0 updated=0 missing=0
11:02:15  db.open                            ← restart
11:02:31  library.place  album=White Tomb artist=Altar of Plagues status=moved files=4
```

Thirty-five minutes in the watch folder, four of them with the album playing,
and what released it was quitting the app. Without the restart the next chance
was the sweep's tail, and the sweep running at 11:02 was still going 2h26m
later.

## The bound was the park, and 82o removed it

The tail also carries every declined lookup. It had not grown, because every
sweep parked on 503s within forty to ninety minutes — the largest `deferred` in
the day is 2.

[82o](82o-a-503-is-the-one-failure-that-proves-the-service-answered.md) took
that park away, correctly: a 503 is not an outage. A sweep now runs until the
library is exhausted, roughly 90 sweep-hours, and the tail is both the only
release path and unbounded — at 26% declines over the ~7,500 releases left,
about 2,000 entries, each re-asked once, in a tail that only starts after the
last of them.

## Two deferrals, one tail, and they do not want the same rule

- **The mover's.** Bounded by playback already: `(signals.open)()` is the
  playing track and the prepared next, so a drain sheds every entry but the one
  open at that moment. The wait is minutes — the file is released when the
  track ends.
- **The lookup's.** Thousands, and a service that goes on declining adds a
  quarter of every batch. Nothing sheds it but a drop rule.

*Both lists drain at the end of every batch.* The retry comes a batch later
instead of days later, and neither list outlives the batch that filled it.

- The mover's entries go back on the list while the file is still open, and are
  never dropped: the open set is the bound, and dropping after a second failure
  would strand an album left on all evening for the rest of the sweep — the
  case `Outcome::Deferred` exists for, and today's tail at least reaches it.
- The lookup's are dropped when they decline a second time. The next sweep has
  them back, and it is the next sweep rather than the next day: `next_sweep`
  returns `TICK` while the last one got through anything at all.

The tail after the loop goes with this. The last batch is drained before the
survey comes back empty, so there is nothing left for it to do.

`skip` is not an objection to draining mid-sweep. It is what makes the *survey*
terminate — "a question about the library, not a cursor" — and a deferral rides
an explicit list rather than the survey, so nothing re-enters it.

## The readout counts one release twice

The batch visit and the tail visit each do `summary.deferred += 1`, so a
release deferred at both reads as two. `summary.failed` has the same shape for
a decline. `unmovable` does not: a mover error leaves `Visit::Next`, so it
never reaches the list.

`deferred` counts releases and has to count each once. `failed` counts what the
pass paid — a second visit is three more requests — so it stays per exhausted
lookup and its doc stops calling them releases. A repeated deferral writes no
`library.place status=playing` line either: an album left on all evening would
otherwise write one per batch for ninety hours.

Testing: a release deferred by the mover asserted to be retried without the
sweep ending; one held for a whole sweep asserted to be retried at every drain,
counted once and logged once; a sweep of declines asserted not to grow its
deferred list past a batch; a release that declines twice asserted to be
dropped rather than held.
