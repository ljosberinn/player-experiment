# 82p — A release the player held open is stranded for the length of the sweep

`Outcome::Deferred` says what the tail is for: "Tried once more at the end of
the sweep rather than dropped: a user who leaves one album on must not find it
the only one left behind." That was written when a sweep was seconds long —
[82g](../done/82g-a-503-defers-the-release.md) counted 34 of 38 sweeps in an
evening ending within five seconds of a fatal `lookup.release`, so the tail ran
every few minutes.

**82g and [82l](../done/82l-a-run-that-dies-with-the-sweep.md) made the sweep
survive, and nothing re-examined the deferral.** `skip` takes the key when the
batch visits the release, so the survey cannot offer it again this sweep;
rescanning does nothing, because `scan` writes rows and the pass has already
spent its one decision. Nothing frees it but the tail — or a restart, which
drops `skip` with the process.

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

## The bound today is the park, and 82o removes it

The tail also carries every declined lookup. It has not grown, because every
sweep parks on 503s within forty to ninety minutes — the largest `deferred` in
the day is 2.

[82o](82o-a-503-is-the-one-failure-that-proves-the-service-answered.md) takes
that park away, correctly: a 503 is not an outage. A sweep then runs until the
library is exhausted, roughly 90 sweep-hours, and the tail becomes both the
only release path and unbounded — at 26% declines over the ~7,500 releases left,
about 2,000 entries, each re-asked once, in a tail that only starts after the
last of them.

**So this lands with 82o, not after it.**

## Two deferrals, one tail, and they no longer want the same thing

- **The mover's.** A handful, and the wait is minutes — the file is released
  when the track ends.
- **The lookup's.** Thousands, and the wait is a network's.

*Draining deferrals per batch rather than per sweep* fits both: the retry comes
a batch later instead of days later, the list never grows past a batch, and a
release that fails twice is still dropped to the next sweep. **Not decided
here** — a release re-entering the same sweep is exactly what `skip` exists to
prevent, and the interaction wants working through before it is written.

Until it is, the readout lies about it too: the batch visit and the tail visit
each do `summary.deferred += 1`, so one release reads as two. The 10:27:11 sweep
reports `deferred=2` for White Tomb alone.

Testing: a release deferred by the mover asserted to be retried without the
sweep ending; a sweep of declines asserted not to grow its deferred list past a
batch; a release that defers twice asserted to be dropped rather than held; one
deferred release asserted to count once.
