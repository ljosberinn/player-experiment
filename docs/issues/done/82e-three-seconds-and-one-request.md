# 82e — Three seconds, and one request at a time

[82d](82d-the-pass-cannot-finish.md)'s fixes were run over the real library and
did not hold. The first sweep got 72 releases in against 54, then nine sweeps in
nine minutes each ended on a 503, six of them inside fifteen seconds — and a dry
run that dies restarts at the top, so the survey never left the first twenty
releases.

## The limiter was reasoning from the wrong number

1.1s was chosen as headroom over the one request a second
[MusicBrainz documents](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).
That page also says a 503 comes from any of three buckets — per user agent, per
address, and a **global 300 a second** — so a client inside its own allowance
still gets declined when theirs is full, and the status code cannot tell the two
apart. Retrying twice over six seconds was answering a question we could not
read.

- **Three seconds, hardcoded, no escalation.** Whether the 503s were ours or
  theirs, a pass measured in hours loses nothing by asking less often. If they
  keep coming at 3s, that answers the question the guessing could not.
- **One request in flight.** The gate is held for the whole request rather than
  the gap before it, and the interval is measured from when the answer came
  back. A request nobody has answered has not been counted at their end.
- **The retry keeps no backoff of its own.** Two things deciding how long to
  wait is how 82d ended up with the limiter and the pass disagreeing.

The cost is about eighteen hours for eight thousand releases, thirteen of them
the interval, and an open lookup dialog waiting up to three seconds behind the
pass. Both are accepted.

## The dry run's cursor has to outlive a sweep

82d put the offset inside `sweep`, on the premise that a dry run is one survey
in one process. Sweeps end — that is what a 503 does — and the offset died with
each one. It belongs to the thread.

It also advanced by whole batches before the batch ran, so a sweep that ended at
release 3 of 200 would have resumed at 201. **Per release attempted**, and past
one that failed: a survey with a hole in it beats one stuck on the release that
always fails.

## A finished library is swept forever

Two group-bys over every track — 104 ms and 100 ms on 65,535 of them, the second
holding the write lock — every fifteen seconds, for as long as the app runs, to
be told there is nothing to do. 5,760 a day.

**Waking and sweeping become two cadences.** The switch is still read every
fifteen seconds, because it is one keyed row and it is what makes the switch feel
immediate. The gap between sweeps doubles to a ten-minute ceiling whenever a
sweep finds nothing or ends on a failure, and snaps back to fifteen seconds when
one gets through releases. A release a scan just added waits up to ten minutes,
which is nothing beside eighteen hours.

The User-Agent needed nothing: it already names the app, its version and the
repository, which is what they ask for.

Testing: the interval asserted from two callers at once and against a slow
request, both at the shipping three seconds; the dry run's cursor asserted to
survive a sweep a 503 ended and to pass over the release that failed. The gate
every other test incidentally uses is scaled to 10 ms, or the suite would spend
minutes asleep.
