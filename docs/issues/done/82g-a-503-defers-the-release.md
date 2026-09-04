# 82g — A 503 defers the release rather than ending the sweep

`Visit::LookupFailed` sets `hobbled`, and `live_steps` folds that into
`steps.look_up` for the rest of the run. One release exhausting its three
attempts therefore parks the lookup step until the next sweep, which the survey
then drains of placement work in seconds.

**34 of 38 sweeps in one evening's `main.log` ended within five seconds of a
fatal `lookup.release`.** Since the 19:00 backfill: 36 sweeps, 147 lookups
reaching a verdict, 36 ending on a 503 — four releases a sweep. `Absu` cost five
sweeps, `Absztrakkt — Dein Zeichen` four.

## One 503 says nothing about the next request

The premise the hobbling was written on — "the usual cause is that every
following release would fail the same way" — is contradicted by the same log.
Sweeps absorb declines and keep resolving: 26 verdicts against 5 absorbed
retries before the one that was fatal, 24 against 11, 16 against 3. Across the
evening, 33 retries worked and 36 did not, over roughly 435 requests. Something
near a third of requests is declined, so three in a row is ordinary and is not
evidence about the release after it.

**A 503 pushes the release onto the tail `sweep` already keeps.** That tail runs
hours later on a real pass, by which time a burst is long over, and the sweep
carries on through the batch in between.

## The tail was built for the mover and has to take both

- The guard is `if steps.root.is_none() { break }`. A lookup-only pass never
  reaches its own deferrals. `!steps.any()`.
- **A release whose lookup could not reach it is not placed.** `visit` already
  refuses that — the place step is behind `Visit::Next` — and the tail has to
  keep refusing it, or a 503 would file a release under the tags the lookup was
  about to replace and the next sweep would move it again. `pending.look_up &&
  !steps.look_up` in the tail is the case: skip it.
- A second failure in the tail drops the release. It keeps no row, so the next
  sweep has it back, and re-deferring inside the tail is how a sweep stops
  terminating.

## The backstop is a run, not the first one

Without one, a network that is down defers all 8,044 releases and then spends
three attempts on each of them in the tail.

**Consecutive failures, reset by any lookup that reaches a verdict.** The reset
has to mean "a lookup ran and did not fail", which is `pending.look_up &&
steps.look_up` at the call site, not `Visit::Next` — a place-only release
returning `Next` would otherwise clear the count and a real outage would never
trip it.

*Threshold: three.* Three releases each exhausting three attempts is nine
consecutive declines over three minutes, which is an outage rather than a burst.
It cannot be drawn from this log: hobbling caps every sweep at one fatal failure,
so the natural run length has never been observed. Pick it, ship it, read it back
off the sweep line.

Once it trips, `steps.look_up` is false for every following release, so no
further release can fail its lookup — which is what bounds the deferred list at
three lookup entries plus the mover's.

## What the sweep line does not say

A release that failed outright returns an error rather than an outcome, so its
`retries` are lost and it is not counted in `visited`. With sweeps no longer
dying on the first one, the count of them is the number that says whether the
threshold is right. **`failed` on `Summary` and on the `pass.sweep` line.**

## Two defects in the same loop, found while reading it

Both need both switches on, which is why nothing has caught them.

- **A mover-deferred release is looked up twice.** `visit` takes `pending` by
  reference and refreshes the album and artist into a local, so the tail visits
  it with `pending.look_up` still true and `pending.release` still naming the
  release under its pre-lookup tags. The second lookup searches on tags nothing
  carries any more and queues a release that was already resolved.
  `Pending { look_up: false, ..pending }` on the deferral is the fix, and it is
  in the line this issue rewrites anyway.
- **The tail counts a move that moved nothing.** `move_release` returns
  `Done(Moved::default())` when `release_files` finds none, which is what the
  stale name above produces, and `visit` counts `placed += 1` on `Done`. Not
  this issue's, and worth its own.

Testing: a sweep asserted to carry on through the batch after a release exhausts
its attempts, and to resolve that release from the tail once the transport
answers; a run of failures asserted to park the step, with the call count proving
the release after it was never asked; the tail asserted not to place a release
whose lookup never reached it.
